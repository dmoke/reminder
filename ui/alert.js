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
  // "overdue" = most overdue first (earliest due time); "recent" = least overdue.
  var sortDir = "overdue";

  // Built-once chrome elements (header/toolbar/list host/bulk host/footer), so a
  // data update only re-renders the list and the search box keeps focus.
  var chrome = null;

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
        snoozeReminder(id, opt.kind, time);
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
      completeBtn.disabled = true; // guard against rapid double-click
      completeReminder(r.id, r.time);
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

    // List host + bulk host (re-rendered each payload).
    var listHost = el("div", "alert-list");
    root.appendChild(listHost);
    var bulkHost = el("div", "alert-bulk-host");
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
    applySortLabel();
  }

  // Render just the list + bulk actions from the current filter/sort.
  function renderList() {
    if (!chrome) return;
    var visible = getVisible();
    chrome.count.textContent = String(currentReminders.length);

    chrome.listHost.textContent = "";
    if (visible.length === 0) {
      chrome.listHost.appendChild(el("div", "alert-empty", s("no-matches")));
    } else {
      visible.forEach(function (r) {
        chrome.listHost.appendChild(buildRow(r));
      });
    }

    // Bulk actions when more than one reminder is visible.
    chrome.bulkHost.textContent = "";
    if (visible.length > 1) {
      var bulk = el("div", "alert-bulk");
      var completeAllBtn = el("button", "alert-btn alert-btn-complete", s("complete-all"));
      completeAllBtn.type = "button";
      completeAllBtn.addEventListener("click", function () {
        completeAll(visible);
      });
      bulk.appendChild(completeAllBtn);

      var snoozeAllBtn = el(
        "button",
        "alert-btn alert-btn-snooze",
        s("snooze-all") + " (" + s("snooze-10m") + ")"
      );
      snoozeAllBtn.type = "button";
      snoozeAllBtn.addEventListener("click", function () {
        snoozeAll("10m", visible);
      });
      bulk.appendChild(snoozeAllBtn);
      chrome.bulkHost.appendChild(bulk);
    }
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
    currentReminders = (Array.isArray(payload.reminders) ? payload.reminders : []).map(normalize);
    currentStrings = payload.strings && typeof payload.strings === "object" ? payload.strings : {};
    currentLang = payload.lang === "uk" ? "uk" : "en";

    document.documentElement.setAttribute("lang", currentLang);

    render();
    startTicker();
    // Only sound the attention cue when a genuinely new reminder appeared,
    // not when the set merely shrank or the language changed.
    if (payload.isNew) playBeep();
  });
})();
