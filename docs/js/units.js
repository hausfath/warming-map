// Global temperature unit (°C / °F), persisted across visits.
// Anomalies scale by 9/5; absolute temperatures also shift by 32.

let unit = localStorage.getItem("warming-map-unit") === "F" ? "F" : "C";
const subs = [];

export function getUnit() {
  return unit;
}

export function setUnit(u) {
  if (u === unit) return;
  unit = u;
  try { localStorage.setItem("warming-map-unit", u); } catch { /* private mode */ }
  subs.forEach((f) => f(u));
}

export function onUnitChange(f) {
  subs.push(f);
}

export function degSym() {
  return unit === "C" ? "°C" : "°F";
}

// anomaly / difference (no offset)
export function convAnom(v) {
  return unit === "C" ? v : v * 9 / 5;
}

// absolute temperature
export function convAbs(v) {
  return unit === "C" ? v : v * 9 / 5 + 32;
}
