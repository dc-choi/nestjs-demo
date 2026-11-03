"""Generate application-table commerce SQL beside an existing synthetic event dataset."""

import argparse
import hashlib
import json
import platform
import re
import sys
import time
from pathlib import Path

from .commerce import CommerceBuilder, EMPTY_OPTIONS_SIGNATURE, item_price, sku, timestamp
from .generate_sql import VERSION as SOURCE_VERSION, compressed_text, sql_value, write_inserts, write_json
from .synthetic import build_population, generate_days


VERSION = "1"
ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "src/infra/database/migrations"
TABLE_ORDER = (
    "orders", "order_items", "order_item_snapshots", "inventory_reservations",
    "order_status_histories", "payment_attempts", "payment_transactions", "inventory_movements",
    "rec_checkout_orders", "rec_purchase_orders",
)


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_dataset(dataset):
    dataset = Path(dataset)
    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    if manifest["generator_version"] != SOURCE_VERSION or SOURCE_VERSION != "2":
        raise ValueError("commerce fixtures require source generator version 2")
    if manifest["python"] != platform.python_version():
        raise ValueError("replay requires the original Python version: {}".format(manifest["python"]))
    expected_sources = {"catalog.py", "synthetic.py", "generate_sql.py"}
    if set(manifest["source_sha256"]) != expected_sources:
        raise ValueError("source manifest has an unexpected generator file set")
    for name, expected in manifest["source_sha256"].items():
        if digest_file(Path(__file__).with_name(name)) != expected:
            raise ValueError("source generator changed since dataset creation: {}".format(name))
    if digest_file(Path(__file__).with_name("schema.sql")) != manifest["schema_sha256"]:
        raise ValueError("source schema changed since dataset creation")
    if digest_file(dataset / "dataset.sql.gz") != manifest["sql_sha256"]:
        raise ValueError("source dataset SQL checksum does not match manifest")
    return manifest


def application_schema(migrations=MIGRATIONS):
    """Extract only literal addSql statements, rejecting migration code we cannot execute."""
    statements, sources = [], {}
    call = re.compile(r"this\.addSql\(\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'\\])*')\s*\);", re.S)
    for path in sorted(Path(migrations).glob("Migration*.ts")):
        source = path.read_text(encoding="utf-8")
        match = re.search(r"override (?:async )?up\(\):[^\{]+\{(.*?)\n    \}", source, re.S)
        if not match:
            raise ValueError("unsupported migration up method: {}".format(path.name))
        body = match.group(1)
        if call.sub("", body).strip():
            raise ValueError("migration contains nonliteral operations: {}".format(path.name))
        for literal in call.findall(body):
            text = literal[1:-1]
            if "${" in text or re.search(r"\\[^\\`']", text):
                raise ValueError("unsupported migration literal: {}".format(path.name))
            statements.append(re.sub(r"\\([\\`'])", r"\1", text))
        sources[path.name] = digest_file(path)
    if not statements:
        raise ValueError("no application migration statements found")
    return "\n".join(statements) + "\n", sources


def write_dict_rows(stream, table, rows):
    iterator = iter(rows)
    first = next(iterator, None)
    if first is None:
        return
    columns = tuple(first)

    def values():
        yield tuple(first[column] for column in columns)
        for row in iterator:
            if tuple(row) != columns:
                raise ValueError("inconsistent columns for {}".format(table))
            yield tuple(row[column] for column in columns)
    write_inserts(stream, table, columns, values())


