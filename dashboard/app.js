(function () {
  "use strict";

  var COLOR = {
    gold: "#C9A227",
    goldDim: "#8F7420",
    verdigris: "#5B8A82",
    rose: "#B76E79",
    slate: "#6B7A9E",
    clay: "#C97C5D",
    sage: "#8FA998",
    ink: "#12172B",
    card: "#1A2140",
    text: "#EDEAE0",
    textSecondary: "#9AA0B8",
    textFaint: "#6B7090",
    hairline: "#2A2F52",
  };

  // Extended qualitative palette for the co-authorship network communities
  // (13 detected clusters) -- built from the brand triad plus muted
  // complements, avoiding a default rainbow categorical scale.
  var CATEGORICAL = [
    COLOR.gold, COLOR.verdigris, COLOR.rose, COLOR.slate, COLOR.clay,
    COLOR.sage, "#D9B85C", "#7CA39B", "#C98E96", "#8A97B8",
    "#DDA089", "#AEC2A8", "#A9863C",
  ];

  var charts = [];

  function $(id) { return document.getElementById(id); }

  function fetchJSON(name) {
    return fetch("data/" + name).then(function (res) {
      if (!res.ok) {
        throw new Error("HTTP " + res.status + " fetching " + name);
      }
      return res.json();
    });
  }

  function fmt(n) {
    return n.toLocaleString("en-US");
  }

  function baseGrid(overrides) {
    return Object.assign({
      left: 56, right: 24, top: 28, bottom: 36, containLabel: true,
    }, overrides || {});
  }

  function axisCommon() {
    return {
      axisLine: { lineStyle: { color: COLOR.hairline } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.textSecondary, fontFamily: "IBM Plex Mono" },
      splitLine: { lineStyle: { color: COLOR.hairline, type: "dashed" } },
    };
  }

  function tooltipCommon(extra) {
    return Object.assign({
      backgroundColor: COLOR.card,
      borderColor: COLOR.hairline,
      textStyle: { color: COLOR.text, fontFamily: "IBM Plex Sans" },
    }, extra || {});
  }

  function makeChart(domId, option) {
    var el = $(domId);
    if (!el) return null;
    // re-rendering into the same element (e.g. the author profile charts)
    // must not leak the previous instance
    var existing = echarts.getInstanceByDom(el);
    if (existing) {
      existing.dispose();
      charts = charts.filter(function (c) { return c !== existing; });
    }
    var chart = echarts.init(el, null, { renderer: "canvas" });
    chart.setOption(option);
    charts.push(chart);
    return chart;
  }

  // Scroll/drag + slider zoom over a category year axis. The data covers every
  // year, but shares and averages are noisy in the sparse early decades, so
  // ratio-style charts open on `startYear` and the slider reaches back further.
  function yearZoom(years, startYear) {
    var startIdx = 0;
    if (startYear) {
      for (var i = 0; i < years.length; i++) {
        if (years[i] >= startYear) { startIdx = i; break; }
      }
    }
    return [
      { type: "inside", startValue: startIdx, endValue: years.length - 1 },
      {
        type: "slider", startValue: startIdx, endValue: years.length - 1,
        height: 18, bottom: 6, borderColor: COLOR.hairline,
        backgroundColor: "rgba(255,255,255,0.03)",
        fillerColor: "rgba(201,162,39,0.18)",
        handleStyle: { color: COLOR.gold, borderColor: COLOR.gold },
        moveHandleStyle: { color: COLOR.goldDim },
        dataBackground: { lineStyle: { color: COLOR.hairline }, areaStyle: { color: "rgba(255,255,255,0.04)" } },
        textStyle: { color: COLOR.textFaint, fontFamily: "IBM Plex Mono" },
      },
    ];
  }

  // ---------- stat strip ----------
  function renderOverview(data) {
    var stats = [
      { label: "Records", value: fmt(data.total_records) },
      { label: "Distinct authors", value: fmt(data.distinct_authors) },
      { label: "Distinct venues", value: fmt(data.distinct_venues) },
      { label: "Year range", value: data.year_min + "–" + data.year_max },
    ];
    var strip = $("stat-strip");
    strip.innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="stat-label">' + s.label +
        '</div><div class="stat-value">' + s.value + "</div></div>";
    }).join("");

    $("eyebrow-years").textContent = data.year_min + "–" + data.year_max;
    $("scope-note").textContent = "Every article and conference paper in the DBLP dump from " +
      data.year_min + " through " + data.year_max + " (" + fmt(data.total_records) +
      " records). " + fmt(data.excluded_records) + " records dated after " + data.year_max +
      " are left out because DBLP is still indexing those years and they understate real output.";
  }

  // ---------- publications per year ----------
  function renderPubsPerYear(rows) {
    var years = rows.map(function (r) { return r.year; });
    makeChart("chart-pubs-year", {
      grid: baseGrid({ bottom: 64 }),
      dataZoom: yearZoom(years, null),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.year; }) }, axisCommon()),
      yAxis: Object.assign({ type: "value" }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.count; }),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.gold, width: 2.5 },
        itemStyle: { color: COLOR.gold },
        areaStyle: { color: "rgba(201,162,39,0.10)" },
      }],
    });
  }

  // ---------- type distribution ----------
  function renderTypeDistribution(rows) {
    var labels = { article: "Journal article", inproceedings: "Conference paper" };
    makeChart("chart-type", {
      tooltip: tooltipCommon({ trigger: "item", formatter: "{b}: {c} ({d}%)" }),
      legend: { bottom: 0, textStyle: { color: COLOR.textSecondary, fontFamily: "IBM Plex Sans" } },
      series: [{
        type: "pie",
        radius: ["38%", "72%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: COLOR.card, borderWidth: 2 },
        // Outside labels ("Conference paper") get clipped at the canvas
        // edge in a narrow card -- the legend below already names each
        // slice, so show only the share inside the ring.
        label: { show: true, position: "inside", formatter: function (p) { return Math.round(p.percent) + "%"; }, color: COLOR.ink, fontFamily: "IBM Plex Mono", fontWeight: 600 },
        labelLine: { show: false },
        color: [COLOR.gold, COLOR.verdigris],
        data: rows.map(function (r) { return { name: labels[r.type] || r.type, value: r.count }; }),
      }],
    });
  }

  // abbreviate large tick values (5000 -> "5k") so value-axis labels don't
  // overlap in narrower cards (e.g. the top-venues bar chart)
  function abbrevNumber(v) {
    if (Math.abs(v) >= 1000) {
      var k = v / 1000;
      return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
    }
    return String(v);
  }

  // ---------- horizontal bar helper (authors / venues / words) ----------
  function renderHBar(domId, rows, nameKey, valueKey, color) {
    var sorted = rows.slice().sort(function (a, b) { return a[valueKey] - b[valueKey]; });
    makeChart(domId, {
      grid: baseGrid({ left: 160 }),
      tooltip: tooltipCommon({ trigger: "axis", axisPointer: { type: "shadow" } }),
      xAxis: Object.assign({ type: "value" }, axisCommon(), {
        axisLabel: Object.assign({}, axisCommon().axisLabel, { formatter: abbrevNumber }),
      }),
      yAxis: Object.assign({ type: "category", data: sorted.map(function (r) { return r[nameKey]; }) }, axisCommon(), {
        axisLabel: Object.assign({}, axisCommon().axisLabel, { fontSize: 11 }),
      }),
      series: [{
        type: "bar",
        data: sorted.map(function (r) { return r[valueKey]; }),
        itemStyle: { color: color, borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 16,
      }],
    });
  }

  // ---------- co-author distribution ----------
  function renderCoauthorDist(rows) {
    makeChart("chart-coauthor-dist", {
      grid: baseGrid(),
      tooltip: tooltipCommon({ trigger: "axis", axisPointer: { type: "shadow" } }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.n_authors; }), name: "authors", nameTextStyle: { color: COLOR.textFaint } }, axisCommon()),
      yAxis: Object.assign({ type: "value" }, axisCommon()),
      series: [{
        type: "bar",
        data: rows.map(function (r) { return r.count; }),
        itemStyle: { color: COLOR.verdigris },
      }],
    });
  }

  // ---------- avg team size over time ----------
  function renderTeamSize(rows) {
    var years = rows.map(function (r) { return r.year; });
    makeChart("chart-team-size", {
      grid: baseGrid({ bottom: 64 }),
      dataZoom: yearZoom(years, 1970),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: years }, axisCommon()),
      yAxis: Object.assign({ type: "value", scale: true }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.avg_authors; }),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.rose, width: 2.5 },
        itemStyle: { color: COLOR.rose },
      }],
    });
  }

  // ---------- author productivity (log scale) ----------
  function renderAuthorProductivity(rows) {
    makeChart("chart-author-productivity", {
      grid: baseGrid(),
      tooltip: tooltipCommon({ trigger: "axis", axisPointer: { type: "shadow" } }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.bucket; }), name: "papers published" }, axisCommon()),
      yAxis: Object.assign({ type: "log", name: "authors (log)" }, axisCommon()),
      series: [{
        type: "bar",
        data: rows.map(function (r) { return Math.max(r.count, 1); }),
        itemStyle: { color: COLOR.clay },
      }],
    });
  }

  // ---------- distinct venues per year ----------
  function renderVenuesPerYear(rows) {
    var years = rows.map(function (r) { return r.year; });
    makeChart("chart-venues-year", {
      grid: baseGrid({ bottom: 64 }),
      dataZoom: yearZoom(years, 1970),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: years }, axisCommon()),
      yAxis: Object.assign({ type: "value" }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.distinct_venues; }),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.sage, width: 2.5 },
        itemStyle: { color: COLOR.sage },
      }],
    });
  }

  // ---------- multi-line helper (topic trends / venue comparison) ----------
  function renderMultiLine(domId, payload, yName, startYear) {
    var years = payload.years;
    var keys = Object.keys(payload.series);
    makeChart(domId, {
      grid: baseGrid({ right: 24, bottom: 64 }),
      dataZoom: yearZoom(years, startYear),
      tooltip: tooltipCommon({ trigger: "axis" }),
      legend: { top: 0, textStyle: { color: COLOR.textSecondary, fontFamily: "IBM Plex Sans" } },
      color: CATEGORICAL,
      xAxis: Object.assign({ type: "category", data: years }, axisCommon()),
      yAxis: Object.assign({ type: "value", name: yName, nameTextStyle: { color: COLOR.textFaint } }, axisCommon()),
      series: keys.map(function (k, i) {
        return {
          name: k,
          type: "line",
          data: payload.series[k],
          smooth: true,
          showSymbol: false,
          // the palette has near-twin golds/greens; dash the later series so
          // they stay distinguishable where lines overlap
          lineStyle: { width: 2.25, type: i >= 6 ? "dashed" : "solid" },
        };
      }),
    });
  }

  // ---------- co-authorship network ----------
  function foldName(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function renderNetwork(payload) {
    // Node size scales with the data (not fixed paper counts) so the graph
    // stays readable whatever year range was aggregated.
    var byPapers = payload.nodes.slice().sort(function (a, b) { return b.papers - a.papers; });
    var rankOf = {};
    byPapers.forEach(function (n, i) { rankOf[n.id] = i; });
    var maxPapers = byPapers[0].papers;
    var LABELED_BY_DEFAULT = 12;

    var neighbors = {};
    payload.edges.forEach(function (e) {
      (neighbors[e.source] = neighbors[e.source] || {})[e.target] = e.weight;
      (neighbors[e.target] = neighbors[e.target] || {})[e.source] = e.weight;
    });

    var els = {
      search: $("net-search"), list: $("net-authors"), clear: $("net-clear"),
      topN: $("net-topn"), topNOut: $("net-topn-out"),
      minW: $("net-minw"), minWOut: $("net-minw-out"),
      status: $("net-status"),
    };
    els.topN.max = byPapers.length;
    els.topN.value = Math.min(100, byPapers.length);
    byPapers.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n.id;
      els.list.appendChild(opt);
    });

    var selected = null;
    var chart = null;
    var topNBeforeSearch = null;

    // Layout positions of the nodes currently drawn, so a selection change can
    // pin them instead of letting the force simulation restart and shuffle
    // everything while the user is trying to find someone.
    function currentPositions() {
      var pos = {};
      try {
        var data = chart.getModel().getSeriesByIndex(0).getData();
        for (var i = 0; i < data.count(); i++) {
          var p = data.getItemLayout(i);
          if (p) pos[data.getName(i)] = p;
        }
      } catch (err) { /* fall back to a free layout */ }
      return pos;
    }

    // Filters do the decluttering: most of the ~2,000 links are one- or
    // two-paper collaborations, so hiding weak links (and the authors left
    // with no link) is what separates the real research groups.
    function buildGraph(pinned) {
      var topN = +els.topN.value;
      var minW = +els.minW.value;
      var inTop = {};
      byPapers.slice(0, topN).forEach(function (n) { inTop[n.id] = true; });
      if (selected) inTop[selected] = true;

      var links = payload.edges.filter(function (e) {
        return e.weight >= minW && inTop[e.source] && inTop[e.target];
      });
      var linked = {};
      links.forEach(function (e) { linked[e.source] = linked[e.target] = true; });

      var shown = byPapers.filter(function (n) { return inTop[n.id] && (linked[n.id] || n.id === selected); });
      var near = {};
      if (selected) {
        near[selected] = true;
        links.forEach(function (e) {
          if (e.source === selected) near[e.target] = true;
          if (e.target === selected) near[e.source] = true;
        });
      }

      var nodes = shown.map(function (n, i) {
        var dim = selected && !near[n.id];
        var isSel = n.id === selected;
        var at = pinned && pinned[n.id];
        return {
          id: n.id,
          name: n.id,
          x: at ? at[0] : undefined,
          y: at ? at[1] : undefined,
          fixed: !!at,
          symbolSize: 8 + 30 * Math.sqrt(n.papers / maxPapers),
          value: n.papers,
          category: n.group,
          itemStyle: {
            color: CATEGORICAL[n.group % CATEGORICAL.length],
            opacity: dim ? 0.22 : 1,
            borderColor: COLOR.text,
            borderWidth: isSel ? 3 : 0,
          },
          label: { show: selected ? !!near[n.id] : i < LABELED_BY_DEFAULT, fontWeight: isSel ? 600 : 400, color: isSel ? COLOR.text : COLOR.textSecondary },
        };
      });
      var edges = links.map(function (e) {
        var touches = selected && (e.source === selected || e.target === selected);
        return {
          source: e.source, target: e.target, value: e.weight,
          lineStyle: {
            width: 0.6 + Math.min(e.weight, 20) * 0.1 + (touches ? 1 : 0),
            opacity: selected ? (touches ? 0.85 : 0.06) : 0.4,
            color: touches ? COLOR.gold : COLOR.textFaint,
          },
        };
      });
      return { nodes: nodes, edges: edges, totalLinks: links.length };
    }

    function describe(graph) {
      var minW = +els.minW.value;
      if (!selected) {
        return "Showing " + graph.nodes.length + " of " + byPapers.length + " authors and " +
          fmt(graph.totalLinks) + " links. Links need at least " + minW + " shared paper" +
          (minW === 1 ? "" : "s") + "; authors with no remaining link are hidden.";
      }
      var n = byPapers[rankOf[selected]];
      var all = Object.keys(neighbors[selected] || {}).length;
      var strong = Object.keys(neighbors[selected] || {}).filter(function (k) { return neighbors[selected][k] >= minW; }).length;
      return n.id + " — #" + (rankOf[selected] + 1) + " most prolific, " + fmt(n.papers) +
        " papers, cluster " + (n.group + 1) + ". Co-authored with " + all + " of the other " +
        (byPapers.length - 1) + " authors (" + strong + " at ≥" + minW + " shared papers).";
    }

    function apply(keepPositions) {
      var graph = buildGraph(keepPositions ? currentPositions() : null);
      els.topNOut.textContent = els.topN.value;
      els.minWOut.textContent = els.minW.value;
      els.clear.hidden = !selected;
      els.status.textContent = describe(graph);
      chart.setOption({ series: [{ data: graph.nodes, links: graph.edges }] });
    }

    function select(id) {
      selected = id;
      if (id) {
        els.search.value = id;
        // make sure the searched author isn't hidden by the "authors shown" slider
        if (rankOf[id] >= +els.topN.value) {
          if (topNBeforeSearch === null) topNBeforeSearch = els.topN.value;
          els.topN.value = Math.min(byPapers.length, Math.ceil((rankOf[id] + 1) / 10) * 10);
        }
      } else {
        els.search.value = "";
        if (topNBeforeSearch !== null) {
          els.topN.value = topNBeforeSearch;
          topNBeforeSearch = null;
        }
      }
      apply(true);
    }

    function findAuthor(query) {
      var q = foldName(query.trim());
      if (!q) return null;
      var pick = function (test) {
        for (var i = 0; i < byPapers.length; i++) { if (test(foldName(byPapers[i].id))) return byPapers[i].id; }
        return null;
      };
      return pick(function (s) { return s === q; }) ||
        pick(function (s) { return s.indexOf(q) === 0; }) ||
        pick(function (s) { return s.indexOf(q) !== -1; });
    }

    function submitSearch() {
      var q = els.search.value;
      if (!q.trim()) { select(null); return; }
      var hit = findAuthor(q);
      if (hit) { select(hit); return; }
      selected = null;
      apply(true);
      els.status.textContent = "No author matching “" + q.trim() + "” among the " + byPapers.length +
        " most prolific authors in this network.";
    }

    chart = makeChart("chart-network", {
      tooltip: tooltipCommon({
        formatter: function (p) {
          var enc = echarts.format.encodeHTML;
          if (p.dataType === "edge") return enc(p.data.source) + " ↔ " + enc(p.data.target) + ": " + p.data.value + " shared papers";
          return enc(p.data.name) + ": " + fmt(p.data.value) + " papers";
        },
      }),
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        force: { repulsion: 150, edgeLength: [30, 110], gravity: 0.2 },
        emphasis: { focus: "adjacency", label: { show: true } },
        label: {
          show: false,
          position: "right",
          color: COLOR.textSecondary,
          fontFamily: "IBM Plex Mono",
          fontSize: 10,
        },
        edgeSymbol: ["none", "none"],
        lineStyle: { color: COLOR.textFaint, curveness: 0.1 },
        data: [],
        links: [],
      }],
    });

    els.search.addEventListener("input", function () {
      // picking a suggestion from the datalist fills the exact name: select it immediately
      var exact = byPapers.filter(function (n) { return n.id === els.search.value; })[0];
      if (exact) select(exact.id);
    });
    els.search.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); submitSearch(); }
      if (ev.key === "Escape") { select(null); }
    });
    els.clear.addEventListener("click", function () { select(null); els.search.focus(); });
    els.topN.addEventListener("input", function () { topNBeforeSearch = null; apply(); });
    els.minW.addEventListener("input", function () { apply(); });

    apply();

    // lets the author profile (author-search.js) highlight someone here
    window.dashboard.network = {
      has: function (name) { return Object.prototype.hasOwnProperty.call(rankOf, name); },
      select: function (name) { select(name); },
    };
  }

  // shared with author-search.js, which loads after this file
  window.dashboard = {
    COLOR: COLOR,
    fmt: fmt,
    makeChart: makeChart,
    baseGrid: baseGrid,
    axisCommon: axisCommon,
    tooltipCommon: tooltipCommon,
    abbrevNumber: abbrevNumber,
    network: null,
  };

  // ---------- boot ----------
  var files = {
    overview: "overview.json",
    pubsPerYear: "publications_per_year.json",
    typeDist: "type_distribution.json",
    topAuthors: "top_authors.json",
    coauthorDist: "coauthor_distribution.json",
    topVenues: "top_venues.json",
    authorProductivity: "author_productivity.json",
    teamSize: "avg_team_size_by_year.json",
    venuesPerYear: "venues_per_year.json",
    titleWords: "top_title_words.json",
    topicTrends: "topic_trends.json",
    venueComparison: "venue_comparison.json",
    network: "coauthor_network.json",
  };

  var keys = Object.keys(files);
  Promise.all(keys.map(function (k) { return fetchJSON(files[k]); }))
    .then(function (results) {
      var data = {};
      keys.forEach(function (k, i) { data[k] = results[i]; });

      renderOverview(data.overview);
      renderPubsPerYear(data.pubsPerYear);
      renderTypeDistribution(data.typeDist);
      renderHBar("chart-top-authors", data.topAuthors, "name", "count", COLOR.gold);
      renderHBar("chart-top-venues", data.topVenues, "venue", "count", COLOR.verdigris);
      renderCoauthorDist(data.coauthorDist);
      renderTeamSize(data.teamSize);
      renderAuthorProductivity(data.authorProductivity);
      renderVenuesPerYear(data.venuesPerYear);
      renderHBar("chart-title-words", data.titleWords, "word", "count", COLOR.slate);
      renderMultiLine("chart-topic-trends", data.topicTrends, "% of titles", 1970);
      renderMultiLine("chart-venue-comparison", data.venueComparison, "papers", 1970);
      renderNetwork(data.network);

      window.addEventListener("resize", function () {
        charts.forEach(function (c) { c.resize(); });
      });
    })
    .catch(function (err) {
      var banner = $("error-banner");
      banner.hidden = false;
      banner.textContent = "Failed to load dashboard data: " + err.message +
        " -- make sure preprocess.py has been run and the folder is served " +
        "over HTTP (not opened as a file:// URL).";
      console.error(err);
    });
})();
