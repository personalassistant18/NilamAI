// Nilam - score.js
// The Location Score (0-100): how well-located a plot is, factor by factor.
// The factor weights below are STARTING ASSUMPTIONS based on common real-estate
// practice (location, road access, amenities). They are not learned from prices.
// The price model in valuation.js learns what matters in your area instead.

const km = (x) => `${x < 10 ? x.toFixed(1) : Math.round(x)} km`;
const m = (x) => (x < 1000 ? `${Math.round(x / 10) * 10} m` : km(x / 1000));
const near = (x, scale) => (x === null ? 0 : Math.exp(-x / scale)); // 1 when close, falls off with distance
const plenty = (n, scale) => 1 - Math.exp(-n / scale);               // 0 when none, approaches 1 with more

export const FACTORS = [
  {
    key: 'centre', label: 'Close to the town / city centre', weight: 25,
    score: (f) => Math.max(near(f.town && f.town.km, 4), near(f.city && f.city.km, 10)),
    detail: (f) => (f.town ? `${f.town.name} centre ${km(f.town.km)}` : 'No town centre within 60 km') +
      (f.city && f.town && f.city.name !== f.town.name ? ` · ${f.city.name} ${km(f.city.km)}` : ''),
  },
  {
    key: 'mainRoad', label: 'Main road nearby', weight: 15,
    score: (f) => Math.max(near(f.majorRoad.m, 800), 0.7 * near(f.otherRoad.m, 500)),
    detail: (f) => (f.majorRoad.m !== null ? `Main road${f.majorRoad.name ? ` (${f.majorRoad.name})` : ''} ${m(f.majorRoad.m)}` : 'No main road within 3 km') +
      (f.otherRoad.m !== null ? ` · other road ${m(f.otherRoad.m)}` : ''),
  },
  {
    key: 'access', label: 'Road access to the plot', weight: 15,
    score: (f) => (f.anyRoadM === null ? 0 : f.anyRoadM <= 25 ? 1 : Math.exp(-(f.anyRoadM - 25) / 80)),
    detail: (f) => (f.anyRoadM === null ? 'No mapped road within 300 m' : `Nearest road ${m(f.anyRoadM)}`),
  },
  {
    key: 'shops', label: 'Shops and markets', weight: 12,
    score: (f) => plenty(f.shops, 20),
    detail: (f) => `${f.shops} shop${f.shops === 1 ? '' : 's'} within 1 km`,
  },
  {
    key: 'schools', label: 'Schools and colleges', weight: 10,
    score: (f) => plenty(f.schools, 4),
    detail: (f) => `${f.schools} within 2 km${f.nearestSchoolM !== null ? ` · nearest ${m(f.nearestSchoolM)}` : ''}`,
  },
  {
    key: 'health', label: 'Hospitals and clinics', weight: 8,
    score: (f) => plenty(f.health, 4),
    detail: (f) => `${f.health} within 2 km${f.nearestHealthM !== null ? ` · nearest ${m(f.nearestHealthM)}` : ''}`,
  },
  {
    key: 'banks', label: 'Banks and ATMs', weight: 5,
    score: (f) => plenty(f.banks, 4),
    detail: (f) => `${f.banks} within 2 km`,
  },
  {
    key: 'transport', label: 'Public transport', weight: 8,
    score: (f) => Math.max(plenty(f.busStops, 5), near(f.railway.km, 4), near(f.busStation.km, 3)),
    detail: (f) => [`${f.busStops} bus stop${f.busStops === 1 ? '' : 's'} within 1.5 km`,
      f.busStation.km !== null ? `bus stand ${km(f.busStation.km)}` : null,
      f.railway.km !== null ? `railway station ${km(f.railway.km)}` : null].filter(Boolean).join(' · '),
  },
  {
    key: 'upcoming', label: 'Upcoming projects nearby', weight: 2,
    score: (f) => (f.upcoming.nearestKm === null ? 0 : f.upcoming.nearestKm <= 3 ? 1 : 0.5),
    detail: (f) => (f.upcoming.nearestKm === null ? 'None mapped within 5 km'
      : `${f.upcoming.roads} road project${f.upcoming.roads === 1 ? '' : 's'}, ${f.upcoming.sites} construction site${f.upcoming.sites === 1 ? '' : 's'} · nearest ${km(f.upcoming.nearestKm)}`),
  },
];

export function locationScore(f) {
  const parts = FACTORS.map((x) => {
    const s = Math.max(0, Math.min(1, x.score(f)));
    return { key: x.key, label: x.label, max: x.weight, points: s * x.weight, detail: x.detail(f) };
  });
  const score = parts.reduce((sum, p) => sum + p.points, 0);
  return { score, grade: grade(score), parts };
}

export function grade(score) {
  if (score >= 75) return 'Excellent location';
  if (score >= 55) return 'Good location';
  if (score >= 35) return 'Average location';
  return 'Developing / remote area';
}
