// Location panel: place identity, headline warming stat, chart, facts.

import { renderChart } from "./chart.js";
import { warmingColor } from "./colors.js";
import { reverseGeocode } from "./geocode.js";
import { smoothSeries } from "./smooth.js";
import { degSym, convAnom, convAbs, onUnitChange } from "./units.js";

const el = {
  panel: document.getElementById("panel"),
  close: document.getElementById("panel-close"),
  kicker: document.getElementById("place-kicker"),
  name: document.getElementById("place-name"),
  meta: document.getElementById("place-meta"),
  headline: document.getElementById("headline"),
  num: document.getElementById("headline-num"),
  compare: document.getElementById("headline-compare"),
  qmark: document.getElementById("quality-mark"),
  chart: document.getElementById("chart"),
  chartTitle: document.getElementById("chart-title"),
  facts: document.getElementById("facts"),
  csv: document.getElementById("download-csv"),
  footnote: document.getElementById("footnote"),
  toggles: [...document.querySelectorAll(".toggle-btn")],
};

let mode = "anomaly";
let current = null;   // { cell, years, smooth, lat, lon, seq }
let seq = 0;
let meta = null;
let onCloseCb = null;

export function initPanel(siteMeta, onClose) {
  meta = siteMeta;
  onCloseCb = onClose;
  el.close.addEventListener("click", closePanel);
  el.toggles.forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      el.toggles.forEach((t) => {
        t.classList.toggle("active", t === b);
        t.setAttribute("aria-selected", t === b ? "true" : "false");
      });
      if (current) drawChart();
    })
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
  el.csv.addEventListener("click", downloadCsv);
  onUnitChange(() => { if (current) renderStats(); });
}

