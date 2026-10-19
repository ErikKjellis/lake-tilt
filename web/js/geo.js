// Coordinates typed by the user ("own points", e.g. heritage sites with restricted access that the open API
// does not deliver): parsing and conversion to EPSG:25833 (ETRS89 / UTM 33N), the coordinate system of the scenes.
// Pure functions, no DOM: testable with plain node.

/** Coordinate systems the user can choose: UTM 32, 33 and 35 (ETRS89) or latitude/longitude in degrees. */
export const CRS_LIST = [
  { id: "25833", label: "UTM 33 (EPSG:25833)", zone: 33 },
  { id: "25832", label: "UTM 32 (EPSG:25832)", zone: 32 },
  { id: "25835", label: "UTM 35 (EPSG:25835)", zone: 35 },
  { id: "4326", label: "WGS84 / ETRS89 lat, lon (°)", zone: 0 },
];

// GRS80 ellipsoid (ETRS89; WGS84 differs by less than a millimetre in the flattening)
const A = 6378137, FLAT = 1 / 298.257222101, K0 = 0.9996, FE = 500000;
const n = FLAT / (2 - FLAT), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A_ = (A / (1 + n)) * (1 + n2 / 4 + n4 / 64);
// Krüger series (as in Karney 2011, truncated at n^4: millimetre accuracy within several degrees of the central meridian)
const ALPHA = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49561 * n4) / 161280];
const BETA = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360, n2 / 48 + n3 / 15 - (437 * n4) / 1440, (17 * n3) / 480 - (37 * n4) / 840, (4397 * n4) / 161280];
const DELTA = [2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45, (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45, (56 * n3) / 15 - (136 * n4) / 35, (4279 * n4) / 630];
const RAD = Math.PI / 180;
const centralMeridian = (zone) => (zone * 6 - 183) * RAD;

/** UTM zone coordinates (E, N in metres) -> latitude, longitude in degrees. */
export function utmToLatLon(E, N, zone) {
  const xi = N / (K0 * A_), eta = (E - FE) / (K0 * A_);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 4; j++) {
    xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lam = centralMeridian(zone) + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: phi / RAD, lon: lam / RAD };
}

/** Latitude, longitude in degrees -> UTM zone coordinates (E, N in metres). */
export function latLonToUtm(lat, lon, zone) {
  const phi = lat * RAD, dl = lon * RAD - centralMeridian(zone);
  const q = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - q * Math.atanh(q * Math.sin(phi)));
  const xi1 = Math.atan2(t, Math.cos(dl)), eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xi1, eta = eta1;
  for (let j = 1; j <= 4; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
  }
  return { x: FE + K0 * A_ * eta, y: K0 * A_ * xi };
}

/**
 * Two numbers in the given system -> EPSG:25833, or null if they cannot be coordinates in that system.
 * The order is forgiven: easting/northing (x y) or northing/easting, and latitude/longitude or the reverse.
 * Eastings may be negative (western Norway in UTM 33) or above 1 000 000 (Finnmark).
 */
export function toUtm33(a, b, crs) {
  const sys = CRS_LIST.find((c) => c.id === String(crs)) ?? CRS_LIST[0];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (sys.zone === 0) {
    const [lat, lon] = a > 45 && b < 45 ? [a, b] : b > 45 && a < 45 ? [b, a] : [a, b];   // Norway: lat 57-72, lon 4-32
    if (!(lat >= 45 && lat <= 82 && lon >= -30 && lon <= 60)) return null;              // Norway and its surroundings
    const r = latLonToUtm(lat, lon, 33);
    return Number.isFinite(r.x) && Number.isFinite(r.y) ? r : null;
  }
  const [E, N] = a > 3e6 && b < 3e6 ? [b, a] : [a, b];       // northing first? (northings are above 5.5e6, eastings below 2.5e6)
  if (!(E > -1e6 && E < 2.5e6 && N > 5.5e6 && N < 8.5e6)) return null;
  if (sys.zone === 33) return { x: E, y: N };
  const ll = utmToLatLon(E, N, sys.zone);
  const r = latLonToUtm(ll.lat, ll.lon, 33);
  return Number.isFinite(r.x) && Number.isFinite(r.y) ? r : null;
}

