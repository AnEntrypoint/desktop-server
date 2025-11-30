export function createErrorHandler() {
  return (err, req, res, next) => {
    console.error('Error:', err);

    const status = err.status || 500;
    const code = err.code || 'INTERNAL_SERVER_ERROR';
    const message = err.message || 'An unexpected error occurred';

    res.status(status).json({
      error: {
        code,
        message,
        requestId: req.requestId,
        ...(process.env.DEBUG && { stack: err.stack })
      },
      timestamp: new Date().toISOString()
    });
  };
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function logOperation(operation, details = {}) {
  const operationLog = global.operationLog || [];
  const maxOperationLogSize = 500;

  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    ...details
  };

  if (operationLog.length >= maxOperationLogSize) {
    operationLog.shift();
  }
  operationLog.push(entry);
  global.operationLog = operationLog;

  if (process.env.DEBUG) {
    console.log(`[${operation}] ${JSON.stringify(details).substring(0, 150)}`);
  }

  return entry;
}

export function getOperationLog() {
  return global.operationLog || [];
}
