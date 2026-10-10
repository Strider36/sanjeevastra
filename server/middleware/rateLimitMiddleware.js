/**
 * In-memory rate limiting middleware for API routes.
 *
 * @param {Object} options
 * @param {number} [options.windowMs=60000] Time window in milliseconds (default 1 min)
 * @param {number} [options.max=20] Max requests per windowMs
 * @param {string} [options.message='Too many requests. Please try again later.']
 * @returns {Function} Express middleware
 */
function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 20;
  const message = options.message || 'Too many requests. Please wait a moment before trying again.';

  const requests = new Map();

  // Periodic cleanup every 2 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(key);
      }
    }
  }, Math.max(windowMs * 2, 60000));

  // Allow Node process to exit gracefully without waiting on interval
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req, res, next) => {
    const key = (req.user && req.user._id ? req.user._id.toString() : (req.ip || 'anonymous'));
    const now = Date.now();

    let record = requests.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      requests.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        error: message
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
