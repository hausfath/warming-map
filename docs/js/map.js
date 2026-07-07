// Leaflet map in plain EPSG:4326 with the warming raster as an image overlay
// and Natural Earth country outlines on top.

import { cellBounds } from "./tiles.js";

let map, highlight;

export function createMap(onClick) {
  map = L.map("map", {
    crs: L.CRS.EPSG4326,
    minZoom: 1,
    maxZoom: 9,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    attributionControl: false,
    zoomControl: false,
  });
  L.control.zoom({ position: "bottomleft" }).addTo(map);

  L.imageOverlay("overlay/warming.png", [[-90, -180], [90, 180]], {
    className: "warming-overlay",
    interactive: false,
  }).addTo(map);

  fetch("geo/countries.json")
    .then((r) => r.json())
    .then((gj) => {
      L.geoJSON(gj, {
        style: {
          color: "rgba(12, 12, 14, 0.5)",
          weight: 0.8,
          fill: false,
        },
        interactive: false,
      }).addTo(map);
    })
    .catch(() => {}); // outlines are decoration; the map works without them

  fitWorld();
  window.addEventListener("resize", debounce(() => {
    if (map.getZoom() === map.getMinZoom()) fitWorld();
  }, 200));

  map.on("click", (e) => onClick(e.latlng));
  return map;
}

function fitWorld() {
  const b = L.latLngBounds([[-58, -168], [78, 168]]);
  map.fitBounds(b, { padding: [10, 10] });
  map.setMinZoom(Math.min(map.getZoom(), 2));
}

export function highlightCell(cy, cx) {
  const bounds = cellBounds(cy, cx);
  if (highlight) highlight.remove();
  highlight = L.rectangle(bounds, {
    className: "cell-highlight",
    color: "#ffffff",
    weight: 1.6,
    fillColor: "#ffffff",
    fillOpacity: 0.12,
    interactive: false,
  }).addTo(map);
  // If the cell is tiny on screen (zoomed way out), gently zoom toward it.
  const px = Math.abs(
    map.latLngToContainerPoint(bounds[1]).x -
    map.latLngToContainerPoint(bounds[0]).x
  );
  if (px < 5) map.flyTo(
    [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
    Math.min(map.getZoom() + 2, 6),
    { duration: 0.6 }
  );
}

export function flyToPlace(r) {
  // Prefer the result's bounding box (extent = [w, n, e, s]) so countries
  // fill the view while towns get a close-up; clamp so a single 0.25° cell
  // never fills the whole screen.
  if (r.extent) {
    const [w, n, e, s] = r.extent;
    const b = L.latLngBounds([[s, w], [n, e]]).pad(0.3);
    const z = Math.min(map.getBoundsZoom(b), 7);
    map.flyTo(b.getCenter(), Math.max(z, 3), { duration: 0.9 });
  } else {
    map.flyTo([r.lat, r.lon], 6, { duration: 0.9 });
  }
}

export function clearHighlight() {
  if (highlight) { highlight.remove(); highlight = null; }
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
