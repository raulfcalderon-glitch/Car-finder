// In-memory sliding-window limiter. Fine for a single server; counts reset when the app restarts.
export function createLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map(); // key -> timestamps of recent hits

  function recent(key) {
    const cutoff = now() - windowMs;
    const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  }

  return {
    // Seconds until the key may try again, or 0 if it isn't blocked.
    blockedFor(key) {
      const list = recent(key);
      return list.length >= max ? Math.ceil((list[0] + windowMs - now()) / 1000) : 0;
    },
    hit(key) {
      hits.set(key, [...recent(key), now()]);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
