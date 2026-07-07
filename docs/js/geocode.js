// Best-effort reverse geocoding via BigDataCloud's free client API.
// Never blocks the panel: resolves to null on any failure or after 5 s.

const cache = new Map();

export async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  let out = null;
  try {
    const url = "https://api.bigdatacloud.net/data/reverse-geocode-client" +
      `?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const r = await fetch(url, { signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      out = {
        locality: j.city || j.locality || "",
        subdivision: j.principalSubdivision || "",
        country: countryName(j),
        water: waterName(j),
      };
    }
  } catch {
    out = null;
  } finally {
    clearTimeout(timer);
  }
  cache.set(key, out);
  return out;
}

function countryName(j) {
  // BigDataCloud returns verbose official names ("United Kingdom of Great
  // Britain and Northern Ireland (the)"); prefer the common short name.
  if (j.countryCode) {
    try {
      const n = new Intl.DisplayNames(["en"], { type: "region" }).of(j.countryCode);
      if (n && n !== j.countryCode) return n;
    } catch { /* fall through */ }
  }
  return (j.countryName || "").replace(/\s*\(the\)\s*$/i, "");
}

function waterName(j) {
  // For ocean points BigDataCloud returns no country but names the body of
  // water in localityInfo.informative.
  const inf = j.localityInfo && j.localityInfo.informative;
  if (!inf) return "";
  const hit = inf.find((e) =>
    /ocean|sea|gulf|bay|strait|channel|passage/i.test(`${e.name} ${e.description || ""}`));
  return hit ? hit.name : "";
}
