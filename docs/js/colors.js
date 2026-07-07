// Warming color ramp — stops loaded from data/colors.json (single source of
// truth shared with the Python build; the PNG overlay uses the same stops).

let stops = null;
let chart = null;

export async function initColors() {
  const cfg = await fetch("data/colors.json").then((r) => r.json());
  stops = cfg.warming_stops.map((s) => ({ v: s.value, rgb: hexToRgb(s.hex) }));
  chart = cfg.chart;
  return cfg;
}

export function chartColors() {
  // The site is a committed dark theme; the light block exists for reuse.
  return chart.dark;
}

function hexToRgb(h) {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function warmingColor(v) {
  if (!Number.isFinite(v)) return "#555";
  if (v <= stops[0].v) return rgbStr(stops[0].rgb);
  if (v >= stops[stops.length - 1].v) return rgbStr(stops[stops.length - 1].rgb);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (v >= a.v && v <= b.v) {
      const t = (v - a.v) / (b.v - a.v);
      return rgbStr(a.rgb.map((c, k) => Math.round(c + t * (b.rgb[k] - c))));
    }
  }
  return "#555";
}

function rgbStr(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

// Build the legend gradient + ticks for a value range.
export function renderLegend(barEl, ticksEl, range) {
  const [lo, hi] = range;
  const pieces = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const v = lo + (i / n) * (hi - lo);
    pieces.push(`${warmingColor(v)} ${(i / n) * 100}%`);
  }
  barEl.style.background = `linear-gradient(90deg, ${pieces.join(",")})`;
  ticksEl.innerHTML = "";
  for (let v = Math.ceil(lo); v <= Math.floor(hi); v++) {
    const span = document.createElement("span");
    const pct = ((v - lo) / (hi - lo)) * 100;
    span.style.left = `${pct}%`;
    if (pct < 3) span.style.transform = "translateX(0)";
    else if (pct > 97) span.style.transform = "translateX(-100%)";
    span.textContent = v > 0 ? `+${v}` : `${v}`;
    ticksEl.appendChild(span);
  }
}
