// Gaussian-kernel local *linear* regression — the exact JS port of
// warming_level() in build/build_site_data.py (sigma = 7 yr). The map PNG,
// the headline stat and this curve therefore always agree.

export const SIGMA = 7.0;

export function smoothSeries(values, sigma = SIGMA) {
  const n = values.length;
  const out = new Array(n).fill(NaN);
  const win = Math.round(2 * sigma);
  for (let k = 0; k < n; k++) {
    let S0 = 0, S1 = 0, S2 = 0, Sy = 0, Sxy = 0, near = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const dx = i - k;
      if (Math.abs(dx) <= win) near++;
      const w = Math.exp(-0.5 * (dx / sigma) * (dx / sigma));
      S0 += w;
      S1 += w * dx;
      S2 += w * dx * dx;
      Sy += w * v;
      Sxy += w * dx * v;
    }
    // Don't draw a curve through near-empty stretches: require at least 5
    // observed years within +-2 sigma. (Doesn't affect the modern endpoint,
    // so the headline stat still matches the Python-built map exactly.)
    if (near < 5) continue;
    const det = S0 * S2 - S1 * S1;
    if (S0 > 1e-9 && Math.abs(det) > 1e-9) out[k] = (S2 * Sy - S1 * Sxy) / det;
  }
  return out;
}