def write_guard(stream, source):
    stream.write("""CREATE TABLE rec_commerce_dataset (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    generator_version VARCHAR(16) NOT NULL,
    seed BIGINT UNSIGNED NOT NULL,
    source_profile VARCHAR(16) NOT NULL,
    source_generator_version VARCHAR(16) NOT NULL,
    source_actual_events BIGINT UNSIGNED NOT NULL,
    source_sql_sha256 CHAR(64) NOT NULL,
    source_valid TINYINT NOT NULL,
    actual_orders BIGINT UNSIGNED NULL,
    actual_purchases BIGINT UNSIGNED NULL,
    is_complete BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (id=1), CHECK (source_valid=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""")
    conditions = (
        "(SELECT COUNT(*) FROM rec_dataset)=1",
        "d.id=1", "d.is_complete=1",
        "d.profile={}".format(sql_value(source["profile"])),
        "d.seed={}".format(source["seed"]),
        "d.generator_version={}".format(sql_value(source["generator_version"])),
        "d.expected_users={}".format(source["users"]),
        "d.expected_products={}".format(source["products"]),
        "d.target_events={}".format(source["target_events"]),
        "d.actual_events={}".format(source["actual_events"]),
        "(SELECT COUNT(*) FROM rec_users)={}".format(source["users"]),
        "(SELECT COUNT(*) FROM rec_products)={}".format(source["products"]),
        "(SELECT COUNT(*) FROM rec_events)={}".format(source["actual_events"]),
    )
    # The scalar subquery yields NULL for a missing marker, so NOT NULL rejects it too.
    guard = "COALESCE((SELECT ({}) FROM rec_dataset d WHERE d.id=1),0)".format(" AND ".join(conditions))
    stream.write("INSERT INTO rec_commerce_dataset (id,generator_version,seed,source_profile,"
                 "source_generator_version,source_actual_events,source_sql_sha256,source_valid) VALUES "
                 "(1,{},{},{},{},{},{},{});\nCOMMIT;\n".format(
                     sql_value(VERSION), source["seed"], sql_value(source["profile"]),
                     sql_value(source["generator_version"]), source["actual_events"],
                     sql_value(source["sql_sha256"]), guard))


def write_mapping_schema(stream):
    stream.write("""CREATE TABLE rec_checkout_orders (
    cart_event_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    FOREIGN KEY (cart_event_id) REFERENCES rec_events(event_id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE rec_purchase_orders (
    event_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    order_item_id BIGINT NOT NULL UNIQUE,
    capture_transaction_id BIGINT NOT NULL UNIQUE,
    FOREIGN KEY (event_id) REFERENCES rec_events(event_id),
    FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    FOREIGN KEY (capture_transaction_id) REFERENCES payment_transactions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""")


def write_catalog(stream, products, users, builder):
    start = timestamp(0)
    seller_id = len(users) + 1
    write_inserts(stream, "members", ("id", "name", "email", "phone", "role", "created_at", "updated_at"), (
        (user["id"], "합성 사용자 {}".format(user["id"]), "user-{}@example.invalid".format(user["id"]),
         "SYNTHETIC-NO-PHONE", "CUSTOMER", timestamp(user["created_day"] * 86_400),
         timestamp(user["created_day"] * 86_400)) for user in users
    ))
    write_inserts(stream, "members", ("id", "name", "email", "phone", "role", "created_at", "updated_at"), [
        (seller_id, "합성 판매자", "seller@example.invalid", "SYNTHETIC-NO-PHONE", "SELLER", start, start)
    ])
    groups = list(dict.fromkeys(product["group"] for product in products))
    categories = list(dict.fromkeys(product["category"] for product in products))
    category_ids = {name: len(groups) + index + 1 for index, name in enumerate(categories)}
    write_inserts(stream, "categories", ("id", "name", "slug", "sequence", "is_active", "created_at", "updated_at", "parent_id"), (
        (index + 1, group, "synth-group-{}".format(index + 1), index, 1, start, start, None)
        for index, group in enumerate(groups)
    ))
    write_inserts(stream, "categories", ("id", "name", "slug", "sequence", "is_active", "created_at", "updated_at", "parent_id"), (
        (category_ids[category], category, "synth-category-{}".format(category_ids[category]), index, 1, start, start,
         groups.index(next(p["group"] for p in products if p["category"] == category)) + 1)
        for index, category in enumerate(categories)
    ))
    write_inserts(stream, "products", ("id", "slug", "name", "status", "revision", "created_at", "updated_at", "seller_id"), (
        (p["id"], p["key"], p["name"], "ACTIVE", 1, start, start, seller_id) for p in products
    ))
    write_inserts(stream, "product_categories", ("product_id", "category_id", "sequence"), (
        (p["id"], category_ids[p["category"]], 0) for p in products
    ))
    write_inserts(stream, "product_tags", ("product_id", "value", "sequence"), (
        (p["id"], tag, index) for p in products for index, tag in enumerate(p["tags"])
    ))
    write_inserts(stream, "items", ("id", "sku", "name", "supply_price", "vat", "total_price", "is_tax_free",
                                     "sale_status", "stock", "sequence", "option_signature", "created_at", "updated_at", "product_id"), (
        (p["id"], sku(p["id"]), "기본 상품", *item_price(p), int(item_price(p)[1] == 0), "ALLOW",
         builder.initial_stock, 0, EMPTY_OPTIONS_SIGNATURE, start, start, p["id"]) for p in products
    ))
    write_inserts(stream, "inventory_movements", ("id", "type", "quantity_delta", "stock_after", "item_sku",
                                                   "idempotency_key", "reference_type", "reference_id", "reason", "created_at", "item_id"), (
        (builder.next_id("inventory_movements"), "RECEIPT", builder.initial_stock, builder.initial_stock,
         sku(p["id"]), "synth:receipt:{}".format(p["id"]), None, None, "SYNTHETIC_INITIAL_STOCK", start, p["id"])
        for p in products
    ))