function downloadCsv() {
  if (!current) return;
  const { cell, years, smooth, lat, lon } = current;
  const place = el.name.textContent.trim();
  const hasAbs = Number.isFinite(cell.absOffset);
  const f = (v, off = 0) => (Number.isFinite(v) ? (v + off).toFixed(2) : "");
  const lines = [
    `# The Warming Map — https://hausfath.github.io/warming-map/#${lat.toFixed(3)},${lon.toFixed(3)}`,
    `# Source: Berkeley Earth 0.25 degree gridded land+ocean temperature dataset`,
    `# Location: ${place} (${fmtLat(lat)}, ${fmtLon(lon)}; 0.25 degree grid cell)`,
    `# anomaly_C: annual mean temperature anomaly vs the 1850-1900 average`,
    `# smoothed_C: ~20-year Gaussian local linear regression of the anomalies`,
  ];
  if (hasAbs) lines.push(`# absolute_C: estimated annual mean temperature (anomaly + climatology)`);
  if (cell.qualityFlag & 1)
    lines.push(`# note: sparse pre-1900 record; baseline estimated from earliest available years`);
  lines.push(hasAbs ? "year,anomaly_C,smoothed_C,absolute_C" : "year,anomaly_C,smoothed_C");
  for (let i = 0; i < years.length; i++) {
    const row = [years[i], f(cell.series[i]), f(smooth[i])];
    if (hasAbs) row.push(f(cell.series[i], cell.absOffset));
    lines.push(row.join(","));
  }
  const slug = (place || "location").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = `warming_${slug}_${lat.toFixed(2)}_${lon.toFixed(2)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function closePanel() {
  el.panel.classList.remove("open");
  current = null;
  if (onCloseCb) onCloseCb();
}

export function showLoading(lat, lon) {
  seq++;
  el.panel.hidden = false;
  requestAnimationFrame(() => el.panel.classList.add("open"));
  el.kicker.textContent = "locating";
  el.name.textContent = "…";
  el.name.classList.add("loading", "skel");
  el.meta.innerHTML = `<span>${fmtLat(lat)}</span><span class="sep">·</span><span>${fmtLon(lon)}</span>`;
  el.num.textContent = "—";
  el.compare.textContent = "";
  el.facts.innerHTML = "";
  return seq;
}

export function showError(mySeq) {
  if (mySeq !== seq) return;
  el.name.classList.remove("loading", "skel");
  el.kicker.textContent = "error";
  el.name.textContent = "Couldn't load this cell";
  el.chart.innerHTML = "";
  el.footnote.textContent = "The data tile for this location failed to load. Check your connection and try again.";
}

export function showCell(mySeq, { lat, lon, cell }) {
  if (mySeq !== seq) return;
  const years = Array.from({ length: cell.nYears }, (_, i) => cell.startYear + i);
  const smooth = smoothSeries(cell.series);
  current = { cell, years, smooth, lat, lon };

  // --- identity (geocode fills in async) ---
  el.kicker.textContent = cell.land ? "land" : "ocean";
  el.name.classList.remove("loading", "skel");
  el.name.textContent = cell.land ? "Somewhere on land" : "Open ocean";
  el.meta.innerHTML =
    `<span>${fmtLat(lat)}</span><span class="sep">·</span><span>${fmtLon(lon)}</span>` +
    `<span class="sep">·</span><span>0.25° cell</span>`;

  reverseGeocode(lat, lon).then((g) => {
    if (mySeq !== seq || !g) return;
    if (cell.land) {
      const bits = [g.locality, g.subdivision, g.country].filter(Boolean);
      if (bits.length) {
        el.name.textContent = bits[0];
        el.kicker.textContent = bits.slice(1).join(", ") || "land";
      }
    } else if (g.water) {
      el.name.textContent = g.water;
      el.kicker.textContent = g.country ? `ocean · near ${g.country}` : "ocean";
    } else if (g.country) {
      el.kicker.textContent = `ocean · near ${g.country}`;
    }
  });

  renderStats();
}

function renderStats() {
  const { cell, years, smooth } = current;
  const sym = degSym();

  // --- headline stat ---
  const w = cell.warming;
  if (Number.isFinite(w)) {
    el.headline.style.setProperty("--stat-color", warmingColor(w));
    el.num.innerHTML = `${fmtAnom(convAnom(w), 1)}<span class="unit"> ${sym}</span>`;
    const ratio = w / meta.globalMeanWarming;
    el.compare.innerHTML =
      `That's <strong>${ratio.toFixed(1)}×</strong> the global average of ` +
      `<strong>${fmtAnom(convAnom(meta.globalMeanWarming), 1)} ${sym}</strong>`;
  } else {
    el.num.textContent = "n/a";
    el.compare.textContent = "";
  }
  el.qmark.hidden = !(cell.qualityFlag & 1);

  // --- facts grid ---
  const annual = cell.series;
  let hotYear = null, hot = -Infinity, n = 0;
  annual.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    n++;
    if (v > hot) { hot = v; hotYear = years[i]; }
  });
  const latest = [...annual].reverse().findIndex(Number.isFinite);
  const latestIdx = latest === -1 ? null : annual.length - 1 - latest;
  const absMean = Number.isFinite(cell.absOffset) && Number.isFinite(w)
    ? smooth[smooth.length - 1] + cell.absOffset : NaN;

  el.facts.innerHTML = "";
  const facts = [];
  if (hotYear !== null)
    facts.push(["Warmest year", `${hotYear} <small>${fmtAnom(convAnom(hot))} ${sym}</small>`]);
  if (latestIdx !== null)
    facts.push([`${years[latestIdx]} anomaly`, `${fmtAnom(convAnom(annual[latestIdx]))} ${sym}`]);
  if (Number.isFinite(absMean))
    facts.push(["Current avg. temp", `${convAbs(absMean).toFixed(1)} ${sym}`]);
  facts.push(["Years of data", `${n} <small>of ${cell.nYears}</small>`]);
  for (const [dt, dd] of facts) {
    const d = document.createElement("div");
    d.innerHTML = `<dt>${dt}</dt><dd>${dd}</dd>`;
    el.facts.appendChild(d);
  }

  // --- footnote ---
  let note = `Anomalies relative to the ${meta.baseline[0]}–${meta.baseline[1]} average. ` +
    `Smoothed curve: ~20-year local regression. Berkeley Earth ${meta.grid.cellDeg}° ` +
    `land + ocean dataset, annual means through ${meta.endYear}. CSV downloads are in °C.`;
  if (cell.qualityFlag & 1)
    note = `† Sparse early record here: the pre-1900 baseline is estimated from the ` +
      `earliest available years, so the warming figure is less certain. ` + note;
  el.footnote.textContent = note;

  drawChart();
}

function drawChart() {
  const { cell, years, smooth } = current;
  const useAbs = mode === "absolute" && Number.isFinite(cell.absOffset);
  const sym = degSym();
  el.chartTitle.textContent = useAbs
    ? `Annual average temperature (${sym})`
    : `Annual anomaly vs 1850–1900 (${sym})`;
  const conv = useAbs ? (v) => convAbs(v + cell.absOffset) : (v) => convAnom(v);
  renderChart(el.chart, {
    years,
    annual: cell.series.map(conv),
    smooth: smooth.map(conv),
    unit: useAbs ? "absolute" : "anomaly",
    sym,
  });
}

function fmtAnom(v, dec = 2) {
  return `${v > 0 ? "+" : ""}${v.toFixed(dec)}`;
}
function fmtLat(lat) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
}
function fmtLon(lon) {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}
