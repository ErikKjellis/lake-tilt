// Content of the "About the model" dialog.

const SCHEMATIC = (L) => `
<svg viewBox="0 0 760 250" role="img" aria-label="${L.aria}" style="width:100%;height:auto;margin:6px 0 4px">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#f2b25c"/></marker>
  </defs>
  <style>
    .lnd{fill:#6d6152} .lndE{stroke:#e8dcc8;stroke-width:1.5;fill:none} .wat{fill:#59c3d6;fill-opacity:.55} .ws{stroke:#bff3ff;stroke-width:2}
    .old{stroke:#cc73ff;stroke-width:2;stroke-dasharray:6 5;fill:none} .t{fill:#cfdce4;font:12.5px Inter,Segoe UI,sans-serif} .h{fill:#e6eef3;font:600 13.5px Inter,Segoe UI,sans-serif}
    .up{stroke:#f2b25c;stroke-width:2.2}
  </style>
  <!-- panel 1: just after deglaciation -->
  <text class="h" x="20" y="20">${L.p1}</text>
  <path class="wat" d="M60,120 L330,120 L330,150 C290,190 210,205 150,185 C110,170 85,150 60,128 Z"/>
  <path class="lnd" d="M20,108 L60,120 C85,150 110,170 150,185 C210,205 290,190 330,150 L360,128 L360,240 L20,240 Z"/>
  <path class="lndE" d="M20,108 L60,120 C85,150 110,170 150,185 C210,205 290,190 330,150 L360,128"/>
  <line class="ws" x1="60" y1="120" x2="330" y2="120"/>
  <text class="t" x="20" y="98">${L.outlet}</text>
  <text class="t" x="300" y="112">${L.se}</text>
  <!-- panel 2: today -->
  <text class="h" x="400" y="20">${L.p2}</text>
  <path class="wat" d="M440,120 L672,120 L652,138 L622,153 L590,161 L545,165 C505,166 470,150 440,128 Z"/>
  <path class="lnd" d="M400,108 L440,120 C470,150 505,166 545,165 C600,163 650,140 690,96 L740,80 L740,240 L400,240 Z"/>
  <path class="lndE" d="M400,108 L440,120 C470,150 505,166 545,165 C600,163 650,140 690,96 L740,80"/>
  <line class="ws" x1="440" y1="120" x2="672" y2="120"/>
  <line class="old" x1="440" y1="120" x2="712" y2="86"/>
  <text class="t" x="560" y="80">${L.oldshore}</text>
  <line class="up" x1="455" y1="226" x2="455" y2="206" marker-end="url(#ah)"/>
  <line class="up" x1="580" y1="232" x2="580" y2="192" marker-end="url(#ah)"/>
  <line class="up" x1="705" y1="236" x2="705" y2="170" marker-end="url(#ah)"/>
  <text class="t" x="466" y="224">${L.slow}</text>
  <text class="t" x="600" y="200">${L.fast}</text>
  <text class="t" x="400" y="98">${L.outlet}</text>
</svg>`;
const SCH = {
  en: { aria: "Schematic cross-section of a tilting lake", p1: "Just after the ice melted", p2: "Today", outlet: "outlet (NW)", se: "SE", oldshore: "old shoreline, now tilted", slow: "less uplift", fast: "more uplift" },
  no: { aria: "Skjematisk tverrsnitt av et vatn som tipper", p1: "Like etter at isen smeltet", p2: "I dag", outlet: "utløp (NV)", se: "SØ", oldshore: "gammel strandlinje, nå skjev", slow: "mindre heving", fast: "mer heving" },
};
export function aboutHtml(lang, meta, model) {
  const no = lang === "no";
  const nb = (v, d = 0) => Number(v).toLocaleString(no ? "nb-NO" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const se = meta.se_ref ? [meta.se_ref.x, meta.se_ref.y] : [692140, 7607020];
  const drSE = model.dr(se[0], se[1]);
  const drCol = meta.se_col ? model.dr(meta.se_col.x, meta.se_col.y) : NaN;
  const tilt10k = drSE * model.F(10000) / 1000;
  const ev = model.events();
  const tAtl = ev.find((e) => e.key === "ev_to_atl")?.t;
  const tAtlTxt = tAtl ? nb(Math.round(tAtl / 10) * 10) : "–";
  const params = `τ = ${nb(model.tau)} ${no ? "år" : "yr"}, k = ${nb(model.k, 2)}`;
  const area0 = nb(model.stats(0, 0).area);
  const formula = `F(t) = k·τ·(e<sup>(t−t₀)/τ</sup> − e<sup>(t<sub>${no ? "nå" : "now"}</sub>−t₀)/τ</sup>)`;
  const refs = no ? [
    ["Terreng", "Kartverket DTM via Geonorge WCS (CC BY 4.0)"],
    ["Dybdekart, innsjøer", "NVE Innsjødatabase, dybdekart dk2396 (1959), kun ikke-kommersiell bruk"],
    ["Landheving", "NKG2016LU, Vestøl mfl. 2019, J. Geodesy 93:1759"],
    ["Reguleringshistorikk", "Devik 1959 (NVE); OED 2022, revisjon av konsesjonsvilkår; Statkraft 2009"],
    ["Kvartærgeologi", "Bargel 1984, NGU Skrifter 52; Andersen 1968, NGU 256"],
    ["Kalibrering", "Ploeg &amp; Stroeven 2025, The Cryosphere 19:347; Eilertsen mfl. 2005, Boreas 34:233; Påsse &amp; Daniels 2015, SGU RM 137"],
    ["Isavsmelting", "Stroeven mfl. 2016, QSR 147:91; Hughes mfl. 2016 (DATED-1)"],
    ["Kart", "© Kartverket (CC BY 4.0); flyfoto © Norge i bilder (bare visning på nett)"],
  ] : [
    ["Terrain", "Kartverket DTM via Geonorge WCS (CC BY 4.0)"],
    ["Bathymetry, lakes", "NVE Innsjødatabase, dybdekart dk2396 (1959), non-commercial use"],
    ["Land uplift", "NKG2016LU, Vestøl et al. 2019, J. Geodesy 93:1759"],
    ["Regulation history", "Devik 1959 (NVE); OED 2022 concession revision; Statkraft 2009"],
    ["Quaternary geology", "Bargel 1984, NGU Skrifter 52; Andersen 1968, NGU 256"],
    ["Calibration", "Ploeg &amp; Stroeven 2025, The Cryosphere 19:347; Eilertsen et al. 2005, Boreas 34:233; Påsse &amp; Daniels 2015, SGU RM 137"],
    ["Deglaciation", "Stroeven et al. 2016, QSR 147:91; Hughes et al. 2016 (DATED-1)"],
    ["Maps", "© Kartverket (CC BY 4.0); aerial photos © Norge i bilder (online view only)"],
  ];
  const table = `<table>${refs.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join("")}</table>`;
  if (no) return `
<h3 id="about-h">Om modellen</h3>
${SCHEMATIC(SCH.no)}
<p>Visningen viser hvordan Altevatnet har <b>tippet</b> siden isen forsvant, fordi landet hever seg ulikt: SØ-enden, nærmere sentrum av den tidligere innlandsisen, stiger raskere enn utløpet i NV. En vannflate er alltid vannrett (en ekvipotensialflate). Målt mot dagens terreng ser gamle vannflater derfor ut til å stige mot SØ.</p>
<h2>Landhevingsmodell</h2>
<p><code>U(x,y,t) = r(x,y) · F(t)</code>, der <code>r</code> er dagens landheving i forhold til geoiden (NKG2016LU_lev, ${nb(model.rRef, 2)} mm/år ved utløpet og ${nb(model.rRef + drSE, 2)} mm/år i SØ-enden), og <code>${formula}</code> med t₀ = 2000 (NKG-epoken); nå ${params}. τ = 5000 år er kalibrert mot strandlinjene til de bredemte sjøene i Torneträsk (0,5–0,7 m/km; Ploeg &amp; Stroeven 2025) og marin grense i Målselv (80 m, ≈ 10 400 år; Eilertsen mfl. 2005). Bare forskjellen i landheving tipper vatnet: ${nb(drSE, 3)} mm/år mellom utløpet og SØ-enden i dag, ${nb(drCol, 3)} mm/år til skaret mot Torneträsk.</p>
<h2>Det naturlige vatnet</h2>
<p>Naturlig vannstand er 475,8 m i NVEs lokale høydesystem (Devik 1959; manøvreringsreglementet 1969), ≈ 475,95 m NN2000. Bunnen er fra NVEs ekkolodding i 1959 ved 477,0 m (bak en midlertidig dam), interpolert fra 5 m-koter. Land som magasinet (HRV 489 m) har satt under vann, er rekonstruert ved interpolasjon mellom 1959-strandlinja og terrenget rundt. Leinavatnet har ingen dybdedata og vises med 1 m dybde.</p>
<h2>Utløp og avløp</h2>
<p>For hver verdi av F fylles bassenget til det renner over laveste skar (prioritetsflom på et 40 m-rutenett). Utløpsbytter følger derfor av modellen selv. Med disse parameterne renner vatnet mot SØ, via Leinavatnet, fram til ≈ ${tAtlTxt} kal. BP. Det krever at SØ-enden var isfri (≈ 10 200 BP). For at vannet skal nå Østersjøen, må også de bredemte sjøene i Torneträsk-bassenget være borte (≈ 9 900 BP). Med om lag 20 % mindre tipping (k under ≈ 0,8) renner vatnet aldri mot SØ.</p>
<h2>Usikkerhet</h2>
<ul>
<li>Tippingen for 10 000 år siden er ${nb(tilt10k)} m med disse parameterne (kalibrert ≈ 17 m, mulig spenn ≈ 11–21 m). Modellen kan overdrive landhevingen i tidlig holocen med opptil ≈ 30 %. Bruk «skalering av landhevingen (k)» til å teste dette.</li>
<li>Terskelhøyden ved utløpet er ikke målt. Den naturlige vannstanden er en sommervannstand.</li>
<li>Skaret i SØ ligger ved et lite vatn som har høyden 500,0 m i den grovere svenske delen av terrengmodellen. Det virkelige vannskillet kan avvike med en meter eller to, som flytter utløpsbyttet med ≈ 60 år per meter.</li>
<li>Ved dagens naturlige vannstand dekker modellvatnet ${area0} km²; Devik (1959) oppgir om lag 53 km². Forskjellen ligger mest i de rekonstruerte deltaflatene i SØ.</li>
<li>Loddingen i 1959 ble gjort etter at utløpet og Straumen ble mudret i 1951–54, så sundet mellom bassengene er dypere i modellen enn det var naturlig.</li>
<li>Modellens gamle strandlinjer i SØ (476–489 m) ligger i dagens reguleringssone, så spor i terrenget der er satt under vann eller omarbeidet.</li>
<li>Den separable modellen antar at dagens mønster i landhevingen har ligget fast gjennom holocen.</li>
<li>Bredemte sjøer og isrester i isavsmeltingsfasen er ikke modellert.</li>
</ul>
<h2>Data og referanser</h2>
${table}
<p class="fine">3D: three.js r185. Prosesseringsskriptene ligger i <code>tools/</code> (Python).</p>`;
  return `
<h3 id="about-h">About the model</h3>
${SCHEMATIC(SCH.en)}
<p>The view shows how Altevatnet has <b>tilted</b> since the ice sheet melted. The land rises unevenly: the SE end, closer to the centre of the former Scandinavian ice sheet, rises faster than the outlet in the NW. A lake surface is always level (an equipotential surface). Seen against today’s terrain, old water surfaces therefore appear to rise towards the SE.</p>
<h2>Uplift model</h2>
<p>The model is <code>U(x,y,t) = r(x,y) · F(t)</code>.</p>
<ul>
<li><code>r</code> is today’s land uplift relative to the geoid (NKG2016LU_lev): ${nb(model.rRef, 2)} mm/yr at the outlet and ${nb(model.rRef + drSE, 2)} mm/yr at the SE end.</li>
<li><code>${formula}</code> with t₀ = 2000 (the NKG epoch); currently ${params}.</li>
<li>τ = 5000 yr is calibrated on the tilted shorelines of the Torneträsk ice-dammed lakes (0.5–0.7 m/km; Ploeg &amp; Stroeven 2025) and the Målselv marine limit (80 m at about 10 400 yr; Eilertsen et al. 2005).</li>
</ul>
<p>Only differential uplift tilts the lake: today ${nb(drSE, 3)} mm/yr between the outlet and the SE end, and ${nb(drCol, 3)} mm/yr to the col towards Torneträsk.</p>
<h2>The natural lake</h2>
<ul>
<li><b>Level:</b> the natural level is 475.8 m in NVE’s local datum (Devik 1959; 1969 manoeuvring rules), about 475.95 m NN2000.</li>
<li><b>Lake floor:</b> NVE echo-sounded the lake in 1959 at 477.0 m, behind a temporary dam. The bed is interpolated from the 5 m contours.</li>
<li><b>Flooded land:</b> land drowned by the reservoir (HRV 489 m) is reconstructed by interpolating between the 1959 shoreline and the surrounding terrain.</li>
<li><b>Leinavatnet:</b> there are no depth data, so it is shown 1 m deep.</li>
</ul>
<h2>Outlet and drainage</h2>
<p>For every value of F, the basin is filled until it spills over its lowest col (a priority flood on a 40 m grid). Outlet switches therefore come out of the model itself. With these parameters the lake spills SE, via Leinavatnet, until ≈ ${tAtlTxt} cal BP. This requires the SE end to be ice-free (≈ 10 200 BP). For the water to reach the Baltic, the ice-dammed lakes in the Torneträsk basin must also be gone (≈ 9 900 BP). With about 20 % less tilt (k below ≈ 0.8) the lake never drains SE.</p>
<h2>Uncertainties</h2>
<ul>
<li>The tilt 10 000 years ago is ${nb(tilt10k)} m with these parameters (calibrated ≈ 17 m, plausible range about 11–21 m). The model may overstate early-Holocene uplift by up to about 30%; test this with the “uplift scale k”.</li>
<li>The height of the outlet threshold has not been measured. The natural level is a summer level.</li>
<li>The SE col is at a small lake given as exactly 500.0 m in the coarser Swedish part of the terrain model. The true divide may differ by a metre or two, which moves the outlet switch by about 60 years per metre.</li>
<li>At today’s natural level the modelled lake covers ${area0} km²; Devik (1959) gave about 53 km². The difference lies mostly in the reconstructed SE delta flats.</li>
<li>The 1959 soundings post-date the 1951–54 dredging of the outlet and Straumen, so the strait between the basins is deeper in the model than it was naturally.</li>
<li>The model’s palaeo-shorelines in the SE (476–489 m) lie within today’s regulation zone, so field evidence there is drowned or reworked.</li>
<li>The separable model assumes today’s spatial pattern of uplift held through the Holocene.</li>
<li>Ice-dammed lakes and remnant ice during deglaciation are not modelled.</li>
</ul>
<h2>Data and references</h2>
${table}
<p class="fine">3D: three.js r185. Processing scripts are in <code>tools/</code> (Python).</p>`;
}
