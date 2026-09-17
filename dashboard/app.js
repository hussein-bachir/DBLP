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
    var chart = echarts.init(el, null, { renderer: "canvas" });
    chart.setOption(option);
    charts.push(chart);
    return chart;
  }

  // ---------- stat strip ----------
  function renderOverview(data) {
    var stats = [
      { label: "Records (2019–25)", value: fmt(data.total_records) },
      { label: "Distinct authors", value: fmt(data.distinct_authors) },
      { label: "Distinct venues", value: fmt(data.distinct_venues) },
      { label: "Year range", value: data.year_min + "–" + data.year_max },
    ];
    var strip = $("stat-strip");
    strip.innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="stat-label">' + s.label +
        '</div><div class="stat-value">' + s.value + "</div></div>";
    }).join("");
  }

  // ---------- publications per year ----------
  function renderPubsPerYear(rows) {
    makeChart("chart-pubs-year", {
      grid: baseGrid(),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.year; }) }, axisCommon()),
      yAxis: Object.assign({ type: "value" }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.count; }),
        smooth: true,
        symbolSize: 7,
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
        radius: ["45%", "72%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: COLOR.card, borderWidth: 2 },
        // Outside labels ("Conference paper") get clipped at the canvas
        // edge in a narrow card -- the legend below already names each
        // slice, so show only the share inside the ring.
        label: { show: true, position: "inside", formatter: "{d}%", color: COLOR.ink, fontFamily: "IBM Plex Mono", fontWeight: 600 },
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
    makeChart("chart-team-size", {
      grid: baseGrid(),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.year; }) }, axisCommon()),
      yAxis: Object.assign({ type: "value", scale: true }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.avg_authors; }),
        smooth: true,
        symbolSize: 7,
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
    makeChart("chart-venues-year", {
      grid: baseGrid(),
      tooltip: tooltipCommon({ trigger: "axis" }),
      xAxis: Object.assign({ type: "category", data: rows.map(function (r) { return r.year; }) }, axisCommon()),
      yAxis: Object.assign({ type: "value" }, axisCommon()),
      series: [{
        type: "line",
        data: rows.map(function (r) { return r.distinct_venues; }),
        smooth: true,
        symbolSize: 7,
        lineStyle: { color: COLOR.sage, width: 2.5 },
        itemStyle: { color: COLOR.sage },
      }],
    });
  }

  // ---------- multi-line helper (topic trends / venue comparison) ----------
  function renderMultiLine(domId, payload, yName, valueFormatter) {
    var years = payload.years;
    var keys = Object.keys(payload.series);
    makeChart(domId, {
      grid: baseGrid({ right: 24 }),
      tooltip: tooltipCommon({ trigger: "axis" }),
      legend: { top: 0, textStyle: { color: COLOR.textSecondary, fontFamily: "IBM Plex Sans" } },
      color: CATEGORICAL,
      xAxis: Object.assign({ type: "category", data: years }, axisCommon()),
      yAxis: Object.assign({ type: "value", name: yName, nameTextStyle: { color: COLOR.textFaint } }, axisCommon()),
      series: keys.map(function (k) {
        return {
          name: k,
          type: "line",
          data: payload.series[k],
          smooth: true,
          symbolSize: 6,
          lineStyle: { width: 2.25 },
        };
      }),
    });
  }

  // ---------- co-authorship network ----------
  function renderNetwork(payload) {
    var nodes = payload.nodes.map(function (n) {
      return {
        id: n.id,
        name: n.id,
        symbolSize: 6 + Math.sqrt(n.papers) * 2.4,
        value: n.papers,
        category: n.group,
        itemStyle: { color: CATEGORICAL[n.group % CATEGORICAL.length] },
      };
    });
    var edges = payload.edges.map(function (e) {
      return { source: e.source, target: e.target, value: e.weight, lineStyle: { width: Math.min(e.weight, 6) * 0.4, opacity: 0.25 } };
    });

    makeChart("chart-network", {
      tooltip: tooltipCommon({
        formatter: function (p) {
          if (p.dataType === "edge") return p.data.source + " ↔ " + p.data.target + ": " + p.data.value + " shared papers";
          return p.data.name + ": " + p.data.value + " papers";
        },
      }),
      series: [{
        type: "graph",
        layout: "force",
        roam: true,
        draggable: true,
        force: { repulsion: 90, edgeLength: [30, 90], gravity: 0.15 },
        label: {
          show: true,
          position: "right",
          color: COLOR.textSecondary,
          fontFamily: "IBM Plex Mono",
          fontSize: 10,
          formatter: function (p) { return p.data.value >= 250 ? p.data.name : ""; },
        },
        edgeSymbol: ["none", "none"],
        lineStyle: { color: COLOR.hairline, curveness: 0.1 },
        data: nodes,
        links: edges,
      }],
    });
  }

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
      renderMultiLine("chart-topic-trends", data.topicTrends, "% of titles");
      renderMultiLine("chart-venue-comparison", data.venueComparison, "papers");
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
