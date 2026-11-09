"""Hand-computed checks of aggregate_profiles.sql, each in its own throwaway MySQL database.

Usage: MYSQL_INTEGRATION=1 MYSQL_USER=... MYSQL_PWD=... [MYSQL_BIN=...] \
    python3 -m unittest recommender.tests.test_aggregate_profiles -v
"""
import os
import subprocess
import unittest
import uuid
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "aggregate_profiles.sql"

SCHEMA = """
CREATE TABLE rec_events (event_id BIGINT UNSIGNED PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL, event_type ENUM('view','cart','purchase') NOT NULL,
  occurred_at DATETIME NOT NULL, KEY rec_events_user_time (user_id, occurred_at, product_id));
CREATE TABLE rec_purchase_orders (event_id BIGINT UNSIGNED PRIMARY KEY, capture_transaction_id BIGINT NOT NULL);
CREATE TABLE payment_transactions (id BIGINT PRIMARY KEY, type ENUM('AUTHORIZE','CAPTURE','REFUND','VOID') NOT NULL,
  status ENUM('PENDING','SUCCEEDED','FAILED') NOT NULL, processed_at DATETIME(3) NULL);
CREATE TABLE products (id BIGINT PRIMARY KEY, slug VARCHAR(255) NOT NULL);
CREATE TABLE categories (id BIGINT PRIMARY KEY, is_active BOOLEAN NOT NULL, deleted_at DATETIME NULL);
CREATE TABLE product_categories (product_id BIGINT, category_id BIGINT, PRIMARY KEY (product_id, category_id));
CREATE TABLE product_tags (product_id BIGINT, value VARCHAR(64), PRIMARY KEY (product_id, value));
-- Product 4 has a larger ID but a smaller slug than product 2: the popularity tie must follow the slug.
INSERT INTO products VALUES (1, 'p-b'), (2, 'p-a'), (3, 'p-c'), (4, 'p-0');
-- Category 7 is inactive and 8 is deleted, so neither may receive affinity.
INSERT INTO categories VALUES (5, TRUE, NULL), (6, TRUE, NULL), (7, FALSE, NULL), (8, TRUE, '2026-01-01');
INSERT INTO product_categories VALUES (1, 5), (1, 8), (2, 5), (3, 6), (4, 6), (4, 7);
INSERT INTO product_tags VALUES (1, 'budget'), (1, 'brand-01'), (2, 'premium'), (2, 'brand-01'),
  (3, 'budget'), (3, 'brand-02'), (4, 'standard'), (4, 'brand-02');
INSERT INTO rec_events VALUES
  (1, 1, 1, 'view', '2026-01-10 00:00:00'), (2, 1, 1, 'view', '2026-01-11 00:00:00'),
  (3, 1, 1, 'cart', '2026-01-11 01:00:00'), (4, 1, 1, 'purchase', '2026-01-12 00:00:00'),
  (5, 1, 2, 'view', '2026-01-15 00:00:00'),
  (6, 1, 3, 'view', '2026-02-02 00:00:00'),
  (7, 1, 4, 'view', '2026-01-14 00:00:00'), (8, 1, 4, 'cart', '2026-01-14 01:00:00'),
  (9, 1, 4, 'purchase', '2026-01-14 02:00:00'),
  (10, 2, 2, 'view', '2026-01-20 00:00:00'), (11, 2, 2, 'cart', '2026-01-20 01:00:00'),
  (12, 2, 2, 'purchase', '2026-01-20 02:00:00'),
  (13, 2, 1, 'view', '2026-01-25 00:00:00'), (14, 2, 1, 'cart', '2026-01-25 01:00:00'),
  (15, 2, 1, 'purchase', '2026-01-25 02:00:00'),
  (16, 2, 3, 'view', '2026-01-31 23:00:00'), (17, 2, 3, 'purchase', '2026-01-31 23:59:59'),
  (18, 3, 3, 'view', '2026-01-05 00:00:00'), (19, 3, 3, 'purchase', '2026-01-06 00:00:00'),
  (20, 3, 1, 'view', '2026-01-03 00:00:00'), (21, 3, 1, 'cart', '2026-01-03 01:00:00'),
  (22, 3, 1, 'purchase', '2026-01-03 02:00:00'), (23, 3, 1, 'purchase', '2026-01-20 00:00:00'),
  (24, 5, 2, 'view', '2026-02-03 00:00:00'),
  (25, 3, 2, 'view', '2026-01-08 00:00:00'), (26, 3, 2, 'purchase', '2026-01-08 01:00:00'),
  (27, 6, 3, 'view', '2026-02-01 00:00:00'), (28, 6, 3, 'purchase', '2026-02-01 00:00:00');
-- Event 15: failed capture. 17: captured at the cutoff. 19: no link. 26: a successful AUTHORIZE, not a capture.
-- 28: occurs at the cutoff although its capture is processed earlier.
INSERT INTO payment_transactions VALUES
  (101, 'CAPTURE', 'SUCCEEDED', '2026-01-12 00:00:00'), (102, 'CAPTURE', 'SUCCEEDED', '2026-01-14 02:00:00'),
  (103, 'CAPTURE', 'SUCCEEDED', '2026-01-20 02:00:00'), (104, 'CAPTURE', 'FAILED', '2026-01-25 02:00:00'),
  (105, 'CAPTURE', 'SUCCEEDED', '2026-02-01 00:00:00'), (106, 'CAPTURE', 'SUCCEEDED', '2026-01-03 02:00:00'),
  (107, 'CAPTURE', 'SUCCEEDED', '2026-01-20 00:00:00'), (108, 'AUTHORIZE', 'SUCCEEDED', '2026-01-08 01:00:00'),
  (109, 'CAPTURE', 'SUCCEEDED', '2026-01-31 23:00:00');
INSERT INTO rec_purchase_orders VALUES
  (4, 101), (9, 102), (12, 103), (15, 104), (17, 105), (22, 106), (23, 107), (26, 108), (28, 109);
"""

