// Askeladden IDs and ID labels: pure helpers (no DOM, no three.js), so they can be tested with plain node.
//
// Askeladden is Riksantikvaren's register of cultural heritage. A site is identified by a number such as
// "171464" (the locality) or "171464-1" (an individual monument of it). In kulturminner.json each site has
// `id` (as registered, e.g. "171464-1" or "172105") and `lid` (the number before the dash). A locality that
// consists of several separate parts appears as several sites with the same `id`.

// soft hyphen, hyphen variants, figure/en/em dash, minus signs: all read as "-"
const DASHES = new RegExp(`[${[0xad, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe63, 0xff0d].map((c) => String.fromCharCode(c)).join("")}]`, "g");
const SPACED_DASH = /(\d)\s*-\s*(\d)/g;                   // "171464 - 1" -> "171464-1"
const LINK = /lokalitet\/(\d+(?:-\d+)?)/i;               // https://kulturminnesok.no/ra/lokalitet/171464 (a link is one word: digits in its query string are not read)
const ID = /\d+(?:-\d+)?/g;

/**
 * Read the IDs from what the user typed. IDs are separated by commas (also accepted: semicolons, line breaks
 * and spaces). "ID 171464", "#171464" and Kulturminnesøk links are understood.
 * @returns {{ids: string[], unreadable: string[]}} IDs in the order typed without duplicates; the comma-separated
 *   pieces that contain no number
 */
export function parseIds(text) {
  const ids = [], seen = new Set(), unreadable = [];
  const add = (id) => { if (!seen.has(id)) { seen.add(id); ids.push(id); } };
  for (const piece of String(text ?? "").replace(DASHES, "-").replace(SPACED_DASH, "$1-$2").split(/[,;\n]+/)) {
    const p = piece.trim();
    if (!p) continue;
    let found = false;
    for (const word of p.split(/\s+/)) {            // word by word: linear even for very long input
      const link = word.match(LINK);
      const nums = link ? [link[1]] : word.match(ID);
      if (nums) { nums.forEach(add); found = true; }
    }
    if (!found) unreadable.push(p);
  }
  return { ids, unreadable };
}

/**
 * Which sites do the IDs select?
 *  - "171464" (no dash): every site of that locality ("171464", "171464-0", "171464-1", all parts);
 *  - "171464-1" (dash): the site(s) with exactly that ID; if the scene has none, the locality's sites.
 * @param {{id: string, lid?: string}[]} sites
 * @param {string[]} ids from parseIds()
 * @returns {{selected: Uint8Array, count: number, found: string[], missing: string[]}}
 */
export function matchSites(sites, ids) {
  const byId = new Map(), byLid = new Map();
  const push = (m, k, i) => { const l = m.get(k); if (l) l.push(i); else m.set(k, [i]); };
  sites.forEach((s, i) => { push(byId, String(s.id), i); push(byLid, String(s.lid ?? String(s.id).split("-")[0]), i); });
  const selected = new Uint8Array(sites.length), found = [], missing = [];
  for (const id of ids) {
    const hit = id.includes("-") ? (byId.get(id) ?? byLid.get(id.split("-")[0])) : byLid.get(id);
    if (!hit) { missing.push(id); continue; }
    found.push(id);
    for (const i of hit) selected[i] = 1;
  }
  let count = 0;
  for (const v of selected) count += v;
  return { selected, count, found, missing };
}

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Greedy label placement: every label goes beside its marker (right, left, above, below, in that order) at the
 * first position where it covers neither a label placed before nor any marker, and stays inside the view.
 * @param {{x: number, y: number, w: number, h: number, r: number, prio?: number}[]} items marker centre (px),
 *   label size (px), marker radius (px) and priority (higher first; ties keep the input order)
 * @param {number} W view width (px)
 * @param {number} H view height (px)
 * @param {{gap?: number, max?: number, margin?: number}} [opt]
 * @returns {({x: number, y: number} | null)[]} top-left corner of each label, or null when it does not fit
 */
export function placeLabels(items, W, H, { gap = 3, max = Infinity, margin = 2 } = {}) {
  const CELL = 64, grid = new Map();
  const cells = (b, fn) => {
    for (let cx = Math.floor(b.x / CELL), x1 = Math.floor((b.x + b.w) / CELL); cx <= x1; cx++)
      for (let cy = Math.floor(b.y / CELL), y1 = Math.floor((b.y + b.h) / CELL); cy <= y1; cy++) fn(`${cx},${cy}`);
  };
  const insert = (b) => cells(b, (k) => { const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]); });
  const hits = (b, owner) => {
    let bad = false;
    cells(b, (k) => { if (!bad) for (const o of grid.get(k) ?? []) if (o.owner !== owner && overlap(b, o)) { bad = true; break; } });
    return bad;
  };
  items.forEach((it, i) => insert({ x: it.x - it.r, y: it.y - it.r, w: 2 * it.r, h: 2 * it.r, owner: i, marker: true }));
  const out = new Array(items.length).fill(null);
  const order = items.map((_, i) => i).sort((a, b) => (items[b].prio ?? 0) - (items[a].prio ?? 0) || a - b);
  let placed = 0;
  for (const i of order) {
    if (placed >= max) break;
    const { x, y, w, h, r } = items[i];
    const spots = [[x + r + gap, y - h / 2], [x - r - gap - w, y - h / 2], [x - w / 2, y - r - gap - h], [x - w / 2, y + r + gap]];
    for (const [lx, ly] of spots) {
      if (lx < margin || ly < margin || lx + w > W - margin || ly + h > H - margin) continue;
      const box = { x: lx, y: ly, w, h, owner: i };
      if (hits(box, i)) continue;
      insert(box);
      out[i] = { x: lx, y: ly };
      placed++;
      break;
    }
  }
  return out;
}
