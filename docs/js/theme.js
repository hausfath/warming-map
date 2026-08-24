// Theme + embed state.
//
// The standalone site is a committed dark look. With ?embed=1 (used by the
// Climate Dashboard's "Warming Map" tab) the chrome restyles to the
// dashboard's design tokens, a light theme becomes available, and the parent
// page can drive theme/unit live via postMessage:
//   { source: "climate-dashboard", theme: "dark"|"light", unit: "C"|"F" }
// Initial state comes from query params (?theme=light&unit=F) so there is
// no flash before the first message arrives.

import { setUnit } from "./units.js";

const params = new URLSearchParams(location.search);
export const isEmbed = params.get("embed") === "1";

let theme = params.get("theme") === "light" ? "light" : "dark";
const subs = [];

export function getTheme() {
  return theme;
}

export function onThemeChange(f) {
  subs.push(f);
}

export function setTheme(t) {
  t = t === "light" ? "light" : "dark";
  if (t === theme) return;
  theme = t;
  apply();
  subs.forEach((f) => f(t));
}

function apply() {
  document.body.classList.toggle("light", theme === "light");
}

export function initTheme() {
  if (isEmbed) {
    document.body.classList.add("embed");
    // Dashboard display font, only loaded when embedded.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&display=swap";
    document.head.appendChild(link);

    const unit = params.get("unit");
    if (unit === "F" || unit === "C") setUnit(unit);

    window.addEventListener("message", (e) => {
      const d = e.data;
      if (!d || d.source !== "climate-dashboard") return;
      if (d.theme) setTheme(d.theme);
      if (d.unit === "F" || d.unit === "C") setUnit(d.unit);
    });
  }
  apply();
}
