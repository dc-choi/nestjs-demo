"""Commerce fixtures that follow the application's order/payment state transitions."""

import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import timedelta

from .generate_sql import START


END_SECOND = 90 * 86_400
PROVIDER = "SYNTHETIC"
EMPTY_OPTIONS_SIGNATURE = hashlib.sha256(b"").hexdigest()


def timestamp(second):
    return (START + timedelta(seconds=second)).strftime("%Y-%m-%d %H:%M:%S")


def json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def item_price(product):
    """Integer KRW prices keep all monetary arithmetic exact before SQL serialization."""
    base = {"budget": 5_000, "standard": 20_000, "premium": 80_000}[product["tags"][0]]
    supply = base + (product["id"] % 50) * 100
    vat = 0 if product["group"] == "식품" else supply // 10
    return supply, vat, supply + vat


def sku(product_id):
    return "SYNTH-SKU-{:06d}".format(product_id)


class CommerceBuilder:
    """Keep only population-sized stock state and one day's order rows in memory."""

    def __init__(self, products, seed, initial_stock):
        self.products = {product["id"]: product for product in products}
        self.rng = random.Random(seed ^ 0xC011E2CE)
        self.stock = {product["id"]: initial_stock for product in products}
        self.initial_stock = initial_stock
        self.ids = Counter()
        self.counts = Counter()

    def next_id(self, table):
        self.ids[table] += 1
        return self.ids[table]

    def build_day(self, day, events):
        carts = {}
        purchases = {}
        for event in events:
            if event[4] == "cart":
                carts[event[1]] = event
            elif event[4] == "purchase":
                purchases[event[1]] = event
        checkouts = []
        for journey_id, cart in carts.items():
            purchase = purchases.get(journey_id)
            if purchase is None and self.rng.random() >= 0.1:
                continue
            cart_second = day * 86_400 + cart[5]
            captured = day * 86_400 + purchase[5] if purchase else None
            placed = max(cart_second, captured - self.rng.randint(30, 600)) if purchase else cart_second
            checkouts.append((placed, cart[0], cart, purchase, captured))
        rows = defaultdict(list)
        movements = []
        for placed, _, cart, purchase, captured in sorted(checkouts):
            self.add_checkout(rows, movements, day, placed, cart, purchase, captured)
        for second, order_id, product_id, quantity, kind in sorted(movements):
            self.stock[product_id] += quantity
            if self.stock[product_id] < 0:
                raise ValueError("generated inventory became negative")
            movement_id = self.next_id("inventory_movements")
            rows["inventory_movements"].append({
                "id": movement_id, "type": kind, "quantity_delta": quantity,
                "stock_after": self.stock[product_id], "item_sku": sku(product_id),
                "idempotency_key": "synth:{}:{}".format(kind.lower(), order_id),
                "reference_type": "ORDER" if kind == "RESERVATION" else "INVENTORY_RESERVATION",
                "reference_id": self.order_number(order_id) if kind == "RESERVATION" else str(order_id),
                "reason": None if kind == "RESERVATION" else "RELEASED",
                "created_at": timestamp(second), "item_id": product_id,
            })
        return rows

    @staticmethod
    def order_number(order_id):
        return "SYNTH-ORDER-{:09d}".format(order_id)

    def add_checkout(self, rows, movements, day, placed, cart, purchase, captured):
        order_id = self.next_id("orders")
        product_id, user_id = cart[3], cart[2]
        product = self.products[product_id]
        quantity = self.rng.choices((1, 2, 3), (80, 15, 5))[0]
        supply, vat, unit_total = item_price(product)
        amount = unit_total * quantity
        cancelled = None if purchase else min(placed + self.rng.randint(60, 600), (day + 1) * 86_400 - 1)
        final_time = captured if purchase else cancelled
        order_number = self.order_number(order_id)
        rows["orders"].append({
            "id": order_id, "order_number": order_number,
            "idempotency_key": "synth:order:{}".format(order_id),
            "request_fingerprint": hashlib.sha256(json_text({"items": [[str(product_id), quantity]]}).encode()).hexdigest(),
            "status": "CONFIRMED" if purchase else "CANCELLED", "currency_code": "KRW", "total_price": amount,
            "placed_at": timestamp(placed), "cancelled_at": timestamp(cancelled) if cancelled is not None else None,
            "completed_at": None, "created_at": timestamp(placed), "updated_at": timestamp(final_time),
            "member_id": user_id,
        })
        rows["order_items"].append({
            "id": order_id, "price": amount, "quantity": quantity,
            "created_at": timestamp(placed), "item_id": product_id, "order_id": order_id,
        })
        rows["order_item_snapshots"].append({
            "order_item_id": order_id, "product_name": product["name"], "item_name": "기본 상품",
            "item_sku": sku(product_id), "product_description": None, "product_return_policy": None,
            "unit_supply_price": supply, "unit_vat": vat, "unit_total_price": unit_total,
            "is_tax_free": int(vat == 0), "selected_options": "[]", "source_product_id": product_id,
            "source_item_id": product_id, "source_product_revision": 1, "created_at": timestamp(placed),
        })
        rows["inventory_reservations"].append({
            "id": order_id, "quantity": quantity, "status": "CONSUMED" if purchase else "RELEASED",
            "expires_at": timestamp(placed + 900), "consumed_at": timestamp(captured) if purchase else None,
            "released_at": timestamp(cancelled) if cancelled is not None else None,
            "created_at": timestamp(placed), "updated_at": timestamp(final_time), "order_item_id": order_id,
        })
        movements.append((placed, order_id, product_id, -quantity, "RESERVATION"))
        if cancelled is not None:
            movements.append((cancelled, order_id, product_id, quantity, "RELEASE"))
        self.add_history(rows, order_id, None, "PENDING", placed, "MEMBER", str(user_id), None)
        self.add_history(rows, order_id, "PENDING", "CONFIRMED" if purchase else "CANCELLED", final_time,
                         "PROVIDER" if purchase else "MEMBER", PROVIDER if purchase else str(user_id),
                         "PAYMENT_CAPTURED" if purchase else "CUSTOMER_REQUEST")
        rows["rec_checkout_orders"].append({"cart_event_id": cart[0], "order_id": order_id})
        self.counts["orders"] += 1
        if purchase:
            if self.rng.random() < 0.08:
                self.add_attempt(rows, order_id, amount, "FAILED", placed + 1, placed + 2)
                self.counts["retried_orders"] += 1
            refund_draw = self.rng.random()
            refund_second = captured + self.rng.randint(3_600, 7 * 86_400)
            refund_kind = None
            if refund_draw < 0.02:
                refund_kind = "REFUNDED"
            elif refund_draw < 0.06:
                refund_kind = "PARTIALLY_REFUNDED"
            if refund_kind and refund_second >= END_SECOND:
                self.counts["censored_refunds"] += 1
                refund_kind = None
            status = refund_kind or "CAPTURED"
            attempt_id = self.add_attempt(rows, order_id, amount, status, placed + 3, captured,
                                          refund_second if refund_kind else None)
            capture_id = self.add_transaction(rows, attempt_id, "CAPTURE", "SUCCEEDED", amount, captured)
            rows["rec_purchase_orders"].append({
                "event_id": purchase[0], "order_item_id": order_id, "capture_transaction_id": capture_id,
            })
            if refund_kind:
                refund_amount = amount if refund_kind == "REFUNDED" else amount // 2
                self.add_transaction(rows, attempt_id, "REFUND", "SUCCEEDED", refund_amount, refund_second)
                self.counts[refund_kind.lower()] += 1
            self.counts["purchases"] += 1
        else:
            failed = self.rng.random() < 0.5
            self.add_attempt(rows, order_id, amount, "FAILED" if failed else "CANCELLED", placed + 1,
                             placed + 10 if failed else cancelled)
            self.counts["failed_orders" if failed else "cancelled_orders"] += 1

    def add_history(self, rows, order_id, previous, status, second, actor, actor_id, reason):
        rows["order_status_histories"].append({
            "id": self.next_id("order_status_histories"), "from_status": previous, "to_status": status,
            "reason": reason, "actor_type": actor, "actor_id": actor_id,
            "request_id": None if previous is None else "synth:transition:{}".format(order_id),
            "created_at": timestamp(second), "order_id": order_id,
        })

    def add_attempt(self, rows, order_id, amount, status, created, processed, refunded=None):
        attempt_id = self.next_id("payment_attempts")
        captured = status in ("CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED")
        failed = status == "FAILED"
        rows["payment_attempts"].append({
            "id": attempt_id, "provider": PROVIDER, "method": "CARD", "status": status,
            "requested_amount": amount, "currency_code": "KRW",
            "idempotency_key": "synth:attempt:{}".format(attempt_id),
            "provider_payment_id": "synth-payment-{}".format(attempt_id),
            "error_code": "SYNTHETIC_DECLINED" if failed else None,
            "error_message": "Synthetic payment decline" if failed else None,
            "authorized_at": timestamp(processed) if captured else None,
            "captured_at": timestamp(processed) if captured else None,
            "cancelled_at": timestamp(processed) if status == "CANCELLED" else None,
            "created_at": timestamp(created), "updated_at": timestamp(refunded or processed), "order_id": order_id,
        })
        if failed:
            self.add_transaction(rows, attempt_id, "AUTHORIZE", "FAILED", amount, processed)
        return attempt_id

    def add_transaction(self, rows, attempt_id, kind, status, amount, second):
        transaction_id = self.next_id("payment_transactions")
        succeeded = status == "SUCCEEDED"
        rows["payment_transactions"].append({
            "id": transaction_id, "type": kind, "status": status, "amount": amount,
            "idempotency_key": "synth:transaction:{}".format(transaction_id),
            "provider_transaction_id": "synth-transaction-{}".format(transaction_id) if succeeded else None,
            "error_code": None if succeeded else "SYNTHETIC_DECLINED",
            "error_message": None if succeeded else "Synthetic payment decline",
            "processed_at": timestamp(second), "created_at": timestamp(second), "payment_attempt_id": attempt_id,
        })
        return transaction_id
