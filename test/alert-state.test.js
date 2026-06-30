const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALLOWED_REOPEN_MINUTES,
  sanitizeReopenMinutes,
  collapseDecision,
} = require("../app/alertState.js");

test("sanitizeReopenMinutes accepts the allowed values", () => {
  for (const v of ALLOWED_REOPEN_MINUTES) {
    assert.equal(sanitizeReopenMinutes(v), v);
  }
  // String forms (as they arrive from a <select>) coerce cleanly.
  assert.equal(sanitizeReopenMinutes("20"), 20);
  assert.equal(sanitizeReopenMinutes("0"), 0);
});

test("sanitizeReopenMinutes falls back for unknown / bad input", () => {
  assert.equal(sanitizeReopenMinutes(undefined), 20);
  assert.equal(sanitizeReopenMinutes(null), 20);
  assert.equal(sanitizeReopenMinutes(7), 20); // not an offered value
  assert.equal(sanitizeReopenMinutes("nope"), 20);
  assert.equal(sanitizeReopenMinutes(15, 10), 10); // custom fallback
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
