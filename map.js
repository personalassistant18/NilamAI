// Nilam - map.js
// The map: Leaflet (open-source map library) with free OpenStreetMap tiles.

import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

const POI_COLOURS = {
  shop: '#8b5cf6', school: '#2563eb', health: '#dc2626', bank: '#059669',
  transport: '#0891b2', upcoming: '#c026d3', industrial: '#6b7280',
};

export function createMap(container, { onPick }) {
  const map = L.map(container, { zoomControl: true }).setView([10.95, 78.6], 8); // Tamil Nadu
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const surroundings = L.layerGroup().addTo(map);
  const known = L.layerGroup().addTo(map);
  const pinIcon = L.divIcon({ className: 'pin-icon', html: '<div class="pin"></div>', iconSize: [28, 40], iconAnchor: [14, 38] });
  let pin = null;

  const place = (lat, lng) => {
    if (!pin) {
      pin = L.marker([lat, lng], { icon: pinIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);
      pin.on('dragend', () => { const p = pin.getLatLng(); onPick(p.lat, p.lng); });
    } else {
      pin.setLatLng([lat, lng]);
    }
    onPick(lat, lng);
  };
  map.on('click', (e) => place(e.latlng.lat, e.latlng.lng)); // tap the map to choose a plot

  return {
    place,
    goTo(lat, lng, zoom = 16) { map.setView([lat, lng], zoom); },
    showSurroundings(f) {
      surroundings.clearLayers();
      f.layers.minor.forEach((l) => L.polyline(l, { color: '#94a3b8', weight: 2 }).addTo(surroundings));
      f.layers.major.forEach((l) => L.polyline(l, { color: '#f97316', weight: 5, opacity: 0.85 }).addTo(surroundings));
      f.layers.upcoming.forEach((l) => L.polyline(l, { color: '#c026d3', weight: 4, dashArray: '8 6' }).addTo(surroundings));
      f.layers.pois.forEach((p) => L.circleMarker([p.lat, p.lon], {
        radius: 4, weight: 1, color: '#fff', fillColor: POI_COLOURS[p.kind] || '#111', fillOpacity: 0.9,
      }).bindTooltip(p.name || p.kind).addTo(surroundings));
      if (f.town && f.town.lat != null) {
        L.polyline([[f.lat, f.lon], [f.town.lat, f.town.lon]], { color: '#0f172a', weight: 1.5, dashArray: '3 6' }).addTo(surroundings);
        L.circleMarker([f.town.lat, f.town.lon], { radius: 7, color: '#0f172a', fillColor: '#facc15', fillOpacity: 1 })
          .bindTooltip(`${f.town.name} centre`, { permanent: f.town.km < 8, direction: 'top' }).addTo(surroundings);
      }
    },
    showKnownPrices(comps, label) {
      known.clearLayers();
      comps.forEach((c) => L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: 'price-icon', html: `<span>${label(c)}</span>`, iconSize: null }),
      }).addTo(known));
    },
    refresh() { map.invalidateSize(); },
  };
}
