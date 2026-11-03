-- Read-only checks for the synthetic commerce extension. Every invalid_* count must be 0.
SET time_zone = '+00:00';

SELECT * FROM rec_commerce_dataset;
SELECT 'orders' AS entity, COUNT(*) AS row_count FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'payment_attempts', COUNT(*) FROM payment_attempts
UNION ALL SELECT 'payment_transactions', COUNT(*) FROM payment_transactions
UNION ALL SELECT 'purchase_links', COUNT(*) FROM rec_purchase_orders;
SELECT status, COUNT(*) AS orders FROM orders GROUP BY status;
SELECT status, COUNT(*) AS attempts FROM payment_attempts GROUP BY status;
SELECT type, status, COUNT(*) AS transactions, SUM(amount) AS amount_krw
FROM payment_transactions GROUP BY type, status;

SELECT 'invalid_completion' AS check_name, COUNT(*) AS violations FROM rec_commerce_dataset
WHERE is_complete <> 1 OR actual_orders IS NULL OR actual_purchases IS NULL
   OR actual_orders <> (SELECT COUNT(*) FROM orders)
   OR actual_purchases <> (SELECT COUNT(*) FROM rec_purchase_orders);
SELECT 'invalid_customer_mapping' AS check_name, COUNT(*) AS violations
FROM rec_users u LEFT JOIN members m ON m.id = u.user_id
WHERE m.id IS NULL OR m.role <> 'CUSTOMER' OR m.created_at <> u.created_at;
SELECT 'invalid_catalog_mapping' AS check_name, COUNT(*) AS violations
FROM rec_products r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN items i ON i.id = r.product_id
WHERE p.id IS NULL OR i.id IS NULL OR p.slug <> r.product_key OR p.name <> r.name
   OR i.product_id <> p.id OR p.status <> 'ACTIVE' OR i.sale_status <> 'ALLOW'
   OR i.total_price <> i.supply_price + i.vat;

SELECT 'invalid_order_totals' AS check_name, COUNT(*) AS violations
FROM orders o LEFT JOIN (
    SELECT order_id, SUM(price) AS total FROM order_items GROUP BY order_id
) i ON i.order_id = o.id
WHERE i.order_id IS NULL OR o.total_price <> i.total OR o.total_price <= 0 OR o.currency_code <> 'KRW';

SELECT 'invalid_purchase_links' AS check_name, COUNT(*) AS violations
FROM rec_purchase_orders l
JOIN rec_events e ON e.event_id = l.event_id
JOIN order_items i ON i.id = l.order_item_id
JOIN orders o ON o.id = i.order_id
JOIN items sku ON sku.id = i.item_id
JOIN payment_transactions t ON t.id = l.capture_transaction_id
JOIN payment_attempts a ON a.id = t.payment_attempt_id
WHERE e.event_type <> 'purchase' OR e.user_id <> o.member_id OR e.product_id <> sku.product_id
   OR a.order_id <> o.id OR t.type <> 'CAPTURE' OR t.status <> 'SUCCEEDED'
   OR t.amount <> o.total_price OR t.processed_at <> e.occurred_at
   OR a.captured_at <> t.processed_at OR o.status <> 'CONFIRMED';

SELECT 'invalid_missing_purchase_links' AS check_name, COUNT(*) AS violations
FROM rec_events e LEFT JOIN rec_purchase_orders l ON l.event_id = e.event_id
WHERE e.event_type = 'purchase' AND l.event_id IS NULL;
SELECT 'invalid_unmapped_captures' AS check_name, COUNT(*) AS violations
FROM payment_transactions t LEFT JOIN rec_purchase_orders l ON l.capture_transaction_id = t.id
WHERE t.type = 'CAPTURE' AND t.status = 'SUCCEEDED' AND l.event_id IS NULL;

SELECT 'invalid_snapshots' AS check_name, COUNT(*) AS violations
FROM order_items i LEFT JOIN order_item_snapshots s ON s.order_item_id = i.id
JOIN items sku ON sku.id = i.item_id JOIN products p ON p.id = sku.product_id
WHERE s.order_item_id IS NULL OR i.quantity <= 0
   OR i.price <> s.unit_total_price * i.quantity
   OR s.unit_total_price <> s.unit_supply_price + s.unit_vat
   OR s.source_item_id <> sku.id OR s.source_product_id <> p.id
   OR s.source_product_revision <> p.revision OR s.product_name <> p.name OR s.item_sku <> sku.sku;

SELECT 'invalid_checkout_links' AS check_name, COUNT(*) AS violations
FROM rec_checkout_orders c JOIN rec_events e ON e.event_id = c.cart_event_id
JOIN orders o ON o.id = c.order_id JOIN order_items i ON i.order_id = o.id
JOIN items sku ON sku.id = i.item_id
WHERE e.event_type <> 'cart' OR e.user_id <> o.member_id OR e.product_id <> sku.product_id
   OR o.placed_at < e.occurred_at;
SELECT 'invalid_missing_checkout_links' AS check_name, COUNT(*) AS violations
FROM orders o LEFT JOIN rec_checkout_orders c ON c.order_id = o.id WHERE c.order_id IS NULL;
SELECT 'invalid_purchase_journeys' AS check_name, COUNT(*) AS violations
FROM rec_purchase_orders p JOIN rec_events e ON e.event_id = p.event_id
JOIN order_items i ON i.id = p.order_item_id
JOIN rec_checkout_orders c ON c.order_id = i.order_id JOIN rec_events cart ON cart.event_id = c.cart_event_id
WHERE cart.journey_id <> e.journey_id;

