import gzip
import io
import json
import tempfile
import unittest
from pathlib import Path

from recommender.generate_sql import event_rows, generate, sql_value, write_inserts


class SqlTests(unittest.TestCase):
    def test_literal_quotes_and_backslashes(self):
        self.assertEqual(sql_value("O'Reilly\\키보드"), "'O''Reilly\\키보드'")
        self.assertEqual(sql_value(None), "NULL")

    def test_insert_batches_and_timestamp_boundary(self):
        stream = io.StringIO()
        write_inserts(stream, "example", ("id",), ((i,) for i in range(1001)))
        self.assertEqual(stream.getvalue().count("INSERT INTO"), 2)
        row = list(event_rows(89, [(1, 1, 1, 1, "view", 86_399)]))[0]
        self.assertEqual(row[-1], "2026-03-31 23:59:59")

    def test_seeded_sql_and_overwrite_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first"
            second = Path(directory) / "second"
            left = generate("smoke", 42, first)
            right = generate("smoke", 42, second)
            self.assertEqual(left["sql_sha256"], right["sql_sha256"])
            self.assertEqual(left["actual_events"], right["actual_events"])
            self.assertTrue(2000 <= left["actual_events"] <= 2360)
            with self.assertRaises(FileExistsError):
                generate("smoke", 43, first)
            with gzip.open(first / "dataset.sql.gz", "rt", encoding="utf-8") as stream:
                sql = stream.read()
            self.assertIn("NO_BACKSLASH_ESCAPES", sql)
            self.assertIn("CREATE TABLE rec_events", sql)
            self.assertIn("is_complete=TRUE", sql)
            self.assertIn("is_complete=TRUE WHERE id=1;\nCOMMIT;", sql)
            self.assertNotIn("DROP ", sql)
            self.assertNotIn("TRUNCATE ", sql)
            self.assertNotIn("preferred_tags", sql)
            self.assertNotIn("activity_weight", sql)
            manifest = json.loads((first / "manifest.json").read_text())
            self.assertEqual(manifest["sql_sha256"], left["sql_sha256"])


if __name__ == "__main__":
    unittest.main()
