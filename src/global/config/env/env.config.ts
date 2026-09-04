export interface EnvConfig {
    SERVER_PORT: number;

    MYSQL_HOST: string;
    MYSQL_PORT: number;
    MYSQL_USER: string;
    MYSQL_PASSWORD: string;
    MYSQL_DATABASE: string;

    MYSQL_READ_REPLICA_HOST: string;
    MYSQL_READ_REPLICA_PORT: number;
    MYSQL_READ_REPLICA_USER: string;
    MYSQL_READ_REPLICA_PASSWORD: string;
    MYSQL_READ_REPLICA_DATABASE: string;

    SECRET: string;

    ENV: string;

    MAIL_USER: string;
    MAIL_PASSWORD: string;
    MAIL_SIGNUP_ALERT_USER: string;

    REDIS_URL: string;

    PAYMENT_WEBHOOK_SECRET?: string;

    OPENSEARCH_ENABLED?: boolean;
    OPENSEARCH_NODE_URL?: string;
    OPENSEARCH_READ_ALIAS?: string;
    OPENSEARCH_WRITE_ALIAS?: string;
    OPENSEARCH_CURSOR_SECRET?: string;
    OPENSEARCH_REQUEST_TIMEOUT_MS?: number;

    // INFLUX_URL: string;
    // INFLUX_TOKEN: string;
    // INFLUX_DATABASE: string;
}
