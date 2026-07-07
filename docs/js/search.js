// Place search via Photon (photon.komoot.io) — free, keyless, CORS-enabled
// OSM geocoder built for autocomplete. Best-effort like the reverse geocoder:
// failures just show "no results".

const DEBOUNCE_MS = 300;
const LIMIT = 5;

export function initSearch(onPick) {
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  let timer = null;
  let results = [];
  let active = -1;
  let lastQuery = "";
  let reqSeq = 0;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(() => run(q), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) pick(active >= 0 ? active : 0);
      else if (input.value.trim().length >= 2) run(input.value.trim());
    } else if (e.key === "Escape") { close(); input.blur(); }
  });

  // Delay closing on blur so a click on a result still lands.
  input.addEventListener("blur", () => setTimeout(close, 150));

  async function run(q) {
    lastQuery = q;
    const mySeq = ++reqSeq;
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${LIMIT}&lang=en`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      if (mySeq !== reqSeq) return; // stale response
      results = (j.features || [])
        .filter((f) => f.geometry && f.geometry.type === "Point")
        .map((f) => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          extent: f.properties.extent || null, // [w, n, e, s]
          ...labelFor(f.properties),
        }));
      render();
    } catch {
      if (mySeq !== reqSeq) return;
      results = [];
      render(true);
    }
  }

  function labelFor(p) {
    const main = p.name || p.street || "";
    const rest = [p.city, p.state, p.country]
      .filter((x) => x && x !== main);
    return { main, rest: rest.join(", ") };
  }

  function render(failed = false) {
    list.innerHTML = "";
    active = -1;
    if (!results.length) {
      const li = document.createElement("li");
      li.className = "search-empty";
      li.textContent = failed ? "Search unavailable right now" : `No places found for “${lastQuery}”`;
      list.appendChild(li);
      list.hidden = false;
      return;
    }
    results.forEach((r, i) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="sr-main">${esc(r.main)}</span>` +
        (r.rest ? `<span class="sr-rest">${esc(r.rest)}</span>` : "");
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      li.addEventListener("mouseenter", () => setActive(i));
      list.appendChild(li);
    });
    list.hidden = false;
  }

  function move(d) {
    if (!results.length) return;
    setActive((active + d + results.length) % results.length);
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, k) => li.classList.toggle("active", k === i));
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    input.value = [r.main, r.rest].filter(Boolean).join(", ");
    close();
    input.blur();
    onPick(r);
  }

  function close() {
    list.hidden = true;
    list.innerHTML = "";
    results = [];
    active = -1;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