def generate(dataset, output):
    started = time.monotonic()
    source = read_dataset(dataset)
    schema, migration_sources = application_schema()
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    products, users = build_population(source["seed"], source["users"], source["products"])
    # shortcut: abundant fixture stock excludes stockout behavior, add supply scenarios when studying availability.
    initial_stock = source["target_events"] * 3 + 100
    if initial_stock > 2_147_483_647:
        raise ValueError("fixture stock exceeds application's signed INT limit")
    builder = CommerceBuilder(products, source["seed"], initial_stock)
    partial = output / "commerce.sql.gz.partial"
    events_seen = 0
    with compressed_text(partial) as stream:
        stream.write("-- Synthetic application-table fixture; import only after its matching rec dataset.\n")
        stream.write("-- Requires mysql batch mode without --force; stop on the first error.\n")
        stream.write("SET NAMES utf8mb4;\nSET time_zone='+00:00';\nSET @commerce_previous_sql_mode=@@SESSION.sql_mode;\n")
        stream.write("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';\n")
        write_guard(stream, source)
        stream.write(schema)
        write_mapping_schema(stream)
        stream.write("START TRANSACTION;\n")
        write_catalog(stream, products, users, builder)
        stream.write("COMMIT;\n")
        for day, events in generate_days(products, users, source["seed"], source["target_events"], {}):
            events_seen += len(events)
            rows = builder.build_day(day, events)
            stream.write("-- Day {}\nSTART TRANSACTION;\n".format(day))
            for table in TABLE_ORDER:
                write_dict_rows(stream, table, rows.get(table, ()))
            stream.write("COMMIT;\n")
            if day % 10 == 0 or day == 89:
                print("commerce day={:02d} orders={} purchases={}".format(
                    day, builder.counts["orders"], builder.counts["purchases"]), file=sys.stderr, flush=True)
        if events_seen != source["actual_events"]:
            raise ValueError("replayed event count differs from original dataset")
        stream.write("START TRANSACTION;\n")
        for product_id, stock in builder.stock.items():
            stream.write("UPDATE items SET stock={},updated_at={} WHERE id={};\n".format(
                stock, sql_value(timestamp(90 * 86_400 - 1)), product_id))
        stream.write("UPDATE rec_commerce_dataset SET actual_orders={},actual_purchases={},is_complete=TRUE WHERE id=1;\nCOMMIT;\n".format(
            builder.counts["orders"], builder.counts["purchases"]))
        stream.write("SET SESSION sql_mode=@commerce_previous_sql_mode;\n")
    manifest = {
        "generator_version": VERSION, "source_profile": source["profile"], "seed": source["seed"],
        "source_generator_version": source["generator_version"], "source_sql_sha256": source["sql_sha256"],
        "source_actual_events": events_seen, "python": platform.python_version(),
        "sql_sha256": digest_file(partial), "sql_bytes": partial.stat().st_size,
        "source_sha256": {name: digest_file(Path(__file__).with_name(name))
                          for name in ("commerce.py", "generate_commerce.py")},
        "migration_sha256": migration_sources,
        "orders": builder.counts["orders"], "purchases": builder.counts["purchases"],
        "observation_end_exclusive": timestamp(90 * 86_400), "initial_stock_per_item": initial_stock,
    }
    write_json(output / "manifest.json", manifest)
    write_json(output / "summary.json", {**builder.counts, "table_rows": dict(builder.ids),
                                         "elapsed_seconds": round(time.monotonic() - started, 3)})
    partial.rename(output / "commerce.sql.gz")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("recommender/output/main"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists; choose a new directory: {}".format(args.output))
    try:
        manifest = generate(args.dataset, args.output)
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, "Commerce generation failed: {}\n".format(error))
    print(json.dumps({"output": str(args.output), **manifest}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
