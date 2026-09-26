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
  function renderNetwork(payload) {
    // Size and label thresholds are relative to the data (not fixed paper
    // counts) so the graph stays readable whatever year range was aggregated.
    var papers = payload.nodes.map(function (n) { return n.papers; }).sort(function (a, b) { return b - a; });
    var maxPapers = papers[0];
    var labelThreshold = papers[Math.min(14, papers.length - 1)];
    var nodes = payload.nodes.map(function (n) {
      return {
        id: n.id,
        name: n.id,
        symbolSize: 8 + 30 * Math.sqrt(n.papers / maxPapers),
        value: n.papers,
        category: n.group,
        itemStyle: { color: CATEGORICAL[n.group % CATEGORICAL.length] },
      };
    });
    var edges = payload.edges.map(function (e) {
      return { source: e.source, target: e.target, value: e.weight, lineStyle: { width: 0.5 + Math.min(e.weight, 20) * 0.08, opacity: 0.35 } };
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
        force: { repulsion: 120, edgeLength: [30, 100], gravity: 0.15 },
        label: {
          show: true,
          position: "right",
          color: COLOR.textSecondary,
          fontFamily: "IBM Plex Mono",
          fontSize: 10,
          formatter: function (p) { return p.data.value >= labelThreshold ? p.data.name : ""; },
        },
        edgeSymbol: ["none", "none"],
        lineStyle: { color: COLOR.textFaint, curveness: 0.1 },
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
