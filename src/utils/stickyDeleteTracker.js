// Sticky messages get deleted intentionally by the bot itself all the time
// (repost on new activity, /sticky edit, /sticky remove). The messageDelete
// listener that clears the DB record on a genuine manual delete needs to be
// able to tell those apart from an actual human deleting the message — this
// tracks message IDs the bot is about to delete on purpose, so the listener
// can skip them.
const expected = new Set();

function markExpected(messageId) {
  expected.add(messageId);
  // Auto-cleanup in case something goes wrong and it's never explicitly cleared.
  setTimeout(() => expected.delete(messageId), 30000);
}

function wasExpected(messageId) {
  const had = expected.has(messageId);
  expected.delete(messageId);
  return had;
}

module.exports = { markExpected, wasExpected };
