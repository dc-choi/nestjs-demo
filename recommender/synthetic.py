"""Deterministic synthetic populations and one-day-at-a-time journeys."""

import bisect
import random
from datetime import date, timedelta
from itertools import accumulate

from .catalog import BRAND_TAGS, CATEGORIES, CATEGORY_WEIGHTS, GROUPS, PRICE_TAGS, allocate_counts


DAYS = 90
START_DATE = date(2026, 1, 1)
ACTIVITY_TYPES = ("inactive", "light", "regular", "frequent")
ACTIVITY_WEIGHTS = (0, 0.5, 2, 8)


def _positive_integer(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


def _preferred_tags(rng, category):
    return rng.sample(CATEGORIES[category][1] + CATEGORIES[category][2], 2)


def build_population(seed: int, user_count: int, product_count: int):
    """Return public catalog rows and private, immutable-during-generation profiles."""
    _positive_integer(user_count, "user_count")
    _positive_integer(product_count, "product_count")
    rng = random.Random(seed)
    category_counts = []
    for count in allocate_counts(product_count, [weight for _, weight in GROUPS]):
        category_counts.extend(allocate_counts(count, [1] * 5))
    if min(category_counts) < 1 or max(category_counts) > 960:
        raise ValueError("product allocation must give each category between 1 and 960 products")

    products = []
    for category_index, count in enumerate(category_counts):
        category, usages, features = CATEGORIES[category_index]
        for combination in rng.sample(range(960), count):
            combination, feature = divmod(combination, 4)
            combination, usage = divmod(combination, 4)
            price, brand = divmod(combination, 20)
            tags = [PRICE_TAGS[price], BRAND_TAGS[brand], usages[usage], features[feature]]
            product_id = len(products) + 1
            products.append({
                "id": product_id,
                "key": f"rec-product-{product_id:06d}",
                "name": f"{tags[1]} {tags[0]} {tags[2]} {tags[3]} {category}",
                "group": GROUPS[category_index // 5][0],
                "category": category,
                "category_index": category_index,
                "tags": tags,
            })

    activities = [index for index, count in enumerate(allocate_counts(user_count, [5, 60, 30, 5]))
                  for _ in range(count)]
    signup_groups = [index for index, count in enumerate(allocate_counts(user_count, [80, 10, 5, 5]))
                     for _ in range(count)]
    rng.shuffle(activities)
    rng.shuffle(signup_groups)
    category_cumulative = list(accumulate(CATEGORY_WEIGHTS))
    users = []
    for index, (activity, signup_group) in enumerate(zip(activities, signup_groups)):
        primary = bisect.bisect_right(category_cumulative, rng.random() * category_cumulative[-1])
        secondary = primary
        while secondary == primary:
            secondary = bisect.bisect_right(category_cumulative, rng.random() * category_cumulative[-1])
        created_day = 0
        if signup_group:
            first, last = ((1, 59), (60, 74), (75, 89))[signup_group - 1]
            created_day = rng.randint(first, last)
        users.append({
            "id": index + 1,
            "key": f"rec-user-{index + 1:06d}",
            "created_day": created_day,
            "signup_group": signup_group,
            "activity_type": ACTIVITY_TYPES[activity],
            "activity_weight": ACTIVITY_WEIGHTS[activity],
            "primary": primary,
            "secondary": secondary,
            "preferred_tags": _preferred_tags(rng, primary),
        })

    eligible = [user for user in users if user["created_day"] < 60 and user["activity_weight"] > 0]
    for user in rng.sample(eligible, len(eligible) // 5):
        primary = rng.randrange(19)
        if primary >= user["primary"]:
            primary += 1
        user["drift_day"] = 60
        user["drift_primary"] = primary
        user["drift_preferred_tags"] = _preferred_tags(rng, primary)
    return products, users


def generate_days(products, users, seed: int, target_events: int, stats: dict):
    """Yield (UTC day index, sorted event tuples) without retaining past days.

    Events contain (event_id, journey_id, user_id, product_id, type, second).
    Private profiles and all input rows remain unchanged.
    """
    _positive_integer(target_events, "target_events")
    if not products or not users:
        raise ValueError("products and users must not be empty")
    category_products = [[] for _ in CATEGORIES]
    product_tags = []
    product_categories = []
    for product_id, product in enumerate(products, 1):
        category = product["category_index"]
        if product["id"] != product_id or not 0 <= category < len(CATEGORIES):
            raise ValueError("products must have contiguous IDs and valid categories")
        category_products[category].append(product_id)
        product_categories.append(category)
        product_tags.append(frozenset(product["tags"]))
    if any(not members for members in category_products):
        raise ValueError("each category requires at least one product")

    arrivals = [[] for _ in range(DAYS)]
    profiles = []
    drifted_profiles = []
    weight_arrivals = [0.0] * DAYS
    for user_id, user in enumerate(users, 1):
        day = user["created_day"]
        weight = user["activity_weight"]
        primary, secondary = user["primary"], user["secondary"]
        if (user["id"] != user_id or not 0 <= day < DAYS or
                not 0 <= primary < len(CATEGORIES) or not 0 <= secondary < len(CATEGORIES) or
                primary == secondary or weight not in ACTIVITY_WEIGHTS or
                len(user["preferred_tags"]) != 2 or len(set(user["preferred_tags"])) != 2):
            raise ValueError("invalid private user profile")
        profile = (primary, secondary, tuple(user["preferred_tags"]))
        profiles.append(profile)
        if "drift_primary" in user:
            if (day >= 60 or weight == 0 or user.get("drift_day") != 60 or
                    user["drift_primary"] == primary or not 0 <= user["drift_primary"] < len(CATEGORIES) or
                    len(user["drift_preferred_tags"]) != 2 or len(set(user["drift_preferred_tags"])) != 2):
                raise ValueError("invalid drift profile")
            profile = (user["drift_primary"], primary, tuple(user["drift_preferred_tags"]))
        drifted_profiles.append(profile)
        if weight:
            arrivals[day].append((user_id, weight))
            weight_arrivals[day] += weight

    daily_weights = [weight * (1.25 if (START_DATE + timedelta(days=day)).weekday() >= 5 else 1)
                     for day, weight in enumerate(accumulate(weight_arrivals))]
    if not any(daily_weights):
        raise ValueError("at least one eligible active user is required")
    budgets = allocate_counts(target_events, daily_weights)
    rng = random.Random(seed)
    popular_products = list(range(1, len(products) + 1))
    rng.shuffle(popular_products)
    popularity_cumulative = list(accumulate(1 / rank ** 1.1 for rank in range(1, len(products) + 1)))
    event_types = {"view": 0, "cart": 0, "purchase": 0}
    routes = {"revisit": 0, "taste": 0, "popularity": 0, "random": 0}
    conversions = {level: {"journeys": 0, "cart": 0, "purchase": 0} for level in ("high", "medium", "low")}
    user_event_counts = [0] * (len(users) + 1)
    product_event_counts = [0] * (len(products) + 1)
    stats.update({
        "daily_budgets": budgets, "daily_actuals": [], "events": 0, "journeys": 0,
        "event_types": event_types, "routes": routes, "conversions": conversions,
        "user_event_counts": user_event_counts, "product_event_counts": product_event_counts,
        "popularity_product_ids": popular_products,
    })
    recent_products = {}
    active_users = []
    active_cumulative = []
    total_weight = 0.0
    journey_id = 0
    event_id = 0
    for day, budget in enumerate(budgets):
        for user_id, weight in arrivals[day]:
            active_users.append(user_id)
            total_weight += weight
            active_cumulative.append(total_weight)
        current_profiles = profiles if day < 60 else drifted_profiles
        journeys = []
        daily_count = 0
        while daily_count < budget:
            user_id = active_users[bisect.bisect_right(active_cumulative, rng.random() * total_weight)]
            primary, secondary, preferred_tags = current_profiles[user_id - 1]
            recent = recent_products.get(user_id)
            if recent and rng.random() < 0.15:
                product_id = rng.choice(recent)
                route = "revisit"
            else:
                route_draw = rng.random()
                if route_draw < 0.7:
                    route = "taste"
                    category_draw = rng.random()
                    if category_draw < 0.6:
                        category = primary
                    elif category_draw < 0.85:
                        category = secondary
                    else:
                        category = rng.randrange(18)
                        for excluded in sorted((primary, secondary)):
                            if category >= excluded:
                                category += 1
                    candidates = category_products[category]
                    while True:
                        product_id = rng.choice(candidates)
                        tags = product_tags[product_id - 1]
                        matches = (preferred_tags[0] in tags) + (preferred_tags[1] in tags)
                        if rng.random() * 5 < 1 + 2 * matches:
                            break
                elif route_draw < 0.9:
                    route = "popularity"
                    rank = bisect.bisect_right(popularity_cumulative, rng.random() * popularity_cumulative[-1])
                    product_id = popular_products[rank]
                else:
                    route = "random"
                    product_id = rng.randint(1, len(products))
            routes[route] += 1
            if recent is None:
                recent = []
                recent_products[user_id] = recent
            if product_id in recent:
                recent.remove(product_id)
            elif len(recent) == 20:
                recent.pop(0)
            recent.append(product_id)

            tags = product_tags[product_id - 1]
            matches = (preferred_tags[0] in tags) + (preferred_tags[1] in tags)
            category = product_categories[product_id - 1]
            if category == primary or matches == 2:
                level, cart_probability, purchase_probability = "high", 0.22, 0.35
            elif category == secondary or matches == 1:
                level, cart_probability, purchase_probability = "medium", 0.12, 0.20
            else:
                level, cart_probability, purchase_probability = "low", 0.04, 0.08
            repeat_draw = rng.random()
            repeats = 0
            if repeat_draw >= 0.95:
                repeats = 2
            elif repeat_draw >= 0.8:
                repeats = 1
            has_cart = rng.random() < cart_probability
            has_purchase = has_cart and rng.random() < purchase_probability
            offsets = [0]
            for _ in range(repeats):
                offsets.append(offsets[-1] + rng.randint(10, 120))
            if has_cart:
                offsets.append(offsets[-1] + rng.randint(60, 600))
            if has_purchase:
                offsets.append(offsets[-1] + rng.randint(60, 1800))
            journey_id += 1
            journeys.append((journey_id, user_id, product_id, repeats, offsets))
            daily_count += len(offsets)
            event_types["view"] += 1 + repeats
            event_types["cart"] += has_cart
            event_types["purchase"] += has_purchase
            conversions[level]["journeys"] += 1
            conversions[level]["cart"] += has_cart
            conversions[level]["purchase"] += has_purchase
            user_event_counts[user_id] += len(offsets)
            product_event_counts[product_id] += len(offsets)

        starts = sorted(rng.randint(0, 83699) for _ in journeys)
        events = []
        for start, (path_id, user_id, product_id, repeats, offsets) in zip(starts, journeys):
            for index, offset in enumerate(offsets):
                event_type = "view"
                if index == repeats + 1:
                    event_type = "cart"
                elif index == repeats + 2:
                    event_type = "purchase"
                event_id += 1
                events.append((event_id, path_id, user_id, product_id, event_type, start + offset))
        events.sort(key=lambda event: (event[5], event[0]))
        stats["daily_actuals"].append(len(events))
        stats["events"] += len(events)
        stats["journeys"] += len(journeys)
        del journeys, starts
        yield day, events
        del events
