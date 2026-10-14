// Lake picker: a small map of Norway with a pin per scene, and a searchable combobox.
// Scenes are listed in data/lakes.json (written by tools/export_web.py); choosing one reloads
// the page with ?lake=<id>, keeping the other URL options (lang, q).

const SVGNS = "http://www.w3.org/2000/svg";
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Search key: lower case, without diacritics; ø/æ/å also match o/ae/a. */
const fold = (s) => String(s ?? "").toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "a")
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

export class LakePicker {
  /**
   * @param {object} o  { current: lake id, getLang: () => "en" | "no", strings: () => STRINGS[lang] }
   */
  constructor(o) {
    this.o = o;
    this.root = document.getElementById("picker");
    this.input = document.getElementById("lk-search");
    this.list = document.getElementById("lk-list");
    this.svg = document.getElementById("lk-map");
    this.active = -1;
    this.shown = [];
    this.lakes = null;
    document.getElementById("lk-close").addEventListener("click", () => this.close());
    this.root.addEventListener("click", (e) => { if (e.target === this.root) this.close(); });
    this.input.addEventListener("input", () => { this.active = this.shown.length ? 0 : -1; this.render(); });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
  }

  async load() {
    if (this.lakes) return;
    const [reg, outline] = await Promise.all([
      fetch("data/lakes.json").then((r) => r.json()),
      fetch("data/norway_outline.json").then((r) => r.json()).catch(() => null),
    ]);
    this.lakes = reg.lakes;
    this.outline = outline;
    this.drawMap();
  }

  isOpen() { return !this.root.classList.contains("hidden"); }

  /** @param {string} [notice] shown above the map instead of the intro text (e.g. an unknown lake) */
  async open(notice) {
    const intro = this.root.querySelector(".lk-intro");
    if (notice) { intro.textContent = notice; intro.classList.add("warn"); }
    this.root.classList.remove("hidden");
    try { await this.load(); } catch (e) {
      this.list.innerHTML = `<li class="lk-empty">${esc(this.o.strings().lk_error)} (${esc(e.message)})</li>`;
      return;
    }
    this.input.value = "";
    this.active = Math.max(0, this.lakes.findIndex((L) => L.id === this.o.current));
    this.render();
    this.input.focus();
  }

  close() { this.root.classList.add("hidden"); this.input.setAttribute("aria-expanded", "false"); }

  go(id) {
    if (id === this.o.current) { this.close(); return; }
    const p = new URLSearchParams(location.search);
    p.set("lake", id);
    location.search = p.toString();
  }

  /** Re-render texts after a language switch. */
  relabel() { if (this.lakes) { this.render(); this.drawMap(); } }

  matches() {
    const q = fold(this.input.value.trim());
    const lang = this.o.getLang();
    return this.lakes.filter((L) => !q || [L.name, L.region?.[lang], L.region?.en, L.subtitle?.[lang], L.vatnlnr]
      .some((v) => fold(v).includes(q)));
  }

  render() {
    const S = this.o.strings(), lang = this.o.getLang();
    this.shown = this.matches();
    if (this.active >= this.shown.length) this.active = this.shown.length - 1;
    this.input.setAttribute("aria-expanded", "true");
    this.list.innerHTML = this.shown.length ? this.shown.map((L, i) => `
      <li role="option" id="lk-opt-${esc(L.id)}" data-id="${esc(L.id)}" aria-selected="${i === this.active}" class="${L.id === this.o.current ? "current" : ""}">
        <span class="lk-name">${esc(L.name)}${L.id === this.o.current ? ` <em>${esc(S.lk_current)}</em>` : ""}</span>
        <span class="lk-region">${esc(L.region?.[lang] ?? L.region?.en ?? "")}${L.level_m ? ` · ${esc(String(L.level_m).replace(".", lang === "no" ? "," : "."))} ${lang === "no" ? "moh." : "m"}` : ""}</span>
        ${L.subtitle?.[lang] ? `<span class="lk-sub">${esc(L.subtitle[lang])}</span>` : ""}
      </li>`).join("") : `<li class="lk-empty">${esc(S.lk_none)}</li>`;
    for (const li of this.list.querySelectorAll("[data-id]")) {
      li.addEventListener("click", () => this.go(li.dataset.id));
      li.addEventListener("mouseenter", () => this.highlight(li.dataset.id));
    }
    const act = this.shown[this.active];
    if (act) {
      this.input.setAttribute("aria-activedescendant", `lk-opt-${act.id}`);
      this.list.querySelector(`[data-id="${CSS.escape(act.id)}"]`)?.scrollIntoView({ block: "nearest" });
    } else this.input.removeAttribute("aria-activedescendant");
    document.getElementById("lk-count").textContent = S.lk_count(this.shown.length, this.lakes.length);
    this.highlight(act?.id);
  }

  onKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!this.shown.length) return;
      this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.shown.length) % this.shown.length;
      this.render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const L = this.shown[this.active];
      if (L) this.go(L.id);
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); this.close();
    }
  }

  /** Pin and list item of one lake drawn as active. */
  highlight(id) {
    for (const g of this.svg.querySelectorAll(".lk-pin")) g.classList.toggle("hot", g.dataset.id === id);
    for (const li of this.list.querySelectorAll("[data-id]")) li.classList.toggle("hot", li.dataset.id === id);
  }

  drawMap() {
    const svg = this.svg;
    svg.replaceChildren();
    const [x0, y0, x1, y1] = this.outline?.bbox_km ?? [-120, 6380, 1180, 7980];
    // the mainland only: crop the empty sea in the west and the far north-east a little
    const vx0 = x0 + 60, vx1 = x1 - 80, vy0 = y0, vy1 = y1 - 40;
    svg.setAttribute("viewBox", `${vx0} ${-vy1} ${vx1 - vx0} ${vy1 - vy0}`);
    const path = (rings, cls) => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", rings.map((r) => "M" + r.map(([x, y]) => `${x},${-y}`).join("L") + "Z").join(""));
      p.setAttribute("class", cls);
      svg.appendChild(p);
    };
    if (this.outline) { path(this.outline.neighbours, "lk-nb"); path(this.outline.norway, "lk-no"); }
    const S = this.o.strings();
    for (const L of this.lakes) {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", `lk-pin${L.id === this.o.current ? " current" : ""}`);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `${L.name}${L.id === this.o.current ? ` (${S.lk_current})` : ""}`);
      g.dataset.id = L.id;
      const X = L.x / 1000, Y = -L.y / 1000;
      g.innerHTML = `<circle class="halo" cx="${X}" cy="${Y}" r="22"></circle><circle cx="${X}" cy="${Y}" r="11"></circle>`
        + `<text x="${X + 20}" y="${Y + 9}">${esc(L.name)}</text><title>${esc(L.name)} — ${esc(L.region?.[this.o.getLang()] ?? "")}</title>`;
      g.addEventListener("click", () => this.go(L.id));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.go(L.id); } });
      g.addEventListener("mouseenter", () => this.highlight(L.id));
      g.addEventListener("focus", () => this.highlight(L.id));
      svg.appendChild(g);
    }
  }
}
