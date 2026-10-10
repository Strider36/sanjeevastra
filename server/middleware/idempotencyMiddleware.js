const IdempotencyLog = require('../models/IdempotencyLog');

/**
 * Idempotency Middleware for safe offline synchronization and retry deduplication.
 * Inspects `X-Idempotency-Key` or `Idempotency-Key` headers (or `req.body.idempotencyKey`).
 * If an operation has already executed for this user, returns the stored response immediately.
 */
const checkIdempotency = async (req, res, next) => {
  // Only apply to state-changing methods (POST, PUT, PATCH, DELETE)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['x-idempotency-key'] ||
                         req.headers['idempotency-key'] ||
                         req.body?.idempotencyKey;

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
    return next();
  }

  const cleanKey = idempotencyKey.trim();
  const userId = req.user?.id || req.user?._id;

  if (!userId) {
    // If route is not authenticated yet, proceed without key binding
    return next();
  }

  try {
    const existing = await IdempotencyLog.findOne({ key: cleanKey, user: userId }).lean();
    if (existing) {
      res.set('X-Idempotency-Replay', 'true');
      res.set('X-Cache', 'IDEMPOTENT_REPLAY');
      res.set('X-Idempotency-Key', cleanKey);
      return res.status(existing.statusCode).json(existing.responseBody);
    }
  } catch (err) {
    console.warn('[Idempotency] Lookup warning:', err.message);
  }

  // Intercept response to record result once completed
  const originalJson = res.json.bind(res);
  res.json = async function (body) {
    const statusCode = res.statusCode || 200;

    // Only record successful responses or permanent client validations
    if (statusCode < 500) {
      try {
        await IdempotencyLog.create({
          key: cleanKey,
          user: userId,
          endpoint: req.originalUrl || req.url,
          method: req.method,
          statusCode,
          responseBody: body
        });
      } catch (err) {
        // E11000 duplicate key is acceptable in concurrent races
        if (err.code !== 11000) {
          console.warn('[Idempotency] Failed to record idempotency log:', err.message);
        }
      }
    }

    res.set('X-Idempotency-Key', cleanKey);
    return originalJson(body);
  };

  next();
};

module.exports = { checkIdempotency };
