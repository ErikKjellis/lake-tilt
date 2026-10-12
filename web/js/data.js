// Loads the exported scene data (see tools/export_web.py).

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onBytes?.(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onBytes?.(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

export async function loadScene(base, progress) {
  const steps = { meta: 0.02, height: 0.25, lakes: 0.18, masks: 0.03, basemap: 0.52 };
  const done = {};
  const report = (k, f, msg) => {
    done[k] = f;
    const p = Object.entries(steps).reduce((s, [kk, w]) => s + w * (done[kk] || 0), 0);
    progress?.(p, msg);
  };

  const meta = await (await fetch(`${base}/meta.json`)).json();
  report("meta", 1, "meta");
  const g = meta.grid;

  const hBuf = await fetchWithProgress(`${base}/height.bin`, (a, b) => report("height", a / b, "terrain"));
  const q = new Uint16Array(hBuf);
  const height = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) height[i] = g.z_offset + q[i] * g.z_scale;

  const lakes = [];
  for (let li = 0; li < meta.lakes.length; li++) {
    const L = meta.lakes[li];
    const buf = await fetchWithProgress(`${base}/${L.file}`, (a, b) => report("lakes", (li + a / b) / meta.lakes.length, "lakes"));
    const n = L.n;
    lakes.push({ idx: new Uint32Array(buf, 0, n), a: new Float32Array(buf, 4 * n, n), b: new Float32Array(buf, 8 * n, n) });
  }

  const maskImg = await loadImage(`${base}/${meta.masks.file}`);
  const cv = document.createElement("canvas");
  cv.width = maskImg.width; cv.height = maskImg.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(maskImg, 0, 0);
  const maskData = ctx.getImageData(0, 0, cv.width, cv.height).data;
  report("masks", 1, "masks");

  const first = meta.basemaps[0];
  const basemap = await loadImage(`${base}/${first.file}`);
  report("basemap", 1, "map");

  return { meta, height, lakes, maskImg, maskData, maskW: cv.width, maskH: cv.height, basemaps: { [first.id]: basemap } };
}
