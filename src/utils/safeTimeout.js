// Node's setTimeout takes a 32-bit signed integer for its delay — anything
// above ~24.8 days (2,147,483,647 ms) silently overflows and fires almost
// immediately instead of waiting the full duration or throwing an error.
// This wraps setTimeout so any delay, however long, actually waits the full
// time by chaining timers in safe-sized chunks.
const MAX_TIMEOUT = 2_147_483_647;

function safeSetTimeout(fn, delay) {
  if (delay <= MAX_TIMEOUT) {
    return setTimeout(fn, Math.max(delay, 0));
  }
  // Wait out one max-size chunk, then recurse with what's left.
  return setTimeout(() => safeSetTimeout(fn, delay - MAX_TIMEOUT), MAX_TIMEOUT);
}

module.exports = { safeSetTimeout, MAX_TIMEOUT };
