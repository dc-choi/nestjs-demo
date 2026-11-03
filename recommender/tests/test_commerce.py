import gzip
import tempfile
import unittest
from collections import Counter, defaultdict
from pathlib import Path

from recommender.commerce import CommerceBuilder, END_SECOND, timestamp
from recommender.generate_commerce import application_schema, generate, read_dataset
from recommender.generate_sql import generate as generate_events
from recommender.synthetic import build_population, generate_days


class CommerceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.products, cls.users = build_population(42, 1_000, 100)
        cls.builder = CommerceBuilder(cls.products, 42, 1_000_000)
        cls.rows = defaultdict(list)
        cls.purchase_events = {}
        cls.cart_events = {}
        for day, events in generate_days(cls.products, cls.users, 42, 100_000, {}):
            for event in events:
                if event[4] == "purchase":
                    cls.purchase_events[event[0]] = (event, timestamp(day * 86_400 + event[5]))
                elif event[4] == "cart":
                    cls.cart_events[event[0]] = (event, timestamp(day * 86_400 + event[5]))
            for table, rows in cls.builder.build_day(day, events).items():
                cls.rows[table].extend(rows)

    def test_purchase_mapping_preserves_user_product_and_exact_capture_time(self):
        orders = {row["id"]: row for row in self.rows["orders"]}
        items = {row["id"]: row for row in self.rows["order_items"]}
        transactions = {row["id"]: row for row in self.rows["payment_transactions"]}
        attempts = {row["id"]: row for row in self.rows["payment_attempts"]}
        self.assertEqual({row["event_id"] for row in self.rows["rec_purchase_orders"]}, set(self.purchase_events))
        for link in self.rows["rec_purchase_orders"]:
            event, occurred_at = self.purchase_events[link["event_id"]]
            item = items[link["order_item_id"]]
            order = orders[item["order_id"]]
            transaction = transactions[link["capture_transaction_id"]]
            self.assertEqual((order["member_id"], item["item_id"]), (event[2], event[3]))
            self.assertEqual((transaction["type"], transaction["status"]), ("CAPTURE", "SUCCEEDED"))
            self.assertEqual(transaction["processed_at"], occurred_at)
            self.assertEqual(attempts[transaction["payment_attempt_id"]]["order_id"], order["id"])

    def test_money_retry_refund_and_reservation_invariants(self):
        orders = {row["id"]: row for row in self.rows["orders"]}
        snapshots = {row["order_item_id"]: row for row in self.rows["order_item_snapshots"]}
        reservations = {row["order_item_id"]: row for row in self.rows["inventory_reservations"]}
        transactions = defaultdict(list)
        for row in self.rows["payment_transactions"]:
            transactions[row["payment_attempt_id"]].append(row)
        statuses = Counter(row["status"] for row in self.rows["payment_attempts"])
        for required in ("FAILED", "CANCELLED", "CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"):
            self.assertGreater(statuses[required], 0)
        self.assertGreater(self.builder.counts["retried_orders"], 0)
        for item in self.rows["order_items"]:
            order, snapshot, reservation = orders[item["order_id"]], snapshots[item["id"]], reservations[item["id"]]
            self.assertEqual(item["price"], snapshot["unit_total_price"] * item["quantity"])
            self.assertEqual(order["total_price"], item["price"])
            self.assertEqual(snapshot["unit_total_price"], snapshot["unit_supply_price"] + snapshot["unit_vat"])
            self.assertEqual(reservation["quantity"], item["quantity"])
            if order["status"] == "CONFIRMED":
                self.assertEqual(reservation["status"], "CONSUMED")
                self.assertLess(order["placed_at"], reservation["consumed_at"])
                self.assertLess(reservation["consumed_at"], reservation["expires_at"])
            else:
                self.assertEqual(reservation["status"], "RELEASED")
                self.assertEqual(reservation["released_at"], order["cancelled_at"])
        for attempt in self.rows["payment_attempts"]:
            order = orders[attempt["order_id"]]
            self.assertEqual(attempt["requested_amount"], order["total_price"])
            self.assertGreaterEqual(attempt["created_at"], order["placed_at"])
            succeeded = [row for row in transactions[attempt["id"]] if row["status"] == "SUCCEEDED"]
            capture = sum(row["amount"] for row in succeeded if row["type"] == "CAPTURE")
            refunded = sum(row["amount"] for row in succeeded if row["type"] == "REFUND")
            self.assertLessEqual(refunded, capture)
            if attempt["status"] == "REFUNDED":
                self.assertEqual(refunded, capture)
                self.assertEqual(order["status"], "CONFIRMED")
            elif attempt["status"] == "PARTIALLY_REFUNDED":
                self.assertTrue(0 < refunded < capture)
            for transaction in transactions[attempt["id"]]:
                self.assertGreaterEqual(transaction["processed_at"], attempt["created_at"])
                self.assertLess(transaction["processed_at"], timestamp(END_SECOND))
                if transaction["type"] == "REFUND":
                    self.assertGreater(transaction["processed_at"], attempt["captured_at"])

    def test_stock_ledger_signup_and_checkout_timing(self):
        stock = {product["id"]: 1_000_000 for product in self.products}
        for movement in self.rows["inventory_movements"]:
            stock[movement["item_id"]] += movement["quantity_delta"]
            self.assertGreaterEqual(stock[movement["item_id"]], 0)
            self.assertEqual(stock[movement["item_id"]], movement["stock_after"])
        self.assertEqual(stock, self.builder.stock)
        self.assertNotIn("SALE", {row["type"] for row in self.rows["inventory_movements"]})
        orders = {row["id"]: row for row in self.rows["orders"]}
        signup = {user["id"]: timestamp(user["created_day"] * 86_400) for user in self.users}
        for link in self.rows["rec_checkout_orders"]:
            order = orders[link["order_id"]]
            _, cart_at = self.cart_events[link["cart_event_id"]]
            self.assertGreaterEqual(order["placed_at"], cart_at)
            self.assertGreaterEqual(order["placed_at"], signup[order["member_id"]])

    def test_migrations_reject_nonliteral_or_dynamic_operations(self):
        schema, hashes = application_schema()
        self.assertEqual(len(hashes), 4)
        self.assertIn("create table `orders`", schema)
        self.assertIn("create table `catalog_maintenance`", schema)
        self.assertNotIn("drop table", schema)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "MigrationBad.ts"
            path.write_text("override up(): void {\n        this.addSql(`SELECT ${process.env.PASSWORD}`);\n    }\n")
            with self.assertRaises(ValueError):
                application_schema(directory)
            path.write_text("override up(): void {\n        customOperation();\n    }\n")
            with self.assertRaises(ValueError):
                application_schema(directory)

    def test_reproducible_sql_source_checksum_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            generate_events("smoke", 42, source)
            left = generate(source, base / "first")
            right = generate(source, base / "second")
            self.assertEqual(left["sql_sha256"], right["sql_sha256"])
            with self.assertRaises(FileExistsError):
                generate(source, base / "first")
            with gzip.open(base / "first" / "commerce.sql.gz", "rt", encoding="utf-8") as stream:
                sql = stream.read()
            self.assertIn("CHECK (source_valid=1)", sql)
            self.assertLess(sql.index("INSERT INTO rec_commerce_dataset"), sql.index("create table `members`"))
            self.assertIn("is_complete=TRUE WHERE id=1;\nCOMMIT;", sql)
            self.assertNotIn("FOREIGN_KEY_CHECKS", sql)
            self.assertNotIn("drop table", sql.lower())
            self.assertNotIn("truncate ", sql.lower())
            (source / "dataset.sql.gz").write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "checksum"):
                read_dataset(source)


if __name__ == "__main__":
    unittest.main()
