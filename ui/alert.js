// MODULE A — Always-on-top Alert Window renderer.
// Vanilla DOM only. contextIsolation is on, so the only bridge to the main
// process is window.alertAPI. All user-facing text comes from the `strings`
// map + `lang` provided in the data payload (no hardcoded English).

(function () {
  "use strict";

  if (!window.alertAPI) return;

  var root = document.getElementById("alertRoot");
  if (!root) return;

  // Latest payload state.
  var currentReminders = [];
  var currentStrings = {};
  var currentLang = "en";

  // Toolbar state (persist across data updates).
  var searchTerm = "";
  // "recent" = least overdue first (latest-appearing reminder on top — the
  // default, so a just-due reminder shows up top); "overdue" = most overdue first.
  var sortDir = "recent";

  // Built-once chrome elements (header/toolbar/list host/bulk host/footer), so a
  // data update only re-renders the list and the search box keeps focus.
  var chrome = null;

  // Keyed row cache (reminder id -> row element). A data update reconciles
  // against this — adding/removing only the rows that actually changed — instead
  // of rebuilding the whole list, which used to destroy buttons mid-click. Reset
  // on a language change (the button labels differ).
  var rowEls = {};
  var lastVisible = [];
  var forceRowRebuild = false;
  // id -> expiry timestamp for reminders the user just resolved. Incoming
  // payloads suppress these for a short grace window so a scheduler tick that
  // fires before the storage write lands can't flicker the row back. After the
  // window they're honored again, so a genuinely failed action still reappears.
  var pendingRemoved = {};
  var PENDING_MS = 2500;

  // After the user resolves a reminder, the alert's action buttons are disabled
  // for this long (from the payload; settable in Settings) so a fast second click
  // can't accidentally resolve the next reminder, which may have just shifted up
  // under the cursor. 0 disables it.
  var cooldownMs = 1000;
  var cooldownTimer = null;

  function isCoolingDown() {
    return cooldownTimer !== null;
  }

  function startCooldown() {
    if (!cooldownMs || cooldownMs <= 0) return;
    if (cooldownTimer !== null) window.clearTimeout(cooldownTimer);
    if (root) root.classList.add("cooling");
    cooldownTimer = window.setTimeout(function () {
      cooldownTimer = null;
      if (root) root.classList.remove("cooling");
    }, cooldownMs);
  }

  // setInterval handle for the live "overdue by" refresh.
  var tickTimer = null;

  // --- Helpers ---------------------------------------------------------------

  function s(key) {
    // Defensive string lookup: fall back to the key itself if missing.
    if (currentStrings && Object.prototype.hasOwnProperty.call(currentStrings, key)) {
      return currentStrings[key];
    }
    return key;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Normalize a reminder with defensive defaults for optional fields.
  function normalize(r) {
    return {
      id: r && r.id != null ? r.id : "",
      text: r && r.text != null ? r.text : "",
      emoji: r && r.emoji != null ? r.emoji : "",
      time: r && r.time != null ? r.time : "",
      tags: r && Array.isArray(r.tags) ? r.tags : [],
      favorite: !!(r && r.favorite),
      recurrence: r && r.recurrence ? r.recurrence : "none"
    };
  }

  // Build a human relative line for how overdue / how soon a reminder is.
  function relativeLine(isoTime) {
    var due = new Date(isoTime);
    if (isNaN(due.getTime())) return s("due-now");

    var diffMs = Date.now() - due.getTime();
    var overdue = diffMs >= 0;
    var totalMinutes = Math.floor(Math.abs(diffMs) / 60000);

    // Within a minute either way -> "Due now".
    if (totalMinutes < 1) return s("due-now");

    var parts = formatDuration(totalMinutes);
    // overdue-by / due-now are the only strings we have; for the not-yet-due
    // edge case (clock skew / pre-fire) we still show the duration with the
    // due-now label as a soft fallback to avoid hardcoded English.
    if (overdue) {
      return s("overdue-by") + " " + parts;
    }
    return s("due-now");
  }

  // Compact duration: days/hours/minutes, language-agnostic numbers + units
  // derived from the strings map where possible. We only have minute/hour
  // labels embedded in snooze strings, so keep this numeric + short unit
  // markers built from locale-independent abbreviations.
  function formatDuration(totalMinutes) {
    var days = Math.floor(totalMinutes / 1440);
    var hours = Math.floor((totalMinutes % 1440) / 60);
    var minutes = totalMinutes % 60;

    var segs = [];
    if (days > 0) segs.push(days + unit("d"));
    if (hours > 0) segs.push(hours + unit("h"));
    if (minutes > 0 && days === 0) segs.push(minutes + unit("m"));
    if (segs.length === 0) segs.push(minutes + unit("m"));
    return segs.join(" ");
  }

  // Localized short unit markers. Use Ukrainian abbreviations when lang is uk.
  function unit(kind) {
    var uk = { d: "д", h: "год", m: "хв" };
    var en = { d: "d", h: "h", m: "m" };
    var map = currentLang === "uk" ? uk : en;
    return map[kind] || kind;
  }

  // --- Snooze target computation --------------------------------------------

  function snoozeIso(kind, baseIso) {
    var now = new Date();
    if (kind === "10m") {
      now.setMinutes(now.getMinutes() + 10);
      return now.toISOString();
    }
    if (kind === "1h") {
      now.setHours(now.getHours() + 1);
      return now.toISOString();
    }
    if (kind === "3h") {
      now.setHours(now.getHours() + 3);
      return now.toISOString();
    }
    if (kind === "tomorrow") {
      // Tomorrow at the reminder's own time-of-day ("same time").
      var src = baseIso ? new Date(baseIso) : null;
      now.setDate(now.getDate() + 1);
      if (src && !isNaN(src.getTime())) {
        now.setHours(src.getHours(), src.getMinutes(), 0, 0);
      } else {
        now.setHours(9, 0, 0, 0);
      }
      return now.toISOString();
    }
    if (kind === "2d" || kind === "1w") {
      // Day-based: preserve the reminder's own time-of-day when available.
      var srcDay = baseIso ? new Date(baseIso) : null;
      now.setDate(now.getDate() + (kind === "1w" ? 7 : 2));
      if (srcDay && !isNaN(srcDay.getTime())) {
        now.setHours(srcDay.getHours(), srcDay.getMinutes(), 0, 0);
      }
      return now.toISOString();
    }
    if (kind === "1mo") {
      now.setMonth(now.getMonth() + 1);
      return now.toISOString();
    }
    if (kind === "1y") {
      now.setFullYear(now.getFullYear() + 1);
      return now.toISOString();
    }
    // Fallback: 10 minutes.
    now.setMinutes(now.getMinutes() + 10);
    return now.toISOString();
  }

  // --- Audio attention cue ---------------------------------------------------

  function playBeep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var startAt = ctx.currentTime;

      // Two short beeps.
      var schedule = [
        { at: 0, freq: 880 },
        { at: 0.18, freq: 1175 }
      ];

      schedule.forEach(function (b) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = b.freq;
        var t0 = startAt + b.at;
        var t1 = t0 + 0.14;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t1 + 0.02);
      });

      // Close the context shortly after playback to free resources.
      window.setTimeout(function () {
        try {
          ctx.close();
        } catch (e) {
          /* ignore */
        }
      }, 800);
    } catch (e) {
      // Audio is best-effort; never let it break rendering.
    }
  }

  // --- Action wiring ---------------------------------------------------------

  function callApi(promiseLike) {
    // alertAPI methods return promises; swallow rejections so a single
    // failure doesn't leave the window in a broken state.
    try {
      var p = promiseLike;
      if (p && typeof p.then === "function") {
        p.catch(function () {
          /* ignore */
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  function completeReminder(id, expectedTime) {
    callApi(window.alertAPI.complete(id, expectedTime));
  }

  function snoozeReminder(id, kind, baseIso) {
    callApi(window.alertAPI.snooze(id, snoozeIso(kind, baseIso)));
  }

  // Bulk actions operate on the currently-VISIBLE (filtered) set, so a search
  // narrows what "Complete all" / "Snooze all" touch.
  function completeAll(list) {
    list.forEach(function (r) {
      if (r.id) completeReminder(r.id, r.time);
    });
  }

  function snoozeAll(kind, list) {
    var iso = null;
    list.forEach(function (r) {
      if (r.id) {
        // Recompute fresh per id so all land at ~the same +10m offset.
        if (iso === null) iso = snoozeIso(kind);
        callApi(window.alertAPI.snooze(r.id, iso));
      }
    });
  }

  // Instant feedback: drop the acted-on reminders from the local set and
  // re-render right away, rather than waiting up to a second for the scheduler
  // tick to report the change. Self-heals if the action somehow fails — the
  // reminder is still due, so the next payload re-adds its row.
  function optimisticRemove(ids) {
    var drop = {};
    var expiry = Date.now() + PENDING_MS;
    ids.forEach(function (id) {
      if (id) {
        drop[id] = true;
        pendingRemoved[id] = expiry;
      }
    });
    currentReminders = currentReminders.filter(function (r) {
      return !drop[r.id];
    });
    renderList();
  }

  // --- Filtering + sorting ---------------------------------------------------

  function getVisible() {
    var term = searchTerm.trim().toLowerCase();
    var list = currentReminders.filter(function (r) {
      if (!term) return true;
      if (r.text && r.text.toLowerCase().indexOf(term) !== -1) return true;
      for (var i = 0; i < r.tags.length; i++) {
        if (String(r.tags[i]).toLowerCase().indexOf(term) !== -1) return true;
      }
      return false;
    });
    list.sort(function (a, b) {
      var ta = new Date(a.time).getTime();
      var tb = new Date(b.time).getTime();
      if (isNaN(ta)) ta = 0;
      if (isNaN(tb)) tb = 0;
      // "overdue" = earliest due time first (most overdue at the top).
      return sortDir === "overdue" ? ta - tb : tb - ta;
    });
    return list;
  }

  // --- Rendering -------------------------------------------------------------

  function buildSnoozeControl(id, time) {
    var wrap = el("div", "alert-snooze");
    wrap.appendChild(el("span", "alert-snooze-label", s("snooze")));

    var options = [
      { kind: "10m", label: s("snooze-10m") },
      { kind: "1h", label: s("snooze-1h") },
      { kind: "3h", label: s("snooze-3h") },
      { kind: "tomorrow", label: s("snooze-tomorrow") },
      { kind: "2d", label: s("snooze-2d") },
      { kind: "1w", label: s("snooze-1w") },
      { kind: "1mo", label: s("snooze-1mo") },
      { kind: "1y", label: s("snooze-1y") }
    ];

    options.forEach(function (opt) {
      var btn = el("button", "alert-btn alert-btn-snooze", opt.label);
      btn.type = "button";
      btn.addEventListener("click", function () {
        if (isCoolingDown()) return;
        snoozeReminder(id, opt.kind, time);
        optimisticRemove([id]);
        startCooldown();
      });
      wrap.appendChild(btn);
    });

    // Last option: open the app's edit modal to pick a custom time. The main
    // process suppresses this alert while editing so it can't cover the modal.
    if (typeof window.alertAPI.edit === "function") {
      var customBtn = el(
        "button",
        "alert-btn alert-btn-snooze alert-btn-custom",
        s("snooze-custom"),
      );
      customBtn.type = "button";
      customBtn.addEventListener("click", function () {
        if (isCoolingDown()) return;
        callApi(window.alertAPI.edit(id));
      });
      wrap.appendChild(customBtn);
    }

    return wrap;
  }

  function buildRow(r) {
    var row = el("div", "alert-row");

    // Header line: text + favorite star.
    var head = el("div", "alert-row-head");
    var title = el("div", "alert-row-text", (r.emoji ? r.emoji + " " : "") + r.text);
    head.appendChild(title);
    if (r.favorite) {
      head.appendChild(el("span", "alert-star", "★"));
    }
    row.appendChild(head);

    // Relative time line (kept refreshable via data attribute).
    var rel = el("div", "alert-row-rel", relativeLine(r.time));
    rel.setAttribute("data-time", r.time);
    row.appendChild(rel);

    // Meta line: tag chips + recurring indicator.
    if ((r.tags && r.tags.length) || r.recurrence !== "none") {
      var meta = el("div", "alert-row-meta");
      r.tags.forEach(function (tag) {
        if (tag == null || tag === "") return;
        meta.appendChild(el("span", "alert-chip", String(tag)));
      });
      if (r.recurrence !== "none") {
        meta.appendChild(el("span", "alert-chip alert-chip-recurring", "⟳ " + s("recurring")));
      }
      row.appendChild(meta);
    }

    // Actions: Complete + Snooze options.
    var actions = el("div", "alert-row-actions");
    var completeBtn = el("button", "alert-btn alert-btn-complete", s("complete"));
    completeBtn.type = "button";
    completeBtn.addEventListener("click", function () {
      if (isCoolingDown()) return;
      completeBtn.disabled = true; // guard against rapid double-click
      completeReminder(r.id, r.time);
      optimisticRemove([r.id]);
      startCooldown();
    });
    actions.appendChild(completeBtn);
    actions.appendChild(buildSnoozeControl(r.id, r.time));
    row.appendChild(actions);

    return row;
  }

  // Build the static chrome once. Returns an object of the live regions that
  // render() updates on each data payload.
  function buildChrome() {
    root.textContent = "";

    // Header: bell + title + count + minimize button.
    var header = el("div", "alert-header");
    header.appendChild(el("span", "alert-bell", "🔔"));
    var titleWrap = el("div", "alert-title-wrap");
    var titleEl = el("h1", "alert-title", s("title"));
    var countEl = el("span", "alert-count", "0");
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(countEl);
    header.appendChild(titleWrap);
    root.appendChild(header);

    // Toolbar: search box + sort toggle.
    var toolbar = el("div", "alert-toolbar");
    var search = document.createElement("input");
    search.type = "text";
    search.className = "alert-search";
    search.placeholder = s("search-ph");
    search.value = searchTerm;
    search.addEventListener("input", function () {
      searchTerm = search.value;
      renderList();
    });
    toolbar.appendChild(search);

    var sortBtn = el("button", "alert-sort-btn");
    sortBtn.type = "button";
    sortBtn.addEventListener("click", function () {
      sortDir = sortDir === "overdue" ? "recent" : "overdue";
      applySortLabel();
      renderList();
    });
    toolbar.appendChild(sortBtn);
    root.appendChild(toolbar);

    // List host — rows are reconciled in place (see renderList).
    var listHost = el("div", "alert-list");
    root.appendChild(listHost);

    // Bulk actions: built once and shown only when >1 reminder is visible, so
    // the buttons aren't destroyed under the cursor on every data update. The
    // handlers read the live `lastVisible` set, so a search narrows their reach.
    var bulkHost = el("div", "alert-bulk-host");
    var bulk = el("div", "alert-bulk");
    var completeAllBtn = el("button", "alert-btn alert-btn-complete");
    completeAllBtn.type = "button";
    completeAllBtn.addEventListener("click", function () {
      if (isCoolingDown()) return;
      var ids = lastVisible.map(function (r) { return r.id; });
      completeAll(lastVisible);
      optimisticRemove(ids);
      startCooldown();
    });
    var snoozeAllBtn = el("button", "alert-btn alert-btn-snooze");
    snoozeAllBtn.type = "button";
    snoozeAllBtn.addEventListener("click", function () {
      if (isCoolingDown()) return;
      var ids = lastVisible.map(function (r) { return r.id; });
      snoozeAll("10m", lastVisible);
      optimisticRemove(ids);
      startCooldown();
    });
    bulk.appendChild(completeAllBtn);
    bulk.appendChild(snoozeAllBtn);
    bulkHost.appendChild(bulk);
    bulkHost.style.display = "none";
    root.appendChild(bulkHost);

    // Footer: Open app + Dismiss (static).
    var footer = el("div", "alert-footer");
    var openBtn = el("button", "alert-btn alert-btn-open", s("open-app"));
    openBtn.type = "button";
    openBtn.addEventListener("click", function () {
      try {
        window.alertAPI.openApp();
      } catch (e) {
        /* ignore */
      }
    });
    footer.appendChild(openBtn);
    var dismissBtn = el("button", "alert-btn alert-btn-dismiss", s("dismiss"));
    dismissBtn.type = "button";
    dismissBtn.addEventListener("click", function () {
      try {
        window.alertAPI.dismiss();
      } catch (e) {
        /* ignore */
      }
    });
    footer.appendChild(dismissBtn);
    root.appendChild(footer);

    chrome = {
      title: titleEl,
      count: countEl,
      search: search,
      sortBtn: sortBtn,
      listHost: listHost,
      bulkHost: bulkHost,
      completeAllBtn: completeAllBtn,
      snoozeAllBtn: snoozeAllBtn,
      openBtn: openBtn,
      dismissBtn: dismissBtn
    };
    applySortLabel();
  }

  function applySortLabel() {
    if (!chrome) return;
    var key = sortDir === "overdue" ? "sort-overdue" : "sort-recent";
    chrome.sortBtn.textContent = "⇅ " + s(key);
  }

  // Refresh the localized text on the static chrome (called on each payload so a
  // language switch updates it without rebuilding the whole window).
  function applyChromeStrings() {
    if (!chrome) return;
    chrome.title.textContent = s("title");
    chrome.search.placeholder = s("search-ph");
    chrome.openBtn.textContent = s("open-app");
    chrome.dismissBtn.textContent = s("dismiss");
    chrome.completeAllBtn.textContent = s("complete-all");
    chrome.snoozeAllBtn.textContent = s("snooze-all") + " (" + s("snooze-10m") + ")";
    applySortLabel();
  }

  // Reconcile the list against the current filter/sort: keep existing rows (so
  // their buttons survive a data update mid-click), removing only the rows that
  // left and inserting only the rows that arrived, in the right order.
  function renderList() {
    if (!chrome) return;

    // A language change needs fresh rows (button labels differ).
    if (forceRowRebuild) {
      chrome.listHost.textContent = "";
      rowEls = {};
      forceRowRebuild = false;
    }

    var visible = getVisible();
    lastVisible = visible;
    chrome.count.textContent = String(currentReminders.length);

    if (visible.length === 0) {
      chrome.listHost.textContent = "";
      rowEls = {};
      chrome.listHost.appendChild(el("div", "alert-empty", s("no-matches")));
      chrome.bulkHost.style.display = "none";
      return;
    }

    var emptyNode = chrome.listHost.querySelector(".alert-empty");
    if (emptyNode && emptyNode.parentNode) {
      emptyNode.parentNode.removeChild(emptyNode);
    }

    var visibleIds = {};
    visible.forEach(function (r) {
      visibleIds[r.id] = true;
    });

    // Drop rows that are no longer visible.
    Object.keys(rowEls).forEach(function (id) {
      if (!visibleIds[id]) {
        var gone = rowEls[id];
        if (gone && gone.parentNode) gone.parentNode.removeChild(gone);
        delete rowEls[id];
      }
    });

    // Add/keep each visible row, in order. Existing rows are left intact except
    // for an in-place refresh of their "overdue by" line.
    visible.forEach(function (r, i) {
      var node = rowEls[r.id];
      if (!node) {
        node = buildRow(r);
        rowEls[r.id] = node;
      } else {
        var rel = node.querySelector(".alert-row-rel");
        if (rel) rel.textContent = relativeLine(r.time);
      }
      if (chrome.listHost.children[i] !== node) {
        chrome.listHost.insertBefore(node, chrome.listHost.children[i] || null);
      }
    });

    chrome.bulkHost.style.display = visible.length > 1 ? "" : "none";
  }

  function render() {
    if (!chrome) buildChrome();
    applyChromeStrings();
    renderList();
  }

  // Refresh only the relative-time text in place (no full re-render).
  function refreshRelativeTimes() {
    var nodes = root.querySelectorAll(".alert-row-rel");
    for (var i = 0; i < nodes.length; i++) {
      var iso = nodes[i].getAttribute("data-time");
      nodes[i].textContent = relativeLine(iso);
    }
  }

  function startTicker() {
    if (tickTimer !== null) return;
    tickTimer = window.setInterval(refreshRelativeTimes, 30000);
  }

  // --- Data entry point ------------------------------------------------------

  window.alertAPI.onData(function (payload) {
    payload = payload || {};
    var nextLang = payload.lang === "uk" ? "uk" : "en";
    // A language switch must rebuild the rows so their button labels follow.
    if (nextLang !== currentLang) forceRowRebuild = true;
    var incoming = (Array.isArray(payload.reminders) ? payload.reminders : []).map(normalize);
    // Honor still-active pending removals (suppress the row); expire the rest.
    var now = Date.now();
    Object.keys(pendingRemoved).forEach(function (id) {
      if (pendingRemoved[id] <= now) delete pendingRemoved[id];
    });
    currentReminders = incoming.filter(function (r) {
      return !pendingRemoved[r.id];
    });
    currentStrings = payload.strings && typeof payload.strings === "object" ? payload.strings : {};
    currentLang = nextLang;
    if (typeof payload.cooldownMs === "number") cooldownMs = payload.cooldownMs;

    document.documentElement.setAttribute("lang", currentLang);

    render();
    startTicker();
    // Only sound the attention cue when a genuinely new reminder appeared,
    // not when the set merely shrank or the language changed.
    if (payload.isNew) playBeep();
  });
})();
