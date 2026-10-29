function createLoginLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map(); // key -> { count, first }

  function live(key) {
    const h = hits.get(key);
    if (h && Date.now() - h.first >= windowMs) {
      hits.delete(key);
      return null;
    }
    return h || null;
  }

  return {
    isBlocked(key) {
      const h = live(key);
      return !!h && h.count >= max;
    },
    fail(key) {
      const h = live(key);
      if (h) h.count += 1;
      else hits.set(key, { count: 1, first: Date.now() });
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createLoginLimiter };
