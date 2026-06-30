// Collapsed "mini" alert renderer. Vanilla DOM only; contextIsolation is on, so
// the sole bridge to the main process is window.miniAPI. All user-facing words
// come from the `strings` map in the data payload (no hardcoded English), except
// the elapsed timer which is purely numeric + short unit markers.

(function () {
  "use strict";

  if (!window.miniAPI) return;

  var countEl = document.getElementById("miniCount");
  var labelEl = document.getElementById("miniLabel");
  var elapsedEl = document.getElementById("miniElapsed");
  var rootEl = document.getElementById("miniRoot");
  var expandBtn = document.getElementById("miniExpand");
  var minimizeBtn = document.getElementById("miniMinimize");

  // Latest payload state.
  var collapsedSince = 0; // epoch ms the alert was collapsed
  var currentLang = "en";
  var currentStrings = {};
  var tickTimer = null;

  function s(key) {
    if (currentStrings && Object.prototype.hasOwnProperty.call(currentStrings, key)) {
      return currentStrings[key];
    }
    return key;
  }

  // Localized short unit markers, mirroring the alert window's abbreviations.
  function unit(kind) {
    var uk = { d: "д", h: "год", m: "хв", s: "с" };
    var en = { d: "d", h: "h", m: "m", s: "s" };
    var map = currentLang === "uk" ? uk : en;
    return map[kind] || kind;
  }

  // "How long collapsed" as a compact d/h/m/s string, updated every second so
  // the user can see at a glance how long ago they parked the overdues. Seconds
  // are dropped only once it has been collapsed for a day or more (where they no
  // longer matter and would overflow the small pill).
  function formatElapsed(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    if (days > 0) return days + unit("d") + " " + hours + unit("h") + " " + minutes + unit("m");
    if (hours > 0) return hours + unit("h") + " " + minutes + unit("m") + " " + seconds + unit("s");
    if (minutes > 0) return minutes + unit("m") + " " + seconds + unit("s");
    return seconds + unit("s");
  }

  function refreshElapsed() {
    if (!collapsedSince) {
      elapsedEl.textContent = "0" + unit("s");
      return;
    }
    var text = formatElapsed(Date.now() - collapsedSince);
    elapsedEl.textContent = text;
    // Tooltip on the whole pill reinforces what the timer means.
    if (rootEl) rootEl.title = text;
  }

  function startTicker() {
    if (tickTimer !== null) return;
    // Per-second so the seconds field actually counts.
    tickTimer = window.setInterval(refreshElapsed, 1000);
  }

  function expand() {
    try {
      window.miniAPI.expand();
    } catch (e) {
      /* ignore */
    }
  }

  function minimize() {
    try {
      window.miniAPI.minimize();
    } catch (e) {
      /* ignore */
    }
  }

  if (expandBtn) {
    expandBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      expand();
    });
  }
  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      minimize();
    });
  }

  window.miniAPI.onData(function (payload) {
    payload = payload || {};
    var count = typeof payload.count === "number" ? payload.count : 0;
    collapsedSince =
      typeof payload.collapsedSince === "number" ? payload.collapsedSince : 0;
    currentLang = payload.lang === "uk" ? "uk" : "en";
    currentStrings =
      payload.strings && typeof payload.strings === "object" ? payload.strings : {};

    document.documentElement.setAttribute("lang", currentLang);
    if (countEl) countEl.textContent = String(count);
    if (labelEl) labelEl.textContent = s("overdue-label");
    // Keep the accessible name in sync with the localized tooltip.
    if (expandBtn) {
      expandBtn.title = s("mini-open");
      expandBtn.setAttribute("aria-label", s("mini-open"));
    }
    if (minimizeBtn) {
      minimizeBtn.title = s("minimize");
      minimizeBtn.setAttribute("aria-label", s("minimize"));
    }
    refreshElapsed();
    startTicker();
  });
})();
