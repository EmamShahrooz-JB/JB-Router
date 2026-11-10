/**
 * Gateway rate limiting for the public LLM surface (`/v1/*`, `/v1beta/*`, …).
 *
 * Before this existed, only the dashboard *login* endpoint was throttled: any
 * holder of one API key could drive unbounded traffic through the user's paid
 * upstream accounts, and a runaway loop could burn the quota fast enough to
 * lock every provider (and therefore every other user of the same instance).
 *
 * Implementation: token bucket per (API key fingerprint | client IP).
 *  - `perMinute` is the sustained refill rate
 *  - `burst` is the bucket capacity (how much a client may spend at once)
 *
 * The bucket map is per-process memory. On Cloudflare Workers (one isolate per
 * request) this degrades to a best-effort limit; on Node/Bun/Docker it is the
 * real enforcement point. `Retry-After` tells well-behaved clients when to
 * come back instead of hammering.
 */

const BUCKETS = new Map();
const SWEEP_EVERY_MS = 60_000;
const IDLE_EVICT_MS = 10 * 60_000;

let lastSweep = 0;

export const RATE_LIMIT_DEFAULTS = {
  enabled: true,
  perMinute: 600,
  burst: 120,
};

function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of BUCKETS) {
    if (now - bucket.lastSeen > IDLE_EVICT_MS) BUCKETS.delete(key);
  }
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function resolveRateLimitConfig(settings) {
  const enabled = settings?.rateLimitEnabled;
  return {
    enabled: enabled === undefined ? RATE_LIMIT_DEFAULTS.enabled : enabled !== false,
    perMinute: positiveInt(settings?.rateLimitPerMinute, RATE_LIMIT_DEFAULTS.perMinute),
    burst: positiveInt(settings?.rateLimitBurst, RATE_LIMIT_DEFAULTS.burst),
  };
}

/**
 * @returns {{allowed: true} | {allowed: false, retryAfter: number, limit: number}}
 */
export function consumeRateLimit(bucketKey, config, now = Date.now()) {
  if (!config?.enabled) return { allowed: true };
  const capacity = Math.max(1, config.burst);
  const refillPerMs = config.perMinute / 60_000;

  sweep(now);

  let bucket = BUCKETS.get(bucketKey);
  if (!bucket) {
    bucket = { tokens: capacity, lastSeen: now };
    BUCKETS.set(bucketKey, bucket);
  } else {
    const elapsed = Math.max(0, now - bucket.lastSeen);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  }
  bucket.lastSeen = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }

  const deficit = 1 - bucket.tokens;
  const retryAfter = Math.max(1, Math.ceil(deficit / refillPerMs / 1000));
  return { allowed: false, retryAfter, limit: config.perMinute };
}

/** Test/ops hook — clears all buckets (also used after a settings change). */
export function resetRateLimits() {
  BUCKETS.clear();
  lastSweep = 0;
}

export function __test__() {
  return { buckets: BUCKETS, consumeRateLimit, resolveRateLimitConfig };
}
