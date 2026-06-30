// Pure helpers for the collapsible ("mini") alert behavior. No Electron here so
// the decision logic stays unit-testable under plain `node --test`.

// The reopen-timeout values (minutes) the Settings dropdown offers. 0 == never:
// a fully-collapsed alert then stays collapsed until a brand-new reminder fires.
const ALLOWED_REOPEN_MINUTES = [0, 5, 10, 20, 30, 60];

// Clamp a persisted/user-supplied reopen-timeout to one of the allowed values,
// falling back to `fallback` for anything unrecognized (missing, NaN, tampered).
function sanitizeReopenMinutes(value, fallback = 20) {
  // Guard nullish/empty before Number() — Number(null) and Number("") are 0,
  // which is a valid value ("Never"), so coercion alone would turn an unset
  // config into "Never" instead of the intended default.
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return ALLOWED_REOPEN_MINUTES.includes(n) ? n : fallback;
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
  ALLOWED_REOPEN_MINUTES,
  sanitizeReopenMinutes,
  collapseDecision,
};
