// Nilam - coords.js
// Understands coordinates typed or pasted in the common formats:
//   10.8050, 78.6856            (decimal latitude, longitude)
//   10°48'18.0"N 78°41'08.2"E   (degrees, minutes, seconds)
//   Google Maps links           (…/@10.805,78.6856,17z  …?q=10.805,78.6856  …!3d10.805!4d78.6856)

const NUM = '(-?\\d+(?:\\.\\d+)?)';

export function parseCoordinates(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  const link = s.match(new RegExp(`!3d${NUM}!4d${NUM}`)) ||
    s.match(new RegExp(`@${NUM},\\s*${NUM}`)) ||
    s.match(new RegExp(`[?&](?:q|ll|query|center)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i'));
  if (link) return valid(Number(link[1]), Number(link[2]));

  const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])/gi)];
  if (dms.length === 2) {
    const read = (p) => {
      let v = Number(p[1]) + (Number(p[2]) || 0) / 60 + (Number(p[3]) || 0) / 3600;
      if (/[SW]/i.test(p[4])) v = -v;
      return { v, isLat: /[NS]/i.test(p[4]) };
    };
    const a = read(dms[0]);
    const b = read(dms[1]);
    if (a.isLat !== b.isLat) return a.isLat ? valid(a.v, b.v) : valid(b.v, a.v);
  }

  const plain = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[NS]?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[EW]?$/i);
  if (plain) return valid(Number(plain[1]), Number(plain[2]));
  return null;
}

function valid(lat, lng) {
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const inIndia = ({ lat, lng }) => lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;

// The part after # in a shareable link, e.g. ...github.io/nilam/#10.805000,78.685600
export const linkFragment = ({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
