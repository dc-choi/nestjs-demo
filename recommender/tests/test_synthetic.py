import copy
import unittest
from collections import Counter, defaultdict

from recommender.catalog import CATEGORIES, GROUPS, allocate_counts
from recommender.synthetic import build_population, generate_days


class PopulationTests(unittest.TestCase):
    def test_largest_remainder_preserves_total_and_table_ties(self):
        self.assertEqual(allocate_counts(3, [1, 1, 1, 1]), [1, 1, 1, 0])
        self.assertEqual(allocate_counts(7, [0.3, 0.25, 0.25, 0.2]), [2, 2, 2, 1])
        self.assertEqual(allocate_counts(0, [1, 2]), [0, 0])
        for total, weights in ((-1, [1]), (2, []), (2, [0]), (2, [-1, 2])):
            with self.subTest(total=total, weights=weights), self.assertRaises(ValueError):
                allocate_counts(total, weights)

    def test_population_allocation_attributes_and_unique_combinations(self):
        products, users = build_population(17, 1000, 1000)
        self.assertEqual(Counter(product["category_index"] for product in products),
                         dict(enumerate([60] * 5 + [50] * 10 + [40] * 5)))
        self.assertEqual(Counter(user["activity_type"] for user in users),
                         {"inactive": 50, "light": 600, "regular": 300, "frequent": 50})
        self.assertEqual(Counter(user["signup_group"] for user in users), {0: 800, 1: 100, 2: 50, 3: 50})
        signatures = set()
        for product in products:
            category = product["category_index"]
            name, usages, features = CATEGORIES[category]
            self.assertEqual(product["key"], "rec-product-%06d" % product["id"])
            self.assertEqual(product["category"], name)
            self.assertEqual(product["group"], GROUPS[category // 5][0])
            self.assertEqual(len(product["tags"]), 4)
            self.assertIn(product["tags"][2], usages)
            self.assertIn(product["tags"][3], features)
            self.assertIn(name, product["name"])
            signatures.add((category, tuple(product["tags"])))
        self.assertEqual(len(signatures), len(products))
        signup_ranges = ((0, 0), (1, 59), (60, 74), (75, 89))
        for user in users:
            low, high = signup_ranges[user["signup_group"]]
            self.assertTrue(low <= user["created_day"] <= high)
            self.assertNotEqual(user["primary"], user["secondary"])
            self.assertEqual(len(set(user["preferred_tags"])), 2)
            self.assertTrue(set(user["preferred_tags"]) <= set(sum(CATEGORIES[user["primary"]][1:], ())))

    def test_drift_selects_exact_eligible_count_and_preserves_initial_profile(self):
        _, users = build_population(31, 1000, 100)
        eligible = [user for user in users if user["created_day"] < 60 and user["activity_weight"] > 0]
        drifters = [user for user in users if "drift_primary" in user]
        self.assertEqual(len(drifters), len(eligible) // 5)
        for user in drifters:
            self.assertLess(user["created_day"], 60)
            self.assertGreater(user["activity_weight"], 0)
            self.assertEqual(user["drift_day"], 60)
            self.assertNotEqual(user["primary"], user["drift_primary"])
            allowed = set(sum(CATEGORIES[user["drift_primary"]][1:], ()))
            self.assertEqual(len(set(user["drift_preferred_tags"])), 2)
            self.assertTrue(set(user["drift_preferred_tags"]) <= allowed)

    def test_invalid_counts_fail_before_generating(self):
        for users, products in ((0, 100), (-1, 100), (10, 0), (10, 20), (10, 16001), (True, 100)):
            with self.subTest(users=users, products=products), self.assertRaises(ValueError):
                build_population(1, users, products)


class EventTests(unittest.TestCase):
    def setUp(self):
        self.products, self.users = build_population(53, 100, 100)

    def test_seeded_reproduction_and_population_is_not_mutated(self):
        before = copy.deepcopy((self.products, self.users))
        first_stats, second_stats = {}, {}
        first = list(generate_days(self.products, self.users, 53, 1200, first_stats))
        second = list(generate_days(self.products, self.users, 53, 1200, second_stats))
        self.assertEqual(first, second)
        self.assertEqual(first_stats, second_stats)
        self.assertEqual(before, (self.products, self.users))
        self.assertEqual(before, build_population(53, 100, 100))
        self.assertNotEqual(first, list(generate_days(self.products, self.users, 54, 1200, {})))

    def test_complete_chronological_journeys_references_and_budgets(self):
        stats = {}
        days = list(generate_days(self.products, self.users, 53, 2000, stats))
        all_ids, all_paths = set(), set()
        total = 0
        event_types = Counter()
        first_view_by_path = {}
        for expected_day, (day, events) in enumerate(days):
            self.assertEqual(day, expected_day)
            self.assertEqual(events, sorted(events, key=lambda event: (event[5], event[0])))
            self.assertTrue(stats["daily_budgets"][day] <= len(events) <= stats["daily_budgets"][day] + 4)
            paths = defaultdict(list)
            for event in events:
                self.assertEqual(len(event), 6)
                event_id, path_id, user_id, product_id, event_type, second = event
                self.assertNotIn(event_id, all_ids)
                all_ids.add(event_id)
                self.assertTrue(1 <= user_id <= len(self.users))
                self.assertTrue(1 <= product_id <= len(self.products))
                self.assertLessEqual(self.users[user_id - 1]["created_day"], day)
                self.assertGreater(self.users[user_id - 1]["activity_weight"], 0)
                self.assertTrue(0 <= second < 86400)
                self.assertIn(event_type, ("view", "cart", "purchase"))
                event_types[event_type] += 1
                paths[path_id].append(event)
            for path_id, events_in_path in paths.items():
                self.assertNotIn(path_id, all_paths)
                all_paths.add(path_id)
                first = events_in_path[0]
                self.assertEqual(first[4], "view")
                self.assertLessEqual(first[5], 83699)
                first_view_by_path[path_id] = (day, first[5])
                self.assertTrue(1 <= len(events_in_path) <= 5)
                self.assertEqual(len({event[2:4] for event in events_in_path}), 1)
                kinds = [event[4] for event in events_in_path]
                views = kinds.count("view")
                self.assertTrue(1 <= views <= 3)
                expected = ["view"] * views
                if "cart" in kinds:
                    expected.append("cart")
                    if "purchase" in kinds:
                        expected.append("purchase")
                self.assertEqual(kinds, expected)
                for previous, event in zip(events_in_path, events_in_path[1:]):
                    gap = event[5] - previous[5]
                    low, high = {"view": (10, 120), "cart": (60, 600), "purchase": (60, 1800)}[event[4]]
                    self.assertTrue(low <= gap <= high)
            total += len(events)
        self.assertEqual(len(days), 90)
        self.assertEqual(sum(stats["daily_budgets"]), 2000)
        self.assertTrue(2000 <= total <= 2360)
        self.assertEqual(all_ids, set(range(1, total + 1)))
        self.assertEqual(all_paths, set(range(1, len(all_paths) + 1)))
        self.assertEqual(list(first_view_by_path[path] for path in sorted(first_view_by_path)),
                         sorted(first_view_by_path.values()))
        self.assertEqual(stats["events"], total)
        self.assertEqual(stats["journeys"], len(all_paths))
        self.assertEqual(stats["event_types"], dict(event_types))
        self.assertEqual(sum(stats["routes"].values()), len(all_paths))
        self.assertEqual(sum(stats["user_event_counts"]), total)
        self.assertEqual(sum(stats["product_event_counts"]), total)

    def test_conversion_levels_use_drift_only_from_day_60(self):
        stats = {}
        observed = {level: Counter(journeys=0, cart=0, purchase=0) for level in ("high", "medium", "low")}
        seen = set()
        for day, events in generate_days(self.products, self.users, 53, 12000, stats):
            for _, path_id, user_id, product_id, kind, _ in events:
                user, product = self.users[user_id - 1], self.products[product_id - 1]
                primary, secondary, tags = user["primary"], user["secondary"], user["preferred_tags"]
                if day >= 60 and "drift_primary" in user:
                    primary, secondary = user["drift_primary"], primary
                    tags = user["drift_preferred_tags"]
                matches = len(set(tags) & set(product["tags"]))
                if product["category_index"] == primary or matches == 2:
                    level = "high"
                elif product["category_index"] == secondary or matches == 1:
                    level = "medium"
                else:
                    level = "low"
                if path_id not in seen:
                    observed[level]["journeys"] += 1
                    seen.add(path_id)
                if kind in ("cart", "purchase"):
                    observed[level][kind] += 1
        self.assertEqual(stats["conversions"], observed)

    def test_daily_budget_uses_eligible_activity_and_weekend_weight(self):
        users = copy.deepcopy(self.users[:2])
        for user in users:
            user.update(primary=0, secondary=1, preferred_tags=["사무", "무선"])
            for key in ("drift_day", "drift_primary", "drift_preferred_tags"):
                user.pop(key, None)
        users[0].update(created_day=0, activity_weight=0.5)
        users[1].update(created_day=60, activity_weight=2)
        stats = {}
        list(generate_days(self.products, users, 53, 1000, stats))
        weights = [(0.5 if day < 60 else 2.5) * (1.25 if day % 7 in (2, 3) else 1)
                   for day in range(90)]
        self.assertEqual(stats["daily_budgets"], allocate_counts(1000, weights))

    def test_invalid_event_population_and_target(self):
        for target in (0, -1, True):
            with self.subTest(target=target), self.assertRaises(ValueError):
                list(generate_days(self.products, self.users, 1, target, {}))
        with self.assertRaises(ValueError):
            list(generate_days([], self.users, 1, 100, {}))
        inactive = copy.deepcopy(self.users)
        for user in inactive:
            user["activity_weight"] = 0
            for key in ("drift_day", "drift_primary", "drift_preferred_tags"):
                user.pop(key, None)
        with self.assertRaises(ValueError):
            list(generate_days(self.products, inactive, 1, 100, {}))


if __name__ == "__main__":
    unittest.main()
