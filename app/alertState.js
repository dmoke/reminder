// Pure helpers for the collapsible ("mini") alert behavior. No Electron here so
// the decision logic stays unit-testable under plain `node --test`.

// The reopen-timeout values (seconds) the Settings dropdown offers. 0 == never:
// a fully-collapsed alert then stays collapsed until a brand-new reminder fires.
// 10s is a fast option (handy for trying the feature out); the rest are minutes.
const ALLOWED_REOPEN_SECONDS = [0, 10, 300, 600, 1200, 1800, 3600];

// Clamp a persisted/user-supplied reopen-timeout (seconds) to one of the allowed
// values, falling back to `fallback` for anything unrecognized (missing, NaN,
// tampered).
function sanitizeReopenSeconds(value, fallback = 10) {
  // Guard nullish/empty before Number() — Number(null) and Number("") are 0,
  // which is a valid value ("Never"), so coercion alone would turn an unset
  // config into "Never" instead of the intended default.
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return ALLOWED_REOPEN_SECONDS.includes(n) ? n : fallback;
}

// The action-cooldown values (seconds) the Settings dropdown offers. After the
// user resolves a reminder in the alert, its action buttons are disabled for
// this long so a fast second click can't accidentally resolve the next one. 0
// disables the cooldown.
const ALLOWED_COOLDOWN_SECONDS = [0, 0.25, 0.5, 1, 2, 3, 5];

function sanitizeCooldownSeconds(value, fallback = 1) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return ALLOWED_COOLDOWN_SECONDS.includes(n) ? n : fallback;
}

// Decide what a per-second scheduler tick should do while the alert is collapsed
// into the mini rectangle:
//   "reopen" — restore the full alert (a new reminder appeared, or the collapse
//              timeout elapsed)
//   "stay"   — keep it collapsed; just refresh the pill's count/elapsed.
// reopenMs <= 0 disables the timeout (only a new reminder reopens).
function collapseDecision({ gainedNew, collapsedSince, now, reopenMs }) {
  if (gainedNew) return "reopen";
  if (
    reopenMs > 0 &&
    typeof collapsedSince === "number" &&
    collapsedSince > 0 &&
    now - collapsedSince >= reopenMs
  ) {
    return "reopen";
  }
  return "stay";
}

module.exports = {
  ALLOWED_REOPEN_SECONDS,
  sanitizeReopenSeconds,
  ALLOWED_COOLDOWN_SECONDS,
  sanitizeCooldownSeconds,
  collapseDecision,
};
