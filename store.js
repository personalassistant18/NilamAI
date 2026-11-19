// Nilam - store.js
// Keeps the known prices you enter on this device (localStorage). Nothing is uploaded.

const KEY = 'nilam:v1';

export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === 1 && Array.isArray(s.comps)) return s;
  } catch (_) { /* storage unavailable: start empty */ }
  return { version: 1, comps: [], nextId: 1 };
}

export function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (_) { return false; }
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
