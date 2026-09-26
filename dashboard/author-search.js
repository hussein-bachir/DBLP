(function () {
  "use strict";

  // Author lookup: a search box at the top of the page backed by the local
  // API in server.py (over the SQLite index from build_author_index.py), and a
  // profile panel for the researcher you pick. Names and titles come from
  // DBLP, so they are only ever inserted with textContent, never innerHTML.

  var dash = window.dashboard;
  var PAGE_SIZE = 50;
  var DEFAULT_HINT = "";

  function $(id) { return document.getElementById(id); }

  var els = {
    input: $("author-search"), list: $("author-results"), status: $("author-search-status"),
    profile: $("author-profile"), name: $("profile-name"), sub: $("profile-sub"), note: $("profile-note"),
    stats: $("profile-stats"), coauthors: $("profile-coauthors"), papers: $("profile-papers"),
    more: $("profile-more"), count: $("profile-pubcount"), close: $("profile-close"),
    netBtn: $("profile-network"), dblp: $("profile-dblp"),
  };
  if (!els.input || !dash) return;

  var state = {
    options: [], active: -1, lastQuery: "", timer: null,
    searchId: 0, profileId: 0, current: null, loaded: 0,
  };

  // ---------- helpers ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // DBLP tells apart people who share a name with a trailing number
  function splitName(raw) {
    var m = /^(.*\S)\s+(\d{4})$/.exec(raw);
    return m ? { base: m[1], tag: m[2] } : { base: raw, tag: null };
  }

  function yearSpan(first, last) {
    if (!first) return "no dated papers";
    return first === last ? String(first) : first + "–" + last;
  }

  function plural(n, word, many) { return dash.fmt(n) + " " + (n === 1 ? word : many || word + "s"); }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.style.color = isError ? "#E3A8AF" : "";
  }

  // fetch JSON from the API, telling "no API here" (plain static server) apart
  // from "API up but the index isn't built" and ordinary errors
  function api(path) {
    function fail(code, message) {
      var err = new Error(message);
      err.code = code;
      throw err;
    }
    return fetch(path).then(function (res) {
      var isJson = (res.headers.get("content-type") || "").indexOf("json") !== -1;
      if (res.status === 503 && isJson) fail("noindex", "index not built");
      if (!isJson) fail("unavailable", "no API at this address");
      return res.json().then(function (body) {
        if (!res.ok) fail("error", body.error || "HTTP " + res.status);
        return body;
      });
    }, function () { fail("unavailable", "server not reachable"); });
  }

  function showApiError(err) {
    if (err.code === "unavailable") {
      setStatus("Author search needs the dashboard server. In the dashboard folder run  python server.py  " +
        "and open http://localhost:8000/index.html (the charts below work without it).", true);
    } else if (err.code === "noindex") {
      setStatus("The author index hasn't been built yet. In the dashboard folder run  " +
        "python build_author_index.py  (a few minutes), then restart server.py.", true);
    } else {
      setStatus("Search failed: " + err.message, true);
    }
  }

  // ---------- results dropdown ----------
  function closeList() {
    els.list.hidden = true;
    els.input.setAttribute("aria-expanded", "false");
    els.input.removeAttribute("aria-activedescendant");
    state.active = -1;
  }

  function setActive(index) {
    var items = els.list.querySelectorAll('[role="option"]');
    if (!items.length) return;
    state.active = (index + items.length) % items.length;
    items.forEach(function (li, i) { li.setAttribute("aria-selected", i === state.active ? "true" : "false"); });
    var active = items[state.active];
    els.input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function optionNode(result, index) {
    var parts = splitName(result.name);
    var li = el("li");
    li.id = "author-opt-" + index;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    var nameLine = el("div", "opt-name", parts.base + (parts.tag ? " " : ""));
    if (parts.tag) {
      var tag = el("span", "opt-tag", parts.tag);
      tag.title = "DBLP tells people who share a name apart with a number";
      nameLine.appendChild(tag);
    }
    var venues = result.venues.map(function (v) { return v.venue + " ×" + v.count; }).join(", ");
    li.appendChild(nameLine);
    li.appendChild(el("div", "opt-meta",
      plural(result.n_papers, "paper") + " · " + yearSpan(result.first_year, result.last_year) +
      (venues ? " · " + venues : "")));
    // mousedown would blur the input (closing the list) before the click lands
    li.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    li.addEventListener("click", function () { openAuthor(result.id); });
    return li;
  }

  function renderResults(query, data) {
    els.list.textContent = "";
    state.options = data.results;
    state.lastQuery = query;
    if (data.hint) { closeList(); setStatus(data.hint); return; }
    if (!data.results.length) {
      closeList();
      setStatus("No researcher found for “" + query + "”. Try fewer letters or another spelling.");
      return;
    }
    if (data.corrected) {
      var note = el("li", "opt-note", "No exact match for “" + query + "” — closest names for “" + data.corrected + "”:");
      note.setAttribute("role", "presentation");
      els.list.appendChild(note);
    }
    data.results.forEach(function (r, i) { els.list.appendChild(optionNode(r, i)); });
    els.list.hidden = false;
    els.input.setAttribute("aria-expanded", "true");
    setActive(0);
    setStatus(plural(data.results.length, "match", "matches") + (data.corrected ? " (spelling corrected)" : "") +
      ". Use ↑ ↓ and Enter, or click a name.");
  }

  function runSearch(query) {
    var id = ++state.searchId;
    setStatus("Searching…");
    api("/api/search?q=" + encodeURIComponent(query)).then(function (data) {
      if (id === state.searchId) renderResults(query, data);   // ignore stale answers
    }).catch(function (err) {
      if (id !== state.searchId) return;
      closeList();
      showApiError(err);
    });
  }

  els.input.addEventListener("input", function () {
    var query = els.input.value.trim();
    clearTimeout(state.timer);
    state.searchId++;   // drop any in-flight answer for older text
    if (query.length < 3) {
      closeList();
      setStatus(query ? "Type at least 3 letters of a name." : DEFAULT_HINT);
      return;
    }
    state.timer = setTimeout(function () { runSearch(query); }, 220);
  });

  els.input.addEventListener("keydown", function (ev) {
    var open = !els.list.hidden;
    if (ev.key === "ArrowDown" && open) { ev.preventDefault(); setActive(state.active + 1); }
    else if (ev.key === "ArrowUp" && open) { ev.preventDefault(); setActive(state.active - 1); }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      // only pick from a list that answers what is typed now, not an earlier query
      if (open && state.options[state.active] && els.input.value.trim() === state.lastQuery) {
        openAuthor(state.options[state.active].id);
      } else if (els.input.value.trim().length >= 3) {
        clearTimeout(state.timer);
        runSearch(els.input.value.trim());
      }
    } else if (ev.key === "Escape" && open) { closeList(); }
  });

  els.input.addEventListener("blur", closeList);
  els.input.addEventListener("focus", function () {
    if (state.options.length && els.input.value.trim() === state.lastQuery) {
      els.list.hidden = false;
      els.input.setAttribute("aria-expanded", "true");
      setActive(Math.max(state.active, 0));
    }
  });

  // ---------- profile ----------
  function statNode(label, value) {
    var box = el("div", "stat");
    box.appendChild(el("div", "stat-label", label));
    box.appendChild(el("div", "stat-value", value));
    return box;
  }

  function pubNode(paper) {
    var li = el("li");
    var link = el("a", null, paper.title || "(untitled)");
    // dblp.org/rec/<key> is DBLP's page for a record; the host is fixed here
    link.href = "https://dblp.org/rec/" + paper.key.split("/").map(encodeURIComponent).join("/");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    li.appendChild(link);
    li.appendChild(el("div", "pub-meta", [
      paper.year || "year n/a", paper.venue,
      paper.type === "article" ? "journal article" : "conference paper",
    ].join(" · ")));
    return li;
  }

  function renderYearsChart(perYear) {
    var box = $("profile-years");
    if (!perYear.length) {
      var old = echarts.getInstanceByDom(box);
      if (old) old.dispose();
      box.textContent = "No dated papers.";
      return;
    }
    box.textContent = "";
    var counts = {};
    perYear.forEach(function (row) { counts[row[0]] = row[1]; });
    var first = perYear[0][0], last = perYear[perYear.length - 1][0];
    var years = [], values = [];
    for (var y = first; y <= last; y++) { years.push(y); values.push(counts[y] || 0); }
    dash.makeChart("profile-years", {
      grid: dash.baseGrid({ top: 16, bottom: 28 }),
      tooltip: dash.tooltipCommon({ trigger: "axis", axisPointer: { type: "shadow" } }),
      xAxis: Object.assign({ type: "category", data: years }, dash.axisCommon()),
      yAxis: Object.assign({ type: "value", minInterval: 1 }, dash.axisCommon()),
      series: [{ type: "bar", data: values, barMaxWidth: 26, itemStyle: { color: dash.COLOR.gold } }],
    });
  }

  function renderVenuesChart(venues) {
    var rows = venues.slice().reverse();
    dash.makeChart("profile-venues", {
      grid: dash.baseGrid({ left: 150, top: 16, bottom: 28 }),
      tooltip: dash.tooltipCommon({ trigger: "axis", axisPointer: { type: "shadow" } }),
      xAxis: Object.assign({ type: "value", minInterval: 1 }, dash.axisCommon()),
      yAxis: Object.assign({ type: "category", data: rows.map(function (v) { return v.venue; }) }, dash.axisCommon(), {
        axisLabel: Object.assign({}, dash.axisCommon().axisLabel, { fontSize: 11 }),
      }),
      series: [{
        type: "bar", data: rows.map(function (v) { return v.count; }), barMaxWidth: 16,
        itemStyle: { color: dash.COLOR.verdigris, borderRadius: [0, 3, 3, 0] },
      }],
    });
  }

  function updatePubCount() {
    var total = state.current.n_papers;
    els.count.textContent = "(showing " + dash.fmt(Math.min(state.loaded, total)) + " of " + dash.fmt(total) + ", newest first)";
    els.more.hidden = state.loaded >= total;
    els.more.disabled = false;
  }

  function renderProfile(p) {
    state.current = p;
    state.loaded = p.papers.length;
    var parts = splitName(p.name);

    els.name.textContent = parts.base + (parts.tag ? " " : "");
    if (parts.tag) {
      var tag = el("span", "opt-tag", parts.tag);
      tag.title = "DBLP tells people who share a name apart with a number";
      els.name.appendChild(tag);
    }
    els.sub.textContent = plural(p.n_papers, "paper") + " · " + yearSpan(p.first_year, p.last_year) +
      " · " + plural(p.n_coauthors, "co-author");

    var note = "From DBLP’s publication records only. DBLP has no affiliation data, so use the venues and " +
      "co-authors below to check this is the person you mean.";
    if (parts.tag) {
      note += " DBLP keeps different people with the same name apart by number; this is “" + parts.tag +
        "”, and the others appear as separate results.";
    }
    if (p.last_year && p.last_year >= 2026) note += " 2026 is still being indexed, so recent counts are partial.";
    els.note.textContent = note;

    els.stats.textContent = "";
    [["Papers", dash.fmt(p.n_papers)], ["Journal articles", dash.fmt(p.n_articles)],
     ["Conference papers", dash.fmt(p.n_inproceedings)], ["Co-authors", dash.fmt(p.n_coauthors)],
     ["Venues", dash.fmt(p.n_venues)]].forEach(function (s) { els.stats.appendChild(statNode(s[0], s[1])); });

    els.coauthors.textContent = "";
    if (!p.coauthors.length) els.coauthors.appendChild(el("li", "opt-note", "No co-authors on record."));
    p.coauthors.forEach(function (c) {
      var li = el("li");
      var btn = el("button");
      btn.type = "button";
      btn.appendChild(document.createTextNode(splitName(c.name).base + (splitName(c.name).tag ? " " + splitName(c.name).tag : "")));
      btn.appendChild(el("span", "chip-n", "×" + c.shared));
      btn.title = c.shared + " shared paper" + (c.shared === 1 ? "" : "s") + " — open this profile";
      btn.addEventListener("click", function () { openAuthor(c.id); });
      li.appendChild(btn);
      els.coauthors.appendChild(li);
    });

    els.papers.textContent = "";
    p.papers.forEach(function (paper) { els.papers.appendChild(pubNode(paper)); });
    updatePubCount();

    els.dblp.href = "https://dblp.org/search?q=" + encodeURIComponent(parts.base);
    els.netBtn.hidden = !(dash.network && dash.network.has(p.name));

    // unhide first so the charts measure a real width
    els.profile.hidden = false;
    renderYearsChart(p.per_year);
    renderVenuesChart(p.venues);

    els.name.tabIndex = -1;
    els.name.focus({ preventScroll: true });
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.profile.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }

  function openAuthor(id, silent) {
    closeList();
    var request = ++state.profileId;
    setStatus("Loading profile…");
    api("/api/author?id=" + encodeURIComponent(id)).then(function (p) {
      if (request !== state.profileId) return;
      els.input.value = p.name;
      state.lastQuery = "";
      state.options = [];
      renderProfile(p);
      setStatus(DEFAULT_HINT);
      if (!silent) history.replaceState(null, "", "#author=" + p.id);
    }).catch(function (err) {
      if (request !== state.profileId) return;
      if (err.code === "error") setStatus("Couldn’t load that profile: " + err.message, true);
      else showApiError(err);
    });
  }

  els.more.addEventListener("click", function () {
    var p = state.current;
    els.more.disabled = true;
    api("/api/papers?id=" + p.id + "&offset=" + state.loaded + "&limit=" + PAGE_SIZE).then(function (body) {
      if (state.current !== p) return;
      body.papers.forEach(function (paper) { els.papers.appendChild(pubNode(paper)); });
      state.loaded += body.papers.length;
      if (!body.papers.length) state.loaded = p.n_papers;   // nothing more to fetch
      updatePubCount();
    }).catch(function (err) { els.more.disabled = false; showApiError(err); });
  });

  els.close.addEventListener("click", function () {
    els.profile.hidden = true;
    state.current = null;
    history.replaceState(null, "", location.pathname + location.search);
    els.input.focus();
  });

  els.netBtn.addEventListener("click", function () {
    if (!state.current || !dash.network) return;
    dash.network.select(state.current.name);
    $("chart-network").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- startup: is the API there? open #author=<id> if linked ----------
  api("/api/status").then(function (info) {
    DEFAULT_HINT = "Searching " + dash.fmt(info.authors) + " researchers across " + dash.fmt(info.papers) +
      " DBLP records. Small misspellings are forgiven.";
    setStatus(DEFAULT_HINT);
    var m = /^#author=(\d+)$/.exec(location.hash);
    if (m) openAuthor(m[1], true);
  }).catch(showApiError);
})();
