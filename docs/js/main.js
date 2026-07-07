// Boot: load config, wire map -> tiles -> panel.

import { initColors, renderLegend } from "./colors.js";
import { createMap, highlightCell, clearHighlight, flyToPlace } from "./map.js";
import { initSearch } from "./search.js";
import { getCell, cellFromLatLng, cellCenter, supported } from "./tiles.js";
import { initPanel, showLoading, showCell, showError, closePanel } from "./panel.js";
import { getUnit, setUnit, onUnitChange, degSym } from "./units.js";

async function boot() {
  if (!supported()) {
    document.getElementById("unsupported").hidden = false;
    return;
  }

  const [colorCfg, meta] = await Promise.all([
    initColors(),
    fetch("data/meta.json").then((r) => r.json()),
  ]);

  const drawLegend = () => {
    renderLegend(
      document.getElementById("legend-bar"),
      document.getElementById("legend-ticks"),
      colorCfg.legend_range,
      getUnit()
    );
    document.getElementById("legend-label").textContent =
      `${degSym()} warmer today than 1850–1900`;
  };
  drawLegend();
  onUnitChange(drawLegend);

  const unitBtns = [...document.querySelectorAll("#unit-toggle .toggle-btn")];
  const syncUnitBtns = () => unitBtns.forEach((b) => {
    const on = b.dataset.unit === getUnit();
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  unitBtns.forEach((b) => b.addEventListener("click", () => {
    setUnit(b.dataset.unit);
    syncUnitBtns();
  }));
  syncUnitBtns(); // reflect persisted choice on load

  initPanel(meta, () => {
    clearHighlight();
    history.replaceState(null, "", location.pathname + location.search);
  });
  const hint = document.getElementById("hint");

  async function selectCell(lat0, lng0) {
    hint.classList.add("gone");
    const { cy, cx } = cellFromLatLng(lat0, lng0);
    highlightCell(cy, cx);
    const { lat, lon } = cellCenter(cy, cx);
    history.replaceState(null, "", `#${lat.toFixed(3)},${lon.toFixed(3)}`);
    const mySeq = showLoading(lat, lon);
    try {
      const cell = await getCell(cy, cx);
      showCell(mySeq, { lat, lon, cell });
    } catch (e) {
      console.error(e);
      showError(mySeq);
    }
  }

  createMap((latlng) => selectCell(latlng.lat, latlng.lng));

  initSearch((r) => {
    flyToPlace(r);
    selectCell(r.lat, r.lon);
  });

  // Permalink: #lat,lon opens that location on load.
  const m = location.hash.match(/^#(-?[\d.]+),(-?[\d.]+)$/);
  if (m) selectCell(parseFloat(m[1]), parseFloat(m[2]));

  window.closePanel = closePanel;
}

boot();
