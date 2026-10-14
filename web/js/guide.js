// "How to use the map": a step-by-step guide card (shown on the first visit, with "don't show again")
// and a compact help panel behind the "?" button. Neither blocks the map, so you can try things out.
const PREF = "altevatn.guide";          // "hidden" = don't show the guide on start

// ---------------------------------------------------------------- small illustrations
const A = "var(--accent-2)";
const mouse = (part) => `<svg viewBox="0 0 28 40" class="gi" aria-hidden="true">
  ${part === "left" ? `<path d="M3 17V14A11 11 0 0 1 14 3V17Z" fill="${A}"/>` : ""}
  ${part === "right" ? `<path d="M14 3A11 11 0 0 1 25 14V17H14Z" fill="${A}"/>` : ""}
  <rect x="3" y="3" width="22" height="34" rx="11" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M14 3V17M3 17H25" stroke="currentColor" stroke-width="2"/>
  <rect x="12" y="7" width="4" height="7" rx="2" fill="${part === "wheel" ? A : "currentColor"}"/></svg>`;
const arrowsH = `<path d="M3 20h7M6 16.5 2.5 20 6 23.5M37 20h-7M34 16.5l3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const finger = (kind) => `<svg viewBox="0 0 40 40" class="gi" aria-hidden="true">${
  kind === "one" ? `<circle cx="20" cy="20" r="6" fill="${A}"/>${arrowsH}`
  : kind === "two" ? `<circle cx="14" cy="22" r="5" fill="${A}"/><circle cx="26" cy="22" r="5" fill="${A}"/>
      <path d="M20 13V3M16.5 6.5 20 3l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  : `<circle cx="15" cy="25" r="5" fill="${A}"/><circle cx="25" cy="15" r="5" fill="${A}"/>
      <path d="M9 31 3 37M3 31v6h6M31 9l6-6M31 3h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`}</svg>`;
const kbd = (k) => `<kbd>${k}</kbd>`;
// tilted palaeo-shoreline vs today's flat lake (schematic, for the welcome step)
const TILT = `<svg viewBox="0 0 260 74" class="g-hero" aria-hidden="true">
  <path d="M0 30 L22 34 L40 50 L220 50 L236 30 L260 24 V74 H0Z" fill="#6b5a45" opacity=".75"/>
  <path d="M40 50 L220 50 L208 62 L52 62Z" fill="#2c6f86" opacity=".55"/>
  <path d="M30 47 L250 30" stroke="${A}" stroke-width="2.2" stroke-dasharray="5 4"/>
  <path d="M40 50 H220" stroke="#bfefff" stroke-width="2"/>
  <text x="8" y="20" fill="currentColor" font-size="11">NW</text><text x="236" y="16" fill="currentColor" font-size="11">SE</text></svg>`;

// language-independent part of each step: illustration and what to highlight
const STEPS = [
  { art: () => TILT },
  { art: (L) => chips([[mouse("left"), L.g_left_drag], [finger("one"), L.g_one_finger]]) },
  { art: (L) => chips([[mouse("right"), L.g_right_drag], [`${kbd("Shift")}${mouse("left")}`, L.g_shift_drag], [finger("two"), L.g_two_fingers]]) },
  { art: (L) => chips([[mouse("wheel"), L.g_wheel], [finger("pinch"), L.g_pinch]]) },
  { hl: ["#cam-row", "#btn-tour"], open: true },
  { hl: ["#timeline"] },
  { hl: ["#side section.ctl"], open: true },
  { hl: ["#btn-help", "#km-toggle", "#btn-export"] },
];
function chips(list) {
  return `<div class="g-chips">${list.map(([icon, label]) => `<div class="g-chip"><div class="g-ico">${icon}</div><span>${label}</span></div>`).join("")}</div>`;
}
const shown = (el) => !!el && document.contains(el) && el.getClientRects().length > 0;
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export function initGuide(app) {
  const { $, S } = app;
  const card = $("guide"), help = $("help"), live = $("guide-live");
  card.tabIndex = -1; help.tabIndex = -1;          // focus targets that are not controls (Space/arrows keep working)
  let step = 0, open = false, helpOpen = false, returnFocus = null;
  const helpBtn = () => [$("btn-help"), $("cap-help")].find(shown);

  const hidden = () => { try { return localStorage.getItem(PREF) === "hidden"; } catch { return false; } };
  const savePref = (hide) => { try { if (hide) localStorage.setItem(PREF, "hidden"); else localStorage.removeItem(PREF); } catch { /* private mode */ } };

  // ---------------------------------------------------------------- guide card
  function render() {
    const L = S(), steps = L.guide_steps, n = steps.length, [title, html] = steps[step];
    const meta = STEPS[step] ?? {};
    const dontShow = card.querySelector("#g-dont")?.checked ?? hidden();
    card.innerHTML = `<button class="icon close" type="button" id="g-close" aria-label="${L.close}" title="${L.close}">×</button>
      <div class="g-head"><span class="g-step" id="g-count">${L.guide_title} · ${step + 1}/${n}</span><h3 id="guide-h">${title}</h3></div>
      <div class="g-body">${meta.art ? meta.art(L) : ""}${html}</div>
      <div class="g-dots" role="group" aria-label="${L.guide_steps_label}">${steps.map((s, i) => `<button type="button" class="${i === step ? "on" : ""}" data-step="${i}" aria-label="${i + 1}: ${s[0]}" title="${s[0]}"${i === step ? ' aria-current="step"' : ""}></button>`).join("")}</div>
      <div class="g-foot">
        <label class="g-dont"><input type="checkbox" id="g-dont" ${dontShow ? "checked" : ""}> ${L.guide_dont}</label>
        <button type="button" id="g-prev" ${step === 0 ? "disabled" : ""}>${L.prev}</button>
        <button type="button" class="primary" id="g-next" aria-describedby="g-count guide-h">${step === n - 1 ? L.guide_done : L.next}</button>
      </div>`;
    // keyboard activation (detail 0) keeps the focus on the control; a mouse click leaves it on the card,
    // so that Space and the arrow keys go to the map and the time slider ("try it now")
    const kb = (e, where) => (e.detail === 0 ? where : null);
    card.querySelector("#g-close").addEventListener("click", close);
    card.querySelector("#g-prev").addEventListener("click", (e) => go(step - 1, kb(e, "prev")));
    card.querySelector("#g-next").addEventListener("click", (e) => (step >= n - 1 ? close() : go(step + 1, kb(e, "next"))));
    for (const d of card.querySelectorAll(".g-dots button")) d.addEventListener("click", (e) => go(Number(d.dataset.step), kb(e, "dot")));
    card.querySelector("#g-dont").addEventListener("change", (e) => savePref(e.target.checked));
    layout();
  }
  /** Highlight what the step talks about and place the card so that it does not cover it. */
  function layout() {
    for (const el of document.querySelectorAll(".guide-hl")) el.classList.remove("guide-hl");
    card.style.top = card.style.bottom = card.style.maxHeight = card.style.minHeight = "";
    if (!open) return;
    const meta = STEPS[step] ?? {};
    let targets = (meta.hl ?? []).flatMap((s) => [...document.querySelectorAll(s)]);
    // a collapsed side panel (phones) hides the controls: point at its "+" button instead
    if (meta.open && $("side").classList.contains("collapsed")) targets.push($("btn-side"));
    targets = targets.filter(shown);
    const tc = $("titlecard"), tcR = shown(tc) ? tc.getBoundingClientRect() : null;
    const inTitle = tcR ? targets.filter((t) => tc.contains(t)) : [];
    const bottomEdge = Math.min(...[$("side"), $("timeline")].filter(shown).map((el) => el.getBoundingClientRect().top), window.innerHeight);
    if (window.innerWidth <= 720) {
      if (inTitle.length && inTitle.length === targets.length) {
        // everything to show is in the title card: put the card below it
        const top = tcR.bottom + 8;
        card.style.top = `${top}px`;
        card.style.maxHeight = `${Math.max(200, window.innerHeight - top - 16)}px`;
      } else {
        // card at the top, above the side panel and the timeline; title-card targets would be hidden under it
        card.style.maxHeight = `${Math.max(220, bottomEdge - 16 - 10)}px`;
        targets = targets.filter((t) => !inTitle.includes(t));
      }
    } else if (inTitle.length && overlap(card.getBoundingClientRect(), tcR)) {
      const top = tcR.bottom + 10;
      card.style.top = `${top}px`;
      card.style.minHeight = "0";
      card.style.maxHeight = `${Math.max(200, ($("timeline").getBoundingClientRect().top || window.innerHeight) - top - 10)}px`;
    }
    for (const el of targets) el.classList.add("guide-hl");
    // bring a highlighted control inside the scrolling side panel into view
    const side = $("side"), t = targets.find((el) => el !== $("btn-side") && side.contains(el));
    if (t) {
      const sr = side.getBoundingClientRect(), r = t.getBoundingClientRect();
      if (r.top < sr.top || r.top > sr.bottom - 40) side.scrollTo({ top: side.scrollTop + r.top - sr.top - 8, behavior: "smooth" });
    }
  }
  /** focus: "next" | "prev" | "dot" (keyboard use) or null (focus the card itself) */
  function go(i, focus = null) {
    step = Math.max(0, Math.min(S().guide_steps.length - 1, i));
    render();
    const L = S(), n = L.guide_steps.length;
    live.textContent = `${L.guide_title} ${step + 1}/${n}: ${L.guide_steps[step][0]}`;
    const el = focus === "dot" ? card.querySelector(`.g-dots [data-step="${step}"]`)
      : focus === "prev" && step > 0 ? card.querySelector("#g-prev")
        : focus ? card.querySelector("#g-next") : card;
    el?.focus({ preventScroll: true });
  }
  function openGuide(i = 0) {
    if (!open) {
      const a = document.activeElement;
      returnFocus = help.contains(a) ? helpBtn() : a;    // opened from the help panel: return to the "?" button
    }
    closeHelp(false);
    $("app").classList.remove("present");               // presentation mode hides the controls the guide explains
    open = true;
    card.classList.remove("hidden");
    go(i);
  }
  function close() {
    if (!open) return;
    savePref(card.querySelector("#g-dont")?.checked);
    const hadFocus = card.contains(document.activeElement);
    open = false;
    card.classList.add("hidden");
    layout();
    live.textContent = "";
    if (hadFocus || document.activeElement === document.body) {
      const back = returnFocus !== document.body && shown(returnFocus) ? returnFocus : null;
      if (back) back.focus({ preventScroll: true }); else if (hadFocus) document.activeElement.blur();
    }
    returnFocus = null;
  }

  // ---------------------------------------------------------------- help panel
  function renderHelp() {
    const L = S();
    const keys = L.help_keys.map(([k, v]) => `<dt>${k.split(" ").map(kbd).join(" ")}</dt><dd>${v}</dd>`).join("");
    help.innerHTML = `<button class="icon close" type="button" id="help-close" aria-label="${L.close}" title="${L.close}">×</button>
      <h3 id="help-h">${L.help_title}</h3>
      <h4>${L.help_move}</h4>
      <table class="h-tbl"><thead><tr><th></th><th>${L.help_mouse}</th><th>${L.help_touch}</th></tr></thead><tbody>
        ${L.help_gestures.map(([a, m, t]) => `<tr><th>${a}</th><td>${m}</td><td>${t}</td></tr>`).join("")}</tbody></table>
      <p class="h-note">${L.help_map_note}</p>
      <h4>${L.help_time}</h4><p>${L.help_time_text}</p>
      <h4>${L.help_keys_title}</h4><dl class="h-keys">${keys}</dl>
      <h4>${L.help_tips}</h4><ul>${L.help_tip_list.map((t) => `<li>${t}</li>`).join("")}</ul>
      <div class="h-btns">
        <button type="button" class="primary" id="help-guide">${L.help_show_guide}</button>
        <button type="button" id="help-tour">${L.tour}</button>
        <button type="button" id="help-home">${L.reset_view}</button>
      </div>`;
    help.querySelector("#help-close").addEventListener("click", () => closeHelp());
    help.querySelector("#help-guide").addEventListener("click", () => openGuide(0));
    help.querySelector("#help-tour").addEventListener("click", () => { closeHelp(false); app.startTour(); });
    help.querySelector("#help-home").addEventListener("click", () => { closeHelp(false); app.resetView(); });
  }
  function placeHelp() {
    // below the visible "?" button, otherwise top-left
    const btn = helpBtn();
    const w = help.offsetWidth, vw = window.innerWidth;
    if (btn) {
      const r = btn.getBoundingClientRect();
      help.style.left = `${Math.max(8, Math.min(vw - w - 8, r.right - w))}px`;
      help.style.top = `${r.bottom + 8}px`;
    } else { help.style.left = "16px"; help.style.top = "16px"; }
    help.style.maxHeight = `${window.innerHeight - parseFloat(help.style.top) - 16}px`;
  }
  function openHelp() {
    helpOpen = true;
    renderHelp();
    help.classList.remove("hidden");
    placeHelp();
    help.scrollTop = 0;
    for (const b of [$("btn-help"), $("cap-help")]) b?.setAttribute("aria-expanded", "true");
    help.focus({ preventScroll: true });
  }
  function closeHelp(refocus = true) {
    if (!helpOpen) return;
    const hadFocus = help.contains(document.activeElement);
    helpOpen = false;
    help.classList.add("hidden");
    for (const b of [$("btn-help"), $("cap-help")]) b?.setAttribute("aria-expanded", "false");
    if (refocus && hadFocus) helpBtn()?.focus({ preventScroll: true });
  }
  const toggleHelp = () => (helpOpen ? closeHelp() : openHelp());
  for (const b of [$("btn-help"), $("cap-help")]) b?.addEventListener("click", toggleHelp);
  // a click outside the help panel closes it (like a menu)
  document.addEventListener("pointerdown", (e) => {
    if (helpOpen && !help.contains(e.target) && !e.target.closest("#btn-help, #cap-help")) closeHelp(false);
  });
  window.addEventListener("resize", () => { if (helpOpen) placeHelp(); if (open) layout(); });
  // opening the side panel on a phone changes its height and whether "+" needs pointing out
  $("btn-side").addEventListener("click", () => { if (open) layout(); });

  return {
    open: openGuide,
    close,
    isOpen: () => open,
    /** the arrow keys page the guide only while one of its step controls has the keyboard focus */
    pagingFocus: () => open && !!document.activeElement?.closest?.("#guide .g-dots, #g-prev, #g-next"),
    prev: () => go(step - 1, document.activeElement?.closest?.(".g-dots") ? "dot" : "prev"),
    next: () => (step >= S().guide_steps.length - 1 ? close() : go(step + 1, document.activeElement?.closest?.(".g-dots") ? "dot" : "next")),
    openHelp, closeHelp, toggleHelp,
    isHelpOpen: () => helpOpen,
    /** Show the guide on start unless the visitor said "don't show again" (?guide=1 forces it, ?guide=0 skips it). */
    showOnStart(param) {
      if (param === "0" || (param !== "1" && hidden())) return;
      openGuide(0);
    },
    /** Re-render in the current language and keep the keyboard focus where it was. */
    rerender() {
      const a = document.activeElement;
      const box = open && card.contains(a) ? card : helpOpen && help.contains(a) ? help : null;
      const sel = !box || a === box ? null : a.id ? `#${a.id}` : a.dataset?.step != null ? `[data-step="${a.dataset.step}"]` : null;
      if (open) render();
      if (helpOpen) { renderHelp(); placeHelp(); }
      if (box) ((sel && box.querySelector(sel)) || box).focus({ preventScroll: true });
      for (const b of [$("btn-help"), $("cap-help")]) { b?.setAttribute("aria-label", S().help_title); b?.setAttribute("title", `${S().help_title} (?)`); }
    },
  };
}
