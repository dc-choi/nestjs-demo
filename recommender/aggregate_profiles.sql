-- Builds one versioned user profile and product popularity snapshot from verified history.
-- Run from the repository root with a new mysql session per run (session variables persist within one).
-- Inside -e, `\.` sources a file; `SOURCE` only works at the start of a line.
--   mysql ... demo_nest_recommender -e "SET @profile_version='demo-20260401', @cutoff='2026-04-01 00:00:00',
--     @activate=1; \. recommender/aggregate_profiles.sql"
-- Parameters:
--   @profile_version    new version name; an existing version is never overwritten
--   @cutoff             profile history (events and purchases) strictly before this UTC time
--   @popularity_cutoff  popularity purchases strictly before this time; defaults to @cutoff, never later
--   @activate           1 activates the version after validation; any other value leaves it inactive
-- Validation is a SQL condition on the recorded checks and activation requires a version validated by this run,
-- so a failed or duplicate run changes no other version even with --force. Never rely on --force, though.
-- Weights view 1, cart 3, verified purchase 5 are practice defaults, not measured preference strength.

SET time_zone = '+00:00';
-- Session only: keeps the ~5M-group GROUP BY temporary tables in memory (about 2x faster at full scale).
SET SESSION tmp_table_size = 1073741824;

CREATE TABLE IF NOT EXISTS rec_profile_versions (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    run_id CHAR(36) NOT NULL,
    cutoff DATETIME NOT NULL,
    popularity_cutoff DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    validated_at DATETIME NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    active_marker TINYINT AS (IF(is_active, 1, NULL)) STORED,
    users_with_history INT UNSIGNED NULL,
    pairs INT UNSIGNED NULL,
    purchased_pairs INT UNSIGNED NULL,
    verified_purchase_events INT UNSIGNED NULL,
    unverified_purchase_events INT UNSIGNED NULL,
    popular_products INT UNSIGNED NULL,
    max_event_at DATETIME NULL,
    UNIQUE KEY rec_profile_versions_one_active (active_marker),
    CONSTRAINT rec_profile_versions_format CHECK (REGEXP_LIKE(version, '^[a-z0-9][a-z0-9_-]{0,63}$', 'c')),
    CONSTRAINT rec_profile_versions_popularity_cutoff CHECK (popularity_cutoff <= cutoff),
    CONSTRAINT rec_profile_versions_active_validated CHECK (NOT is_active OR validated_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rec_user_category_affinity (
    version VARCHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    category_id BIGINT NOT NULL,
    score INT UNSIGNED NOT NULL,
    PRIMARY KEY (version, user_id, category_id),
    CONSTRAINT rec_user_category_affinity_version_fk FOREIGN KEY (version)
        REFERENCES rec_profile_versions (version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rec_user_tag_affinity (
    version VARCHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    tag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    score INT UNSIGNED NOT NULL,
    PRIMARY KEY (version, user_id, tag),
    CONSTRAINT rec_user_tag_affinity_version_fk FOREIGN KEY (version)
        REFERENCES rec_profile_versions (version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rec_user_purchased_products (
    version VARCHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (version, user_id, product_id),
    CONSTRAINT rec_user_purchased_products_version_fk FOREIGN KEY (version)
        REFERENCES rec_profile_versions (version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rec_product_popularity (
    version VARCHAR(64) NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    buyer_count INT UNSIGNED NOT NULL,
    popularity_rank INT UNSIGNED NOT NULL,
    PRIMARY KEY (version, product_id),
    UNIQUE KEY rec_product_popularity_rank (version, popularity_rank),
    CONSTRAINT rec_product_popularity_positive CHECK (buyer_count > 0 AND popularity_rank > 0),
    CONSTRAINT rec_product_popularity_version_fk FOREIGN KEY (version)
        REFERENCES rec_profile_versions (version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A non-zero violation count fails its INSERT, which stops a normal run before validation.
CREATE TABLE IF NOT EXISTS rec_profile_checks (
    version VARCHAR(64) NOT NULL,
    check_name VARCHAR(64) NOT NULL,
    violations BIGINT NOT NULL,
    PRIMARY KEY (version, check_name),
    CONSTRAINT rec_profile_checks_no_violations CHECK (violations = 0),
    CONSTRAINT rec_profile_checks_version_fk FOREIGN KEY (version)
        REFERENCES rec_profile_versions (version) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TEMPORARY TABLE IF EXISTS rec_tmp_pairs, rec_tmp_verified_events, rec_tmp_product_scores, rec_tmp_checks;

-- Fails on an existing version, a missing/invalid name, an unparsable cutoff or a later popularity cutoff.
SET @run_id = UUID();
INSERT INTO rec_profile_versions (version, run_id, cutoff, popularity_cutoff, created_at)
VALUES (@profile_version, @run_id, CAST(@cutoff AS DATETIME),
        CAST(COALESCE(@popularity_cutoff, @cutoff) AS DATETIME), UTC_TIMESTAMP());
-- Every later write requires the row inserted above, so a failed insert writes nothing.
SELECT COUNT(*), MAX(cutoff), MAX(popularity_cutoff) INTO @owned, @cutoff_at, @popularity_cutoff_at
  FROM rec_profile_versions
 WHERE version = @profile_version AND run_id = @run_id AND validated_at IS NULL;

-- One row per user-product pair with any event before the cutoff. Repeated events do not add more.
CREATE TEMPORARY TABLE rec_tmp_pairs (
    user_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    viewed BOOLEAN NOT NULL,
    carted BOOLEAN NOT NULL,
    purchased BOOLEAN NOT NULL DEFAULT FALSE,
    purchase_events INT UNSIGNED NOT NULL,
    last_event_at DATETIME NOT NULL,
    score TINYINT UNSIGNED AS (viewed * 1 + carted * 3 + purchased * 5),
    PRIMARY KEY (user_id, product_id)
) ENGINE=InnoDB;

INSERT INTO rec_tmp_pairs (user_id, product_id, viewed, carted, purchase_events, last_event_at)
SELECT user_id, product_id, MAX(event_type = 'view'), MAX(event_type = 'cart'),
       SUM(event_type = 'purchase'), MAX(occurred_at)
  FROM rec_events
 WHERE @owned = 1 AND occurred_at < @cutoff_at
 GROUP BY user_id, product_id;

-- A purchase counts only with its successful capture processed before the cutoff.
-- The popularity cutoff is never later, so popularity reads a subset of these events.
CREATE TEMPORARY TABLE rec_tmp_verified_events (PRIMARY KEY (event_id))
SELECT e.event_id, e.user_id, e.product_id, e.occurred_at, t.processed_at
  FROM rec_events e
  JOIN rec_purchase_orders l ON l.event_id = e.event_id
  JOIN payment_transactions t ON t.id = l.capture_transaction_id
 WHERE @owned = 1 AND e.event_type = 'purchase' AND e.occurred_at < @cutoff_at
   AND t.type = 'CAPTURE' AND t.status = 'SUCCEEDED' AND t.processed_at < @cutoff_at;

INSERT INTO rec_user_purchased_products (version, user_id, product_id)
SELECT DISTINCT @profile_version, user_id, product_id FROM rec_tmp_verified_events WHERE @owned = 1;
UPDATE rec_tmp_pairs p
  JOIN rec_user_purchased_products b
    ON b.version = @profile_version AND b.user_id = p.user_id AND b.product_id = p.product_id
   SET p.purchased = TRUE;

SELECT COUNT(*) INTO @verified_purchase_events FROM rec_tmp_verified_events;
SELECT COUNT(*) INTO @purchased_pairs FROM rec_user_purchased_products WHERE version = @profile_version;
-- Unverified purchase events are excluded from scores and reported, not hidden.
SELECT COALESCE(SUM(purchase_events), 0) - @verified_purchase_events INTO @unverified_purchase_events
  FROM rec_tmp_pairs;
-- A pair whose only events are unverified purchases has no score.
DELETE FROM rec_tmp_pairs WHERE score = 0;
SELECT COUNT(*), COUNT(DISTINCT user_id), MAX(last_event_at) INTO @pairs, @users_with_history, @max_event_at
  FROM rec_tmp_pairs;

-- Same category visibility as the search projector: active and not deleted.
INSERT INTO rec_user_category_affinity (version, user_id, category_id, score)
SELECT @profile_version, p.user_id, pc.category_id, SUM(p.score)
  FROM rec_tmp_pairs p
  JOIN product_categories pc ON pc.product_id = p.product_id
  JOIN categories c ON c.id = pc.category_id AND c.is_active AND c.deleted_at IS NULL
 WHERE @owned = 1
 GROUP BY p.user_id, pc.category_id;

INSERT INTO rec_user_tag_affinity (version, user_id, tag, score)
SELECT @profile_version, p.user_id, t.value COLLATE utf8mb4_bin, SUM(p.score)
  FROM rec_tmp_pairs p
  JOIN product_tags t ON t.product_id = p.product_id
 WHERE @owned = 1
 GROUP BY p.user_id, t.value COLLATE utf8mb4_bin;

-- Distinct verified buyers before the popularity cutoff. Ties use productKey (Product slug) ascending;
-- products with no buyer are absent.
INSERT INTO rec_product_popularity (version, product_id, buyer_count, popularity_rank)
SELECT @profile_version, v.product_id, COUNT(DISTINCT v.user_id),
       ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT v.user_id) DESC, pr.slug COLLATE utf8mb4_bin)
  FROM rec_tmp_verified_events v
  JOIN products pr ON pr.id = v.product_id
 WHERE @owned = 1 AND v.occurred_at < @popularity_cutoff_at AND v.processed_at < @popularity_cutoff_at
 GROUP BY v.product_id, pr.slug;
SELECT COUNT(*) INTO @popular_products FROM rec_product_popularity WHERE version = @profile_version;

-- Validation. purchased_mismatch re-derives the purchase rule from the source tables. The other checks are
-- internal consistency checks; they also catch a failed or partial statement when the client continued.
CREATE TEMPORARY TABLE rec_tmp_checks (check_name VARCHAR(64) PRIMARY KEY, violations BIGINT NOT NULL);
CREATE TEMPORARY TABLE rec_tmp_product_scores (PRIMARY KEY (product_id))
SELECT product_id, SUM(score) AS score FROM rec_tmp_pairs GROUP BY product_id;

INSERT INTO rec_tmp_checks SELECT 'empty_profile', COUNT(*) = 0 FROM rec_tmp_pairs;
INSERT INTO rec_tmp_checks
SELECT 'no_popularity', COUNT(*) = 0 FROM rec_product_popularity WHERE version = @profile_version;
INSERT INTO rec_tmp_checks
SELECT 'invalid_pairs', COUNT(*) FROM rec_tmp_pairs WHERE score = 0 OR last_event_at >= @cutoff_at;
INSERT INTO rec_tmp_checks
SELECT 'purchased_mismatch', COUNT(*)
  FROM (
      SELECT SUM(source_rows) AS source_rows, SUM(stored_rows) AS stored_rows
        FROM (
            SELECT DISTINCT e.user_id, e.product_id, 1 AS source_rows, 0 AS stored_rows
              FROM payment_transactions t
              JOIN rec_purchase_orders l ON l.capture_transaction_id = t.id
              JOIN rec_events e ON e.event_id = l.event_id
             WHERE t.type = 'CAPTURE' AND t.status = 'SUCCEEDED' AND t.processed_at < @cutoff_at
               AND e.event_type = 'purchase' AND e.occurred_at < @cutoff_at
            UNION ALL
            SELECT user_id, product_id, 0, 1 FROM rec_user_purchased_products WHERE version = @profile_version
        ) u
       GROUP BY user_id, product_id
  ) d
 WHERE source_rows = 0 OR stored_rows = 0;
INSERT INTO rec_tmp_checks
SELECT 'purchased_unscored', COUNT(*)
  FROM rec_user_purchased_products b
  LEFT JOIN rec_tmp_pairs p ON p.user_id = b.user_id AND p.product_id = b.product_id AND p.purchased
 WHERE b.version = @profile_version AND p.user_id IS NULL;
INSERT INTO rec_tmp_checks
SELECT 'category_affinity_total', ABS(
       COALESCE((SELECT SUM(score) FROM rec_user_category_affinity WHERE version = @profile_version), 0)
     - COALESCE((SELECT SUM(s.score)
                   FROM rec_tmp_product_scores s
                   JOIN product_categories pc ON pc.product_id = s.product_id
                   JOIN categories c ON c.id = pc.category_id AND c.is_active AND c.deleted_at IS NULL), 0));
INSERT INTO rec_tmp_checks
SELECT 'tag_affinity_total', ABS(
       COALESCE((SELECT SUM(score) FROM rec_user_tag_affinity WHERE version = @profile_version), 0)
     - COALESCE((SELECT SUM(s.score)
                   FROM rec_tmp_product_scores s
                   JOIN product_tags t ON t.product_id = s.product_id), 0));
INSERT INTO rec_tmp_checks
SELECT 'popularity_mismatch',
       (SELECT COUNT(*)
          FROM (
              SELECT SUM(source_buyers) AS source_buyers, SUM(stored_buyers) AS stored_buyers
                FROM (
                    SELECT product_id, COUNT(DISTINCT user_id) AS source_buyers, 0 AS stored_buyers
                      FROM rec_tmp_verified_events
                     WHERE occurred_at < @popularity_cutoff_at AND processed_at < @popularity_cutoff_at
                     GROUP BY product_id
                    UNION ALL
                    SELECT product_id, 0, buyer_count FROM rec_product_popularity WHERE version = @profile_version
                ) u
               GROUP BY product_id
          ) d
         WHERE source_buyers <> stored_buyers)
     + (SELECT COUNT(*) <> COALESCE(MAX(popularity_rank), 0)
          FROM rec_product_popularity
         WHERE version = @profile_version);

SELECT check_name, violations FROM rec_tmp_checks ORDER BY check_name;
INSERT INTO rec_profile_checks (version, check_name, violations)
SELECT @profile_version, check_name, violations FROM rec_tmp_checks WHERE @owned = 1;

-- Validated only when all 8 checks are recorded with zero violations, independent of the client stopping.
UPDATE rec_profile_versions
   SET users_with_history = @users_with_history, pairs = @pairs, purchased_pairs = @purchased_pairs,
       verified_purchase_events = @verified_purchase_events,
       unverified_purchase_events = @unverified_purchase_events,
       popular_products = @popular_products, max_event_at = @max_event_at, validated_at = UTC_TIMESTAMP()
 WHERE version = @profile_version AND run_id = @run_id AND validated_at IS NULL
   AND (SELECT COUNT(*)
          FROM rec_profile_checks
         WHERE version = @profile_version AND violations = 0
           AND check_name IN ('empty_profile', 'no_popularity', 'invalid_pairs', 'purchased_mismatch',
                              'purchased_unscored', 'category_affinity_total', 'tag_affinity_total',
                              'popularity_mismatch')) = 8;

-- Only a version validated by this run, and only with @activate = 1, replaces the active version.
START TRANSACTION;
UPDATE rec_profile_versions other
  JOIN rec_profile_versions own
    ON own.version = @profile_version AND own.run_id = @run_id AND own.validated_at IS NOT NULL
   AND @activate = 1
   SET other.is_active = FALSE
 WHERE other.is_active AND other.version <> @profile_version;
UPDATE rec_profile_versions
   SET is_active = TRUE
 WHERE version = @profile_version AND run_id = @run_id AND validated_at IS NOT NULL AND @activate = 1;
COMMIT;

SELECT version, cutoff, popularity_cutoff, created_at, validated_at, is_active, users_with_history, pairs,
       purchased_pairs, verified_purchase_events, unverified_purchase_events, popular_products, max_event_at
  FROM rec_profile_versions
 WHERE version = @profile_version AND run_id = @run_id;
