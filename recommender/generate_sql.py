"""Generate a deterministic, batched MySQL import without connecting to a database."""

import argparse
import gzip
import hashlib
import io
import json
import platform
import resource
import sys
import time
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from .synthetic import build_population, generate_days


VERSION = "2"
START = datetime(2026, 1, 1)
PROFILES = {
    "smoke": (100, 100, 2_000),
    "dev": (10_000, 1_000, 1_000_000),
    "main": (100_000, 10_000, 10_000_000),
}
INSERT_ROWS = 1_000


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    # The import enables NO_BACKSLASH_ESCAPES before writing any string literals.
    return "'" + str(value).replace("'", "''") + "'"


def write_inserts(stream, table, columns, rows):
    prefix = "INSERT INTO {} ({}) VALUES\n".format(table, ",".join(columns))
    batch = []
    for row in rows:
        batch.append("(" + ",".join(sql_value(value) for value in row) + ")")
        if len(batch) == INSERT_ROWS:
            stream.write(prefix + ",\n".join(batch) + ";\n")
            batch.clear()
    if batch:
        stream.write(prefix + ",\n".join(batch) + ";\n")


@contextmanager
def compressed_text(path):
    with path.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=1) as encoded:
            with io.TextIOWrapper(encoded, encoding="utf-8", newline="\n") as stream:
                yield stream


def write_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")


def event_rows(day, events):
    date = (START + timedelta(days=day)).strftime("%Y-%m-%d")
    for event_id, journey_id, user_id, product_id, kind, second in events:
        hour, remainder = divmod(second, 3_600)
        minute, second = divmod(remainder, 60)
        timestamp = "{} {:02d}:{:02d}:{:02d}".format(date, hour, minute, second)
        yield event_id, journey_id, user_id, product_id, kind, timestamp


def generate(profile, seed, output):
    user_count, product_count, target_events = PROFILES[profile]
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    products, users = build_population(seed, user_count, product_count)
    stats = {}
    sql_partial = output / "dataset.sql.gz.partial"
    with compressed_text(sql_partial) as stream:
        stream.write("-- Synthetic product data only; no application tables are modified.\n")
        stream.write("SET NAMES utf8mb4;\nSET time_zone = '+00:00';\n")
        stream.write("SET @rec_previous_sql_mode = @@SESSION.sql_mode;\n")
        stream.write("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';\n")
        stream.write(Path(__file__).with_name("schema.sql").read_text(encoding="utf-8"))
        stream.write("\nSTART TRANSACTION;\n")
        write_inserts(stream, "rec_dataset", (
            "id", "profile", "seed", "generator_version", "expected_users", "expected_products", "target_events"
        ), [(1, profile, seed, VERSION, user_count, product_count, target_events)])
        write_inserts(stream, "rec_products", (
            "product_id", "product_key", "name", "category_group", "category", "tags"
        ), ((product["id"], product["key"], product["name"], product["group"], product["category"],
             json.dumps(product["tags"], ensure_ascii=False)) for product in products))
        write_inserts(stream, "rec_users", ("user_id", "user_key", "created_at"), (
            (user["id"], user["key"], (START + timedelta(days=user["created_day"])).strftime("%Y-%m-%d %H:%M:%S"))
            for user in users
        ))
        stream.write("COMMIT;\n")
        event_count = 0
        for day, events in generate_days(products, users, seed, target_events, stats):
            stream.write("-- Day {}\nSTART TRANSACTION;\n".format(day))
            write_inserts(stream, "rec_events", (
                "event_id", "journey_id", "user_id", "product_id", "event_type", "occurred_at"
            ), event_rows(day, events))
            stream.write("COMMIT;\n")
            event_count += len(events)
            if day % 10 == 0 or day == 89:
                print("day={:02d} events={} total={}".format(day, len(events), event_count), file=sys.stderr, flush=True)
        stream.write("UPDATE rec_dataset SET actual_events={}, is_complete=TRUE WHERE id=1;\n".format(event_count))
        stream.write("COMMIT;\n")
        stream.write("SET SESSION sql_mode = @rec_previous_sql_mode;\n")

    private = output / "private"
    private.mkdir()
    with compressed_text(private / "users.jsonl.gz") as stream:
        for user in users:
            stream.write(json.dumps(user, ensure_ascii=False, sort_keys=True) + "\n")

    if "popularity_product_ids" in stats:
        write_json(private / "popularity.json", stats.pop("popularity_product_ids"))
    digest = hashlib.sha256()
    with sql_partial.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    manifest = {
        "generator_version": VERSION,
        "profile": profile,
        "seed": seed,
        "python": platform.python_version(),
        "random_generator": "random.Random (MT19937)",
        "users": user_count,
        "products": product_count,
        "target_events": target_events,
        "actual_events": event_count,
        "start": START.isoformat() + "Z",
        "validation_start": (START + timedelta(days=60)).isoformat() + "Z",
        "test_start": (START + timedelta(days=75)).isoformat() + "Z",
        "end_exclusive": (START + timedelta(days=90)).isoformat() + "Z",
        "sql_sha256": digest.hexdigest(),
        "sql_bytes": sql_partial.stat().st_size,
        "schema_sha256": hashlib.sha256(Path(__file__).with_name("schema.sql").read_bytes()).hexdigest(),
        "source_sha256": {
            name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in ("catalog.py", "synthetic.py", "generate_sql.py")
        },
    }
    write_json(output / "manifest.json", manifest)
    peak_memory = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform != "darwin":
        peak_memory *= 1024
    user_counts = stats.pop("user_event_counts", [])
    product_counts = stats.pop("product_event_counts", [])
    stats.update({
        "users": user_count,
        "products": product_count,
        "actual_events": event_count,
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "peak_memory_bytes": peak_memory,
        "sql_bytes": manifest["sql_bytes"],
        "users_without_events": sum(count == 0 for count in user_counts[1:]),
        "top_one_percent_product_events": sum(sorted(product_counts[1:], reverse=True)[:max(1, product_count // 100)]),
        "categories": dict(Counter(product["category"] for product in products)),
        "unique_pairs": "Compute with recommender/inspect.sql after local import; not estimated from row count.",
    })
    write_json(output / "summary.json", stats)
    sql_partial.rename(output / "dataset.sql.gz")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES, default="main")
    parser.add_argument("--seed", type=int, default=20261103)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 0 <= args.seed <= 2 ** 32 - 1:
        parser.error("seed must be an integer from 0 to 4294967295")
    output = args.output or Path("recommender/output") / args.profile
    if output.exists():
        parser.error("output already exists; choose a new directory: {}".format(output))
    try:
        manifest = generate(args.profile, args.seed, output)
    except (OSError, ValueError) as error:
        parser.exit(1, "Generation failed: {}. Incomplete files remain in {}.\n".format(error, output))
    print(json.dumps({"output": str(output), **manifest}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
