const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALLOWED_REOPEN_SECONDS,
  sanitizeReopenSeconds,
  ALLOWED_COOLDOWN_SECONDS,
  sanitizeCooldownSeconds,
  collapseDecision,
} = require("../app/alertState.js");

test("sanitizeCooldownSeconds accepts allowed values, defaults to 1", () => {
  for (const v of ALLOWED_COOLDOWN_SECONDS) {
    assert.equal(sanitizeCooldownSeconds(v), v);
  }
  // Fractional options arrive as strings from the <select>.
  assert.equal(sanitizeCooldownSeconds("0.25"), 0.25);
  assert.equal(sanitizeCooldownSeconds("0.5"), 0.5);
  assert.equal(sanitizeCooldownSeconds("1"), 1);
  assert.equal(sanitizeCooldownSeconds("0"), 0);
  assert.equal(sanitizeCooldownSeconds(undefined), 1);
  assert.equal(sanitizeCooldownSeconds(null), 1);
  assert.equal(sanitizeCooldownSeconds(4), 1); // not offered
  assert.equal(sanitizeCooldownSeconds("nope"), 1);
});

test("sanitizeReopenSeconds accepts the allowed values", () => {
  for (const v of ALLOWED_REOPEN_SECONDS) {
    assert.equal(sanitizeReopenSeconds(v), v);
  }
  // String forms (as they arrive from a <select>) coerce cleanly.
  assert.equal(sanitizeReopenSeconds("10"), 10); // the new 10s default
  assert.equal(sanitizeReopenSeconds("1200"), 1200);
  assert.equal(sanitizeReopenSeconds("0"), 0);
});

test("sanitizeReopenSeconds falls back for unknown / bad input", () => {
  assert.equal(sanitizeReopenSeconds(undefined), 10); // default is now 10s
  assert.equal(sanitizeReopenSeconds(null), 10);
  assert.equal(sanitizeReopenSeconds(7), 10); // not an offered value
  assert.equal(sanitizeReopenSeconds("nope"), 10);
  assert.equal(sanitizeReopenSeconds(15, 1200), 1200); // custom fallback
});

const MIN = 60 * 1000;

test("collapseDecision reopens immediately when a new reminder appears", () => {
  // Even with the timeout nowhere near, a brand-new reminder pops the full alert.
  assert.equal(
    collapseDecision({
      gainedNew: true,
      collapsedSince: 1000,
      now: 1000 + 60 * 1000,
      reopenMs: 20 * MIN,
    }),
    "reopen",
  );
});

test("collapseDecision stays collapsed before the timeout elapses", () => {
  const collapsedSince = 1 * MIN;
  assert.equal(
    collapseDecision({
      gainedNew: false,
      collapsedSince,
      now: collapsedSince + 19 * MIN, // 19 min elapsed, timeout is 20
      reopenMs: 20 * MIN,
    }),
    "stay",
  );
});

test("collapseDecision reopens once the timeout elapses", () => {
  const collapsedSince = 5 * MIN;
  assert.equal(
    collapseDecision({
      gainedNew: false,
      collapsedSince,
      now: collapsedSince + 20 * MIN, // exactly at the threshold
      reopenMs: 20 * MIN,
    }),
    "reopen",
  );
  assert.equal(
    collapseDecision({
      gainedNew: false,
      collapsedSince,
      now: collapsedSince + 20 * MIN - 1, // one ms short
      reopenMs: 20 * MIN,
    }),
    "stay",
  );
});

test("collapseDecision with reopenMs=0 (Never) only reopens on a new reminder", () => {
  const collapsedSince = MIN;
  // Hours later, still collapsed without a new reminder.
  assert.equal(
    collapseDecision({
      gainedNew: false,
      collapsedSince,
      now: collapsedSince + 5 * 60 * MIN,
      reopenMs: 0,
    }),
    "stay",
  );
  // A new reminder still reopens.
  assert.equal(
    collapseDecision({
      gainedNew: true,
      collapsedSince,
      now: collapsedSince + 5 * 60 * MIN,
      reopenMs: 0,
    }),
    "reopen",
  );
});

test("collapseDecision ignores a missing/zero collapsedSince for the timeout", () => {
  // Guards against treating epoch 0 as 'collapsed 56 years ago' and reopening
  // instantly before collapsedSince has been stamped.
  assert.equal(
    collapseDecision({
      gainedNew: false,
      collapsedSince: 0,
      now: 9_999_999_999,
      reopenMs: 20 * MIN,
    }),
    "stay",
  );
});