/** EPSG:25833 -> the two numbers to write in the given system (for examples): rounded metres, or degrees (5 decimals). */
export function fromUtm33(x, y, crs) {
  const sys = CRS_LIST.find((c) => c.id === String(crs)) ?? CRS_LIST[0];
  if (sys.zone === 33) return [Math.round(x), Math.round(y)];
  const ll = utmToLatLon(x, y, 33);
  if (sys.zone === 0) return [Number(ll.lat.toFixed(5)), Number(ll.lon.toFixed(5))];
  const r = latLonToUtm(ll.lat, ll.lon, sys.zone);
  return [Math.round(r.x), Math.round(r.y)];
}

export const MAX_POINTS = 1000;
export const MAX_LABEL = 60;
const MAX_LINE = 500;

// A line is "x y label". Two readings, tried in this order:
//  1. x and y separated by whitespace or a semicolon; a decimal comma is understood (at most 3 decimals):
//     "660111 7623157 Name", "660111;7623157;Name", "660111,5 7623157,2 Name", "68,585; 19,32 Name"
//  2. x and y separated by a comma, decimals with a dot: "660111,7623157,Name", "660111, 7623157, 3 stones", "68.585,19.32"
// (so a label that starts with digits after a comma-separated pair is a label, not decimals)
const NUMD = String.raw`[-+]?\d+(?:\.\d+)?`;
const NUMC = String.raw`[-+]?\d+(?:\.\d+|,\d{1,3}(?!\d))?`;
const READINGS = [
  new RegExp(String.raw`^(${NUMC})[ \t;]+(${NUMC})(?=$|[ \t;,])[ \t;,]*(.*)$`),
  new RegExp(String.raw`^(${NUMD})[ \t]*,[ \t]*(${NUMD})(?=$|[ \t;,])[ \t;,]*(.*)$`),
];
const NBSP = String.fromCharCode(0xa0);

/**
 * One point per line: two numbers, then an optional label. Blank lines, lines starting with # or // and a first
 * line without any digit (a header such as "x;y;label") are ignored. Surrounding quotes and trailing separators of
 * the label (spreadsheet exports) are removed.
 * @param {string} text
 * @param {string} crs one of CRS_LIST ids
 * @returns {{points: {x: number, y: number, label: string, line: number}[], errors: {line: number, text: string}[], truncated: boolean}}
 *   x, y in EPSG:25833; line is the 1-based line number
 */
export function parsePoints(text, crs) {
  const points = [], errors = [];
  let truncated = false, started = false;
  String(text ?? "").split(/\r?\n/).forEach((raw, i) => {
    const s = raw.replaceAll(NBSP, " ").trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return;
    if (!started) { started = true; if (!/\d/.test(s)) return; }
    if (points.length >= MAX_POINTS) { truncated = true; return; }
    let xy = null, label = "";
    if (s.length <= MAX_LINE) {
      for (const re of READINGS) {
        const m = s.match(re);
        xy = m ? toUtm33(parseFloat(m[1].replace(",", ".")), parseFloat(m[2].replace(",", ".")), crs) : null;
        if (xy) { label = (m[3] ?? "").replace(/[;,\s]+$/, "").replace(/^["“”](.*)["“”]$/, "$1").trim(); break; }
      }
    }
    if (!xy) { errors.push({ line: i + 1, text: s.length > 40 ? `${s.slice(0, 39)}…` : s }); return; }
    points.push({ x: xy.x, y: xy.y, label: label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label, line: i + 1 });
  });
  return { points, errors, truncated };
}
