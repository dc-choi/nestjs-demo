-- Read-only checks after importing dataset.sql.gz into its dedicated database.
SELECT * FROM rec_dataset;

SELECT
    (SELECT COUNT(*) FROM rec_users) AS users,
    (SELECT COUNT(*) FROM rec_products) AS products,
    (SELECT COUNT(*) FROM rec_events) AS events;

SELECT event_type, COUNT(*) AS events, COUNT(DISTINCT user_id) AS users,
    COUNT(DISTINCT user_id, product_id) AS unique_pairs
FROM rec_events GROUP BY event_type;

SELECT CASE
    WHEN occurred_at < '2026-03-02' THEN 'train'
    WHEN occurred_at < '2026-03-17' THEN 'validation'
    ELSE 'test'
END AS period, event_type, COUNT(*) AS events
FROM rec_events GROUP BY period, event_type;

-- Both counts must be zero.
SELECT COUNT(*) AS invalid_event_times
FROM rec_events e JOIN rec_users u USING (user_id)
WHERE e.occurred_at < u.created_at
    OR e.occurred_at < '2026-01-01' OR e.occurred_at >= '2026-04-01';

SELECT COUNT(*) AS invalid_journeys FROM (
    SELECT journey_id FROM rec_events
    GROUP BY journey_id
    HAVING COUNT(DISTINCT user_id) <> 1 OR COUNT(DISTINCT product_id) <> 1
        OR SUM(event_type = 'view') NOT BETWEEN 1 AND 3
        OR SUM(event_type = 'cart') > 1 OR SUM(event_type = 'purchase') > 1
        OR SUM(event_type = 'purchase') > SUM(event_type = 'cart')
        OR MAX(CASE WHEN event_type = 'view' THEN occurred_at END)
            >= MIN(CASE WHEN event_type = 'cart' THEN occurred_at END)
        OR MAX(CASE WHEN event_type = 'cart' THEN occurred_at END)
            >= MIN(CASE WHEN event_type = 'purchase' THEN occurred_at END)
) invalid;

-- One learning query: popular products using training purchases only.
SELECT p.product_key, p.name, COUNT(DISTINCT e.user_id) AS buyers
FROM rec_events e JOIN rec_products p USING (product_id)
WHERE e.event_type = 'purchase' AND e.occurred_at < '2026-03-02'
GROUP BY p.product_id, p.product_key, p.name
ORDER BY buyers DESC, p.product_key ASC LIMIT 10;
