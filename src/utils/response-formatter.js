export function formatResponse(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

export function formatList(items, count = null, offset = 0, limit = 50) {
  return formatResponse(items, {
    count: count ?? items.length,
    total: count ?? items.length,
    offset,
    limit,
    hasMore: (offset + limit) < (count ?? items.length)
  });
}

export function formatPaginated(items, options = {}) {
  const { count = items.length, offset = 0, limit = 50, hasMore = false } = options;
  return formatList(items, count, offset, limit);
}

export function formatItem(item, meta = {}) {
  return formatResponse(item, meta);
}

export function formatSuccess(message = 'Operation successful', data = null) {
  return formatResponse(data || { message }, { operation: 'success' });
}

export function formatDeleted(resourceId, resourceType = 'resource') {
  return formatResponse({
    id: resourceId,
    type: resourceType,
    status: 'deleted'
  }, { operation: 'delete' });
}

export function formatCreated(item, meta = {}) {
  return formatResponse(item, { operation: 'create', ...meta });
}

export function formatUpdated(item, meta = {}) {
  return formatResponse(item, { operation: 'update', ...meta });
}

export function formatEmpty(meta = {}) {
  return formatResponse([], meta);
}

export function formatError(httpCode, error) {
  return {
    success: false,
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: error.message || 'Unknown error',
      ...(error.details && { details: error.details }),
      ...(error.category && { category: error.category })
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  };
}

export function respondWith(res, formatter) {
  return {
    ok: (data, meta) => {
      const response = formatter ? formatter(data, meta) : formatResponse(data, meta);
      return res.status(200).json(response);
    },
    created: (data, meta) => {
      const response = formatter ? formatter(data, meta) : formatCreated(data, meta);
      return res.status(201).json(response);
    },
    accepted: (data, meta) => {
      const response = formatter ? formatter(data, meta) : formatResponse(data, meta);
      return res.status(202).json(response);
    },
    noContent: () => res.status(204).send(),
    badRequest: (error) => {
      return res.status(error.httpCode || 400).json(formatError(400, error));
    },
    notFound: (error) => {
      return res.status(error.httpCode || 404).json(formatError(404, error));
    },
    conflict: (error) => {
      return res.status(error.httpCode || 409).json(formatError(409, error));
    },
    error: (error) => {
      const code = error.httpCode || 500;
      return res.status(code).json(formatError(code, error));
    }
  };
}