SELECT 'invalid_payment_amounts' AS check_name, COUNT(*) AS violations
FROM payment_attempts a JOIN orders o ON o.id = a.order_id
LEFT JOIN (
    SELECT payment_attempt_id,
        SUM(CASE WHEN type = 'CAPTURE' THEN amount ELSE 0 END) AS captured,
        SUM(CASE WHEN type = 'REFUND' THEN amount ELSE 0 END) AS refunded,
        SUM(type = 'CAPTURE') AS captures
    FROM payment_transactions WHERE status = 'SUCCEEDED' GROUP BY payment_attempt_id
) t ON t.payment_attempt_id = a.id
WHERE a.requested_amount <> o.total_price OR a.currency_code <> o.currency_code
   OR COALESCE(t.refunded, 0) > COALESCE(t.captured, 0) OR COALESCE(t.captures, 0) > 1
   OR (a.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND COALESCE(t.captured, 0) <> a.requested_amount)
   OR (a.status IN ('FAILED', 'CANCELLED') AND COALESCE(t.captured, 0) <> 0)
   OR (a.status = 'CAPTURED' AND COALESCE(t.refunded, 0) <> 0)
   OR (a.status = 'PARTIALLY_REFUNDED' AND NOT (t.refunded > 0 AND t.refunded < t.captured))
   OR (a.status = 'REFUNDED' AND t.refunded <> t.captured);

SELECT 'invalid_payment_times' AS check_name, COUNT(*) AS violations
FROM payment_transactions t JOIN payment_attempts a ON a.id = t.payment_attempt_id
JOIN orders o ON o.id = a.order_id
WHERE t.amount <= 0 OR t.processed_at IS NULL OR t.processed_at < a.created_at
   OR a.created_at < o.placed_at OR t.processed_at >= '2026-04-01'
   OR (t.type = 'REFUND' AND (a.captured_at IS NULL OR t.processed_at <= a.captured_at));

SELECT 'invalid_reservations' AS check_name, COUNT(*) AS violations
FROM order_items i JOIN orders o ON o.id = i.order_id
LEFT JOIN inventory_reservations r ON r.order_item_id = i.id
LEFT JOIN rec_purchase_orders l ON l.order_item_id = i.id
LEFT JOIN payment_transactions t ON t.id = l.capture_transaction_id
WHERE r.id IS NULL OR r.quantity <> i.quantity OR r.created_at <> o.placed_at
   OR r.expires_at <> DATE_ADD(o.placed_at, INTERVAL 15 MINUTE)
   OR (l.event_id IS NOT NULL AND (r.status <> 'CONSUMED' OR r.consumed_at IS NULL
       OR r.consumed_at <> t.processed_at OR r.consumed_at >= r.expires_at))
   OR (o.status = 'CANCELLED' AND (r.status <> 'RELEASED' OR r.released_at IS NULL));

SELECT 'invalid_stock_totals' AS check_name, COUNT(*) AS violations
FROM items i LEFT JOIN (
    SELECT item_id, SUM(quantity_delta) AS stock FROM inventory_movements GROUP BY item_id
) m ON m.item_id = i.id WHERE m.item_id IS NULL OR i.stock <> m.stock OR i.stock < 0;
SELECT 'invalid_stock_history' AS check_name, COUNT(*) AS violations FROM (
    SELECT stock_after, quantity_delta,
        SUM(quantity_delta) OVER (PARTITION BY item_id ORDER BY created_at, id ROWS UNBOUNDED PRECEDING) AS running_stock
    FROM inventory_movements
) m WHERE stock_after <> running_stock OR stock_after < 0 OR quantity_delta = 0;
SELECT 'invalid_reservation_movements' AS check_name, COUNT(*) AS violations
FROM orders o JOIN order_items i ON i.order_id = o.id
LEFT JOIN (
    SELECT reference_id, item_id, COUNT(*) AS movements, SUM(quantity_delta) AS delta
    FROM inventory_movements WHERE type = 'RESERVATION' AND reference_type = 'ORDER'
    GROUP BY reference_id, item_id
) m ON m.reference_id = o.order_number AND m.item_id = i.item_id
WHERE m.movements IS NULL OR m.movements <> 1 OR m.delta <> -i.quantity;

SELECT 'invalid_order_times' AS check_name, COUNT(*) AS violations
FROM orders o JOIN members m ON m.id = o.member_id
WHERE o.placed_at IS NULL OR o.placed_at < m.created_at OR o.placed_at < '2026-01-01'
   OR o.placed_at >= '2026-04-01' OR o.updated_at < o.placed_at
   OR (o.status = 'CANCELLED' AND (o.cancelled_at IS NULL OR o.cancelled_at < o.placed_at));
SELECT 'invalid_order_history' AS check_name, COUNT(*) AS violations
FROM orders o LEFT JOIN (
    SELECT order_id, to_status, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at DESC, id DESC) AS position
    FROM order_status_histories
) h ON h.order_id = o.id AND h.position = 1
WHERE h.order_id IS NULL OR h.to_status <> o.status;

-- Use a cutoff, not the final payment_attempts.status, for historical net payment.
SET @commerce_cutoff = '2026-03-02 00:00:00';
SELECT type, SUM(amount) AS observed_amount_krw
FROM payment_transactions
WHERE status = 'SUCCEEDED' AND processed_at < @commerce_cutoff
GROUP BY type;
