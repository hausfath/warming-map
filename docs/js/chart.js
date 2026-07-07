// Hand-rolled responsive SVG time-series chart: thin annual line (with gaps),
// bold smoothed curve, zero baseline, crosshair + tooltip on hover.

import { chartColors } from "./colors.js";

const W = 430, H = 250;
const M = { top: 14, right: 14, bottom: 26, left: 40 };
const NS = "http://www.w3.org/2000/svg";

export function renderChart(el, data) {
  // data: { years[], annual[], smooth[], unit ("anomaly"|"absolute"), baselineLabel }
  const c = chartColors();
  const { years, annual, smooth, unit } = data;
  el.innerHTML = "";

  const finite = annual.filter(Number.isFinite).concat(smooth.filter(Number.isFinite));
  if (!finite.length) {
    el.innerHTML = `<p style="color:${c.muted};font-size:12px;padding:40px 0;text-align:center">
      No temperature record for this cell.</p>`;
    return;
  }
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (unit === "anomaly") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.08 || 0.5;
  lo -= pad; hi += pad;

  const x = (yr) => M.left + ((yr - years[0]) / (years[years.length - 1] - years[0])) * (W - M.left - M.right);
  const y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);

  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

  // y gridlines + labels at "nice" steps
  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const vv = Math.abs(v) < 1e-9 ? 0 : v;
    const isZero = unit === "anomaly" && vv === 0;
    svg.appendChild(mk("line", {
      x1: M.left, x2: W - M.right, y1: y(vv), y2: y(vv),
      stroke: isZero ? c.baseline : c.gridline,
      "stroke-width": isZero ? 1.2 : 1,
    }));
    svg.appendChild(txt(M.left - 7, y(vv) + 3.5, fmtTick(vv, unit, step), {
      fill: c.muted, "font-size": "10", "text-anchor": "end",
    }));
  }

  // x ticks
  for (let yr = 1850; yr <= years[years.length - 1]; yr += 50) {
    svg.appendChild(txt(x(yr), H - 8, String(yr), {
      fill: c.muted, "font-size": "10", "text-anchor": "middle",
    }));
    svg.appendChild(mk("line", {
      x1: x(yr), x2: x(yr), y1: H - M.bottom, y2: H - M.bottom + 4,
      stroke: c.baseline, "stroke-width": 1,
    }));
  }

  // annual line (broken at gaps)
  svg.appendChild(mk("path", {
    d: pathFrom(years, annual, x, y),
    fill: "none", stroke: c.annual_line, "stroke-width": 1.2,
    "stroke-linejoin": "round",
  }));
  // isolated points (gaps on both sides) would vanish from the path — dot them
  annual.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const prev = i > 0 ? annual[i - 1] : NaN, next = i < annual.length - 1 ? annual[i + 1] : NaN;
    if (!Number.isFinite(prev) && !Number.isFinite(next)) {
      svg.appendChild(mk("circle", { cx: x(years[i]), cy: y(v), r: 1.6, fill: c.annual_line }));
    }
  });

  // smoothed curve
  svg.appendChild(mk("path", {
    d: pathFrom(years, smooth, x, y),
    fill: "none", stroke: c.smooth, "stroke-width": 2.4,
    "stroke-linecap": "round", "stroke-linejoin": "round",
  }));

  // hover layer
  const cross = mk("line", {
    y1: M.top, y2: H - M.bottom, stroke: c.baseline,
    "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0,
  });
  const dotA = mk("circle", { r: 3, fill: c.annual_dot, opacity: 0 });
  const dotS = mk("circle", { r: 3.5, fill: c.smooth, stroke: c.surface, "stroke-width": 1.5, opacity: 0 });
  svg.appendChild(cross); svg.appendChild(dotA); svg.appendChild(dotS);

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  el.appendChild(svg);
  el.appendChild(tip);

  const hot = mk("rect", {
    x: M.left, y: M.top, width: W - M.left - M.right, height: H - M.top - M.bottom,
    fill: "transparent",
  });
  svg.appendChild(hot);

  function onMove(ev) {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const frac = (px - M.left) / (W - M.left - M.right);
    const i = Math.round(frac * (years.length - 1));
    if (i < 0 || i >= years.length) return onLeave();
    const yr = years[i], a = annual[i], s = smooth[i];
    const cx = x(yr);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
    cross.setAttribute("opacity", 1);
    show(dotA, cx, a); show(dotS, cx, s);
    const u = unit === "anomaly" ? " °C" : " °C";
    tip.innerHTML =
      `<span class="y">${yr}</span><br>` +
      (Number.isFinite(a) ? `<span class="a">${fmtVal(a, unit)}${u} annual</span><br>` : `<span class="y">no data</span><br>`) +
      (Number.isFinite(s) ? `<span class="s">${fmtVal(s, unit)}${u} smoothed</span>` : "");
    tip.classList.add("on");
    const tipX = (cx / W) * r.width;
    tip.style.left = `${Math.min(Math.max(tipX + 12, 4), r.width - 130)}px`;
    tip.style.top = `${(y(Number.isFinite(s) ? s : Number.isFinite(a) ? a : (lo + hi) / 2) / H) * r.height - 54}px`;
  }
  function show(dot, cx, v) {
    if (Number.isFinite(v)) {
      dot.setAttribute("cx", cx); dot.setAttribute("cy", y(v));
      dot.setAttribute("opacity", 1);
    } else dot.setAttribute("opacity", 0);
  }
  function onLeave() {
    cross.setAttribute("opacity", 0);
    dotA.setAttribute("opacity", 0);
    dotS.setAttribute("opacity", 0);
    tip.classList.remove("on");
  }
  hot.addEventListener("pointermove", onMove);
  hot.addEventListener("pointerleave", onLeave);
}

function pathFrom(years, vals, x, y) {
  let d = "", pen = false;
  for (let i = 0; i < vals.length; i++) {
    if (Number.isFinite(vals[i])) {
      d += `${pen ? "L" : "M"}${x(years[i]).toFixed(1)},${y(vals[i]).toFixed(1)}`;
      pen = true;
    } else pen = false;
  }
  return d || "M0,0";
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function fmtTick(v, unit, step) {
  const dec = step < 1 ? 1 : 0;
  const s = v.toFixed(dec);
  return unit === "anomaly" && v > 0 ? `+${s}` : s;
}

function fmtVal(v, unit) {
  const s = v.toFixed(2);
  return unit === "anomaly" && v > 0 ? `+${s}` : s;
}

function mk(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function txt(x, y, s, attrs) {
  const n = mk("text", { x, y, ...attrs });
  n.setAttribute("font-family", "IBM Plex Mono, monospace");
  n.textContent = s;
  return n;
}
