-- Import into a new, dedicated MySQL 8 database. Existing tables cause an error.
CREATE TABLE rec_dataset (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    profile VARCHAR(16) NOT NULL,
    seed BIGINT UNSIGNED NOT NULL,
    generator_version VARCHAR(16) NOT NULL,
    expected_users INT UNSIGNED NOT NULL,
    expected_products INT UNSIGNED NOT NULL,
    target_events BIGINT UNSIGNED NOT NULL,
    actual_events BIGINT UNSIGNED NULL,
    is_complete BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rec_products (
    product_id INT UNSIGNED NOT NULL PRIMARY KEY,
    product_key VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category_group VARCHAR(64) NOT NULL,
    category VARCHAR(64) NOT NULL,
    tags JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rec_users (
    user_id INT UNSIGNED NOT NULL PRIMARY KEY,
    user_key VARCHAR(32) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rec_events (
    event_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    journey_id BIGINT UNSIGNED NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    product_id INT UNSIGNED NOT NULL,
    event_type ENUM('view', 'cart', 'purchase') NOT NULL,
    occurred_at DATETIME NOT NULL,
    KEY rec_events_user_time (user_id, occurred_at, product_id),
    KEY rec_events_product_time (product_id, occurred_at),
    KEY rec_events_journey (journey_id, event_id),
    CONSTRAINT rec_events_user_fk FOREIGN KEY (user_id) REFERENCES rec_users (user_id),
    CONSTRAINT rec_events_product_fk FOREIGN KEY (product_id) REFERENCES rec_products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