CHILD_TABLES = ("rec_user_category_affinity", "rec_user_tag_affinity", "rec_user_purchased_products",
                "rec_product_popularity", "rec_profile_checks")


@unittest.skipUnless(os.environ.get("MYSQL_INTEGRATION") == "1", "set MYSQL_INTEGRATION=1 to use local MySQL")
class AggregateProfilesTests(unittest.TestCase):
    def setUp(self):
        self.database = f"rec_profile_fixture_{uuid.uuid4().hex[:12]}"
        self.mysql(f"CREATE DATABASE {self.database} CHARACTER SET utf8mb4", database=None)
        self.addCleanup(self.mysql, f"DROP DATABASE {self.database}", None)
        self.mysql(SCHEMA)

    def mysql(self, sql, database="", check=True, stdin=None):
        command = [os.environ.get("MYSQL_BIN", "mysql"), "-h127.0.0.1", "-u" + os.environ["MYSQL_USER"],
                   "-N", "-B", "--default-character-set=utf8mb4"]
        if database is not None:
            command.append(database or self.database)
        if stdin is None:
            result = subprocess.run(command + ["-e", sql], capture_output=True, text=True)
        else:
            result = subprocess.run(command + ["--force"], input=stdin, capture_output=True, text=True)
        if check and result.returncode != 0:
            self.fail(result.stderr)
        return result

    def aggregate(self, version, cutoff, popularity_cutoff=None, activate=False, force=False):
        params = [f"@profile_version='{version}'", f"@cutoff='{cutoff}'"]
        if popularity_cutoff:
            params.append(f"@popularity_cutoff='{popularity_cutoff}'")
        if activate:
            params.append("@activate=1")
        setup = f"SET {', '.join(params)};"
        if force:
            # `\.` stops at the first error even with --force; stdin with --force keeps going like an
            # interactive `source`, so the SQL guards themselves must stop validation and activation.
            return self.mysql(None, check=False, stdin=f"{setup}\n{SCRIPT.read_text()}")
        return self.mysql(f"{setup} \\. {SCRIPT}", check=False)

    def rows(self, sql):
        return [tuple(line.split("\t")) for line in self.mysql(sql).stdout.splitlines()]

    def versions(self):
        return self.rows("SELECT version, is_active, validated_at IS NOT NULL FROM rec_profile_versions ORDER BY version")

    def child_counts(self, version):
        return self.rows(" UNION ALL ".join(
            f"SELECT COUNT(*) FROM {table} WHERE version = '{version}'" for table in CHILD_TABLES))

    def test_scores_exclusions_and_popularity(self):
        self.assertEqual(self.aggregate("fixture-a", "2026-02-01 00:00:00", activate=True).returncode, 0)
        self.assertEqual(self.rows(
            "SELECT is_active, popularity_cutoff, users_with_history, pairs, purchased_pairs,"
            " verified_purchase_events, unverified_purchase_events, popular_products, max_event_at"
            " FROM rec_profile_versions"
        ), [("1", "2026-02-01 00:00:00", "3", "9", "4", "5", "4", "3", "2026-01-31 23:59:59")])
        # Pair scores: (1,1)=9 with a repeated view, (1,2)=1, (1,4)=9, (2,2)=9, (2,1)=4 failed capture,
        # (2,3)=1 captured at the cutoff, (3,3)=1 unlinked, (3,1)=9 bought twice, (3,2)=1 AUTHORIZE only.
        # Events at or after the cutoff, (1,3), (5,2) and both events of user 6, are ignored.
        self.assertEqual(self.rows(
            "SELECT user_id, category_id, score FROM rec_user_category_affinity ORDER BY user_id, category_id"
        ), [("1", "5", "10"), ("1", "6", "9"), ("2", "5", "13"), ("2", "6", "1"), ("3", "5", "10"), ("3", "6", "1")])
        self.assertEqual(self.rows(
            "SELECT user_id, tag, score FROM rec_user_tag_affinity ORDER BY user_id, tag"
        ), [("1", "brand-01", "10"), ("1", "brand-02", "9"), ("1", "budget", "9"), ("1", "premium", "1"),
            ("1", "standard", "9"), ("2", "brand-01", "13"), ("2", "brand-02", "1"), ("2", "budget", "5"),
            ("2", "premium", "9"), ("3", "brand-01", "10"), ("3", "brand-02", "1"), ("3", "budget", "10"),
            ("3", "premium", "1")])
        self.assertEqual(self.rows(
            "SELECT user_id, product_id FROM rec_user_purchased_products ORDER BY user_id, product_id"
        ), [("1", "1"), ("1", "4"), ("2", "2"), ("3", "1")])
        self.assertEqual(self.rows(
            "SELECT product_id, buyer_count, popularity_rank FROM rec_product_popularity ORDER BY popularity_rank"
        ), [("1", "2", "1"), ("4", "1", "2"), ("2", "1", "3")])
        self.assertEqual(self.rows("SELECT COUNT(*), SUM(violations) FROM rec_profile_checks"), [("8", "0")])

    def test_activation_is_explicit_and_failed_runs_never_switch_versions(self):
        self.assertEqual(self.aggregate("fixture-a", "2026-02-01 00:00:00", activate=True).returncode, 0)
        counts = self.child_counts("fixture-a")
        self.assertEqual(counts, [("6",), ("13",), ("4",), ("3",), ("8",)])

        duplicate = self.aggregate("fixture-a", "2026-03-01 00:00:00", activate=True)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn("Duplicate entry", duplicate.stderr)
        self.aggregate("fixture-a", "2026-03-01 00:00:00", activate=True, force=True)
        self.assertEqual(self.child_counts("fixture-a"), counts)

        empty = self.aggregate("fixture-empty", "2025-01-01 00:00:00", activate=True, force=True)
        self.assertIn("rec_profile_checks_no_violations", empty.stderr)
        self.assertEqual(self.child_counts("fixture-empty"), [("0",)] * 5)
        self.assertEqual(self.versions(), [("fixture-a", "1", "1"), ("fixture-empty", "0", "0")])
        # A run that stopped midway keeps its partial rows. Rerunning its name must not complete or activate it.
        self.mysql("RENAME TABLE product_tags TO product_tags_hidden")
        self.assertNotEqual(self.aggregate("fixture-broken", "2026-02-01 00:00:00", activate=True).returncode, 0)
        self.mysql("RENAME TABLE product_tags_hidden TO product_tags")
        partial = self.child_counts("fixture-broken")
        self.assertEqual(partial, [("6",), ("0",), ("4",), ("0",), ("0",)])
        self.aggregate("fixture-broken", "2026-02-01 00:00:00", activate=True, force=True)
        self.assertEqual(self.child_counts("fixture-broken"), partial)
        self.assertEqual(self.versions(),
                         [("fixture-a", "1", "1"), ("fixture-broken", "0", "0"), ("fixture-empty", "0", "0")])

        # Without @activate=1 a validated version stays inactive.
        self.assertEqual(self.aggregate("fixture-b", "2026-01-13 00:00:00").returncode, 0)
        self.assertEqual(self.versions(), [("fixture-a", "1", "1"), ("fixture-b", "0", "1"),
                                           ("fixture-broken", "0", "0"), ("fixture-empty", "0", "0")])
        self.assertEqual(self.rows(
            "SELECT user_id, product_id FROM rec_user_purchased_products WHERE version = 'fixture-b'"
            " ORDER BY user_id, product_id"
        ), [("1", "1"), ("3", "1")])

        # A rerun owns no existing row: it can neither activate a validated version nor validate an unvalidated one.
        unchanged = [("fixture-a", "1", "1"), ("fixture-b", "0", "1"),
                     ("fixture-broken", "0", "0"), ("fixture-empty", "0", "0")]
        self.aggregate("fixture-b", "2026-01-13 00:00:00", activate=True, force=True)
        self.assertEqual(self.versions(), unchanged)
        self.mysql("UPDATE rec_profile_versions SET validated_at = NULL WHERE version = 'fixture-b'")
        self.aggregate("fixture-b", "2026-01-13 00:00:00", activate=True, force=True)
        self.assertEqual(self.versions(), [("fixture-a", "1", "1"), ("fixture-b", "0", "0"),
                                           ("fixture-broken", "0", "0"), ("fixture-empty", "0", "0")])
        # Without any active version, a rerun of a validated name still activates nothing.
        self.mysql("UPDATE rec_profile_versions SET is_active = FALSE")
        self.aggregate("fixture-a", "2026-02-01 00:00:00", activate=True, force=True)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM rec_profile_versions WHERE is_active"), [("0",)])

        self.assertEqual(self.aggregate("fixture-c", "2026-02-01 00:00:00", activate=True).returncode, 0)
        self.assertEqual(self.versions(), [("fixture-a", "0", "1"), ("fixture-b", "0", "0"),
                                           ("fixture-broken", "0", "0"), ("fixture-c", "1", "1"),
                                           ("fixture-empty", "0", "0")])

        # Documented cleanup of an inactive version cascades to every child table.
        self.mysql("DELETE FROM rec_profile_versions WHERE version = 'fixture-a' AND NOT is_active")
        self.assertEqual(self.child_counts("fixture-a"), [("0",)] * 5)
        self.assertEqual(self.child_counts("fixture-c"), counts)

    def test_popularity_cutoff_is_independent_and_never_later(self):
        # User 7 buys product 3 before the popularity cutoff but is captured exactly at it, and buys product 2
        # exactly at it (captured earlier). Both count for the later profile cutoff, neither for popularity.
        self.mysql("""
            INSERT INTO rec_events VALUES (29, 7, 3, 'view', '2026-01-12 22:00:00'),
              (30, 7, 3, 'purchase', '2026-01-12 23:00:00'), (31, 7, 2, 'view', '2026-01-12 22:30:00'),
              (32, 7, 2, 'purchase', '2026-01-13 00:00:00');
            INSERT INTO payment_transactions VALUES (110, 'CAPTURE', 'SUCCEEDED', '2026-01-13 00:00:00'),
              (111, 'CAPTURE', 'SUCCEEDED', '2026-01-12 23:30:00');
            INSERT INTO rec_purchase_orders VALUES (30, 110), (32, 111);
        """)
        result = self.aggregate("fixture-p", "2026-02-01 00:00:00", popularity_cutoff="2026-01-13 00:00:00")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.rows(
            "SELECT cutoff, popularity_cutoff, is_active, purchased_pairs, popular_products FROM rec_profile_versions"
        ), [("2026-02-01 00:00:00", "2026-01-13 00:00:00", "0", "6", "1")])
        self.assertEqual(self.rows(
            "SELECT product_id FROM rec_user_purchased_products WHERE user_id = 7 ORDER BY product_id"
        ), [("2",), ("3",)])
        # Only events 4 and 22 are captured before the popularity cutoff; both bought product 1.
        self.assertEqual(self.rows(
            "SELECT product_id, buyer_count, popularity_rank FROM rec_product_popularity"
        ), [("1", "2", "1")])

        later = self.aggregate("fixture-q", "2026-01-13 00:00:00", popularity_cutoff="2026-02-01 00:00:00")
        self.assertNotEqual(later.returncode, 0)
        self.assertIn("rec_profile_versions_popularity_cutoff", later.stderr)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM rec_profile_versions WHERE version = 'fixture-q'"), [("0",)])


if __name__ == "__main__":
    unittest.main()
