// Nilam - valuation.js
// Estimates a plot's price from KNOWN prices nearby ("comparables"), the way a
// valuer compares similar plots. Two methods:
//  1. Similar plots (k-nearest neighbours): comparables that look most like the
//     plot (and are close by) get the most say.
//  2. Learned factors (ridge regression): with 6+ comparables, learn how much
//     each factor moves the price in this area.
// Each method's error is measured honestly by leave-one-out: hide one known
// price, predict it from the rest, repeat.

export const UNITS = {
  sqft: { label: 'sq ft', sqft: 1 },
  cent: { label: 'cent', sqft: 435.6 },
  ground: { label: 'ground', sqft: 2400 },
  acre: { label: 'acre', sqft: 43560 },
  sqm: { label: 'sq m', sqft: 10.7639 },
};

// What the price model looks at (log scale: going from 1 to 2 km matters more than 11 to 12 km)
export const MODEL_FEATURES = [
  { key: 'townKm', label: 'Distance to the town centre', get: (f) => Math.log((f.town ? f.town.km : 60) + 0.3) },
  { key: 'cityKm', label: 'Distance to the nearest city', get: (f) => Math.log((f.city ? f.city.km : 80) + 1) },
  { key: 'mainRoadM', label: 'Distance to a main road', get: (f) => Math.log((f.majorRoad.m ?? 4000) + 30) },
  { key: 'accessM', label: 'Distance to any road', get: (f) => Math.log((f.anyRoadM ?? 400) + 10) },
  { key: 'shops', label: 'Shops within 1 km', get: (f) => Math.log(f.shops + 1) },
  { key: 'schools', label: 'Schools within 2 km', get: (f) => Math.log(f.schools + 1) },
  { key: 'health', label: 'Hospitals and clinics within 2 km', get: (f) => Math.log(f.health + 1) },
  { key: 'busStops', label: 'Bus stops within 1.5 km', get: (f) => Math.log(f.busStops + 1) },
];
export const vectorOf = (f) => MODEL_FEATURES.map((x) => x.get(f));

function haversineKm(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function scaling(rows) {
  const d = rows[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  rows.forEach((r) => r.forEach((v, i) => { mean[i] += v / rows.length; }));
  rows.forEach((r) => r.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / rows.length; }));
  return { mean, std: std.map((s) => Math.sqrt(s) || 1) };
}

// ---------------------------------------------------------------- method 1: similar plots
export function similarPlots(target, comps) {
  const rows = comps.map((c) => c.vector);
  const { std } = rows.length >= 2 ? scaling(rows) : { std: rows[0].map(() => 1) };
  const weights = comps.map((c) => {
    let d2 = 0;
    c.vector.forEach((v, i) => { d2 += ((v - target.vector[i]) / std[i]) ** 2; });
    const similarity = Math.exp(-d2 / (2 * c.vector.length));
    const nearby = Math.exp(-haversineKm(target, c) / 3); // the same local market counts more
    return similarity * nearby + 1e-12;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const logPrice = comps.reduce((s, c, i) => s + weights[i] * Math.log(c.pricePerSqft), 0) / total;
  return {
    perSqft: Math.exp(logPrice),
    used: comps.map((c, i) => ({ comp: c, share: weights[i] / total })).sort((a, b) => b.share - a.share),
  };
}

// ---------------------------------------------------------------- method 2: learned factors
export function fitRidge(comps, lambda = 2) {
  const rows = comps.map((c) => c.vector);
  const { mean, std } = scaling(rows);
  const X = rows.map((r) => r.map((v, i) => (v - mean[i]) / std[i]));
  const y = comps.map((c) => Math.log(c.pricePerSqft));
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  const d = X[0].length;
  // Solve (XᵀX + λI) β = Xᵀ(y − ȳ)
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) =>
    X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: d }, (_, i) => X.reduce((s, r, k) => s + r[i] * (y[k] - yMean), 0));
  const beta = solve(A, b);
  return {
    mean, std, beta, yMean,
    predict: (vector) => Math.exp(yMean + vector.reduce((s, v, i) => s + beta[i] * ((v - mean[i]) / std[i]), 0)),
  };
}

// Gaussian elimination with partial pivoting (small systems only)
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

// ---------------------------------------------------------------- honest error check
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

export function leaveOneOut(comps, method) {
  const errors = comps.map((c, i) => {
    const rest = comps.filter((_, j) => j !== i);
    const guess = method === 'ridge' ? fitRidge(rest).predict(c.vector) : similarPlots(c, rest).perSqft;
    return Math.abs(guess - c.pricePerSqft) / c.pricePerSqft;
  });
  return { typical: median(errors), worst: Math.max(...errors) };
}

// ---------------------------------------------------------------- the estimate shown to the user
export function estimate(target, comps) {
  if (comps.length === 0) return null;
  const knn = similarPlots(target, comps);
  const knnError = comps.length >= 3 ? leaveOneOut(comps, 'knn') : null;
  let result = { method: 'Similar plots', perSqft: knn.perSqft, error: knnError, used: knn.used.slice(0, 3), learned: null };
  if (comps.length >= 6) {
    const ridge = fitRidge(comps);
    const ridgeError = leaveOneOut(comps, 'ridge');
    result.learned = { beta: ridge.beta, error: ridgeError, knnError };
    if (ridgeError.typical < knnError.typical) {
      result = { ...result, method: 'Learned factors', perSqft: ridge.predict(target.vector), error: ridgeError };
    }
  }
  const spread = result.error ? Math.max(0.1, result.error.typical) : 0.35; // rough until 3+ known prices
  result.low = result.perSqft * (1 - spread);
  result.high = result.perSqft * (1 + spread);
  result.rough = !result.error;
  return result;
}

// ₹ in Indian style: 12,34,567 and lakh / crore for big numbers
export function rupees(x) {
  if (x >= 1e7) return `₹${(x / 1e7).toFixed(2)} crore`;
  if (x >= 1e5) return `₹${(x / 1e5).toFixed(1)} lakh`;
  return `₹${Math.round(x).toLocaleString('en-IN')}`;
}
