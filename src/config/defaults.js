export const CONFIG = {
  server: {
    port: process.env.PORT || 8003,
    hostname: process.env.HOSTNAME || 'localhost',
    protocol: process.env.PROTOCOL || 'http'
  },
  rateLimit: {
    http: {
      maxRequests: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
      windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000
    },
    websocket: {
      maxConnectionsPerIp: process.env.WS_MAX_CONNECTIONS_PER_IP || 10,
      cleanupIntervalMs: process.env.WS_CLEANUP_INTERVAL_MS || 60000
    }
  },
  requestLogger: {
    slowThresholdMs: process.env.REQUEST_SLOW_THRESHOLD_MS || 1000,
    maxLogSize: process.env.REQUEST_LOG_MAX_SIZE || 1000,
    userAgentMaxLength: process.env.USER_AGENT_MAX_LENGTH || 100
  },
  files: {
    maxSizeBytes: process.env.MAX_FILE_SIZE_BYTES || 10 * 1024 * 1024,
    maxNameLength: process.env.MAX_FILE_NAME_LENGTH || 255
  },
  tasks: {
    executionTimeoutMs: process.env.TASK_EXECUTION_TIMEOUT_MS || 30000,
    maxNameLength: process.env.MAX_TASK_NAME_LENGTH || 100
  },
  logs: {
    maxOperationLogSize: process.env.OP_LOG_MAX_SIZE || 500,
    defaultLogLimit: process.env.DEFAULT_LOG_LIMIT || 100
  },
  cache: {
    ttlMs: process.env.CACHE_TTL_MS || 30000
  }
};
