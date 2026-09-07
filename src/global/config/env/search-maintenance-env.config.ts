export interface SearchMaintenanceEnvConfig {
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

    ENV: string;

    OPENSEARCH_ENABLED: boolean;
    OPENSEARCH_NODE_URL?: string;
    OPENSEARCH_READ_ALIAS?: string;
    OPENSEARCH_WRITE_ALIAS?: string;
    OPENSEARCH_REQUEST_TIMEOUT_MS?: number;
}
