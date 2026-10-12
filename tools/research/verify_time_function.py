"""Adversarial re-check of the uplift time function F(t), its calibration and the Altevatn tilt table.
Independent of time_function.py (rates re-sampled with verify_uplift.py logic, values hard-coded from that run).

Usage: python -I tools/verify_time_function.py "<project_dir>"
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import minimize_scalar

proj = Path(sys.argv[1])
m = json.loads((proj / "data/processed/uplift_time_model.json").read_text(encoding="utf-8"))

# rates from verify_uplift.py (NKG2016LU_lev, bilinear in ETRS89 lat/lon)
r_nw, r_se, L = 4.2961, 4.8655, 40.954         # task NW/SE points, mm/yr, km
dr = r_se - r_nw
g_alt_axis = dr / L                             # 0.01390 mm/yr/km along the lake axis
g_alt_max = 0.01837
g_torn_325 = 0.01781                            # Tornetrask component along 145/325 deg
g_ulls, g_mal, g_lof = 0.01748, 0.02069, 0.02273
r_malselv = 3.711

F = lambda t, tau=5000.0: tau * (np.exp(np.asarray(t, float) / tau) - 1.0)

# ---- 1. F table / tilt table reproduction
bad = 0
for row in m["F_table"]:
    if abs(F(row["t_bp"]) - row["F_years"]) > 1.0:
        bad += 1
        print("F mismatch", row["t_bp"], row["F_years"], float(F(row["t_bp"])))
print("F_table rows checked:", len(m["F_table"]), "mismatches >1 yr:", bad)
print("\n t_bp   F(yr)   dU(m)  m/km(axis)  m/km(max grad)   rate NW (mm/yr)")
for t in (10500, 10300, 10000, 9000, 8000, 7000, 6000, 4000, 2000, 1000, 0, -500, -1000, -2000, -3000):
    f = float(F(t))
    print(f"{t:6d} {f:8.0f} {dr * f / 1000:7.2f} {dr * f / 1000 / L:8.4f} {g_alt_max * f / 1000:10.4f} {r_nw * math.exp(t / 5000):10.1f}")


# ---- 2. eustasy, Passe & Daniels 2015 formulas 4 + 5 (read from rendered PDF page 14)
def E_main(t):
    return (-(2 / math.pi) * 29 * (math.atan(9200 / 1300) - math.atan((9200 - t) / 1300))
            - (2 / math.pi) * 36 * (math.atan(13700 / 1350) - math.atan((13700 - t) / 1350)))


def osc(t, literal=False):
    ex = -0.5 * ((t - 12000) ** 2 / 5300) if literal else -0.5 * ((t - 12000) / 5300) ** 2
    return -1.5 * math.exp(ex) * math.sin((t - 310) * 0.01) + 0.01


for t in (9900, 10000, 10200, 10300, 10400, 10600):
    print(f"E({t}) main {E_main(t):6.1f}  +osc(gauss) {E_main(t) + osc(t):6.1f}  +osc(literal) {E_main(t) + osc(t, True):6.1f}")

# ---- 3. constraints
C1 = dict(t=10000, F=0.6 / (g_torn_325 * 1e-3), sF=0.1 / (g_torn_325 * 1e-3))
U2 = 80 - (E_main(10400) + osc(10400))
F2 = U2 / (r_malselv * 1e-3); sF2 = F2 * math.hypot(math.hypot(3, 6) / U2, 0.25 / r_malselv)
C2 = dict(t=10400, F=F2, sF=sF2)
print(f"\nC1: F(10.0 ka) = {C1['F']:.0f} +- {C1['sF']:.0f}")
print(f"C2: U = {U2:.1f} m, F(10.4 ka) = {F2:.0f} +- {sF2:.0f}")


def fit(cons):
    chi = lambda tau: sum(((F(c["t"], tau) - c["F"]) / c["sF"]) ** 2 for c in cons)
    r = minimize_scalar(chi, bounds=(2000, 15000), method="bounded")
    taus = np.linspace(2000, 15000, 13001)
    ch = np.array([chi(x) for x in taus]); ok = taus[ch <= r.fun + 1]
    return r.x, r.fun, ok.min(), ok.max()


for nm, cons in (("C1+C2", [C1, C2]), ("C1 only", [C1]), ("C2 only", [C2])):
    tb, c2, lo, hi = fit(cons)
    print(f"  fit {nm:8s}: tau {tb:6.0f} (1s {lo:.0f}-{hi:.0f}) chi2 {c2:.2f}")

# sensitivity of C1 to stage ages and gradient (T1 0.7 @ 10.1 ka, T8 0.5 @ 9.9 ka)
for G, t in ((0.7, 10100), (0.6, 10000), (0.5, 9900), (0.6, 9900)):
    Fobs = G / (g_torn_325 * 1e-3)
    tau = minimize_scalar(lambda x: (F(t, x) - Fobs) ** 2, bounds=(2000, 20000), method="bounded").x
    print(f"  Tornetrask {G} m/km at {t}: F={Fobs:.0f}, implied tau {tau:.0f}")

# implied rate of gradient change between T1 and T8 (<= 200 yr apart)
print(f"  T1->T8 gradient drop 0.2 m/km in <=200 yr => {0.2 / 200 * 1e3:.2f} mm/yr/km; "
      f"exp model d(grad)/dt at 10 ka = {g_torn_325 * math.exp(2):.3f} mm/yr/km "
      f"(=> {g_torn_325 * math.exp(2) * 200 / 1000:.3f} m/km change in 200 yr)")

# ---- 4. ratio (eustasy-free) estimate of Altevatn along-axis tilt from Tornetrask
for G in (0.5, 0.6, 0.7):
    tilt = G * g_alt_axis / g_torn_325
    print(f"  ratio method: Tornetrask {G} -> Altevatn axis {tilt:.3f} m/km = {tilt * L:.1f} m over {L:.1f} km")

# ---- 5. secondary checks
print("\nSecondary gradient checks (implied F vs model):")
checks = [("YD Main, Ullsfjord 0.90", 0.90 / (g_ulls * 1e-3), (12000, 12300)),
          ("YD Main, Malangen 1.00", 1.00 / (g_mal * 1e-3), (12000, 12300)),
          ("Lofoten 0.25 at transgression max", 0.25 / (g_lof * 1e-3), (7000, 6000)),
          ("Lofoten 0.07 'after' max", 0.07 / (g_lof * 1e-3), (3000, 2000)),
          ("Troms Tapes 0.2 (Helland)", 0.2 / (0.019e-3), (7000, 6000)),
          ("Troms Tapes 0.5 (Helland)", 0.5 / (0.019e-3), (7000, 6000))]
for nm, Fo, ts in checks:
    print(f"  {nm:36s} implied F {Fo / 1e3:5.1f} kyr | model at {ts[0]}: {F(ts[0]) / 1e3:5.1f}, at {ts[1]}: {F(ts[1]) / 1e3:5.1f}")

# total uplift since deglaciation, NW and SE
for t in (10300, 10000):
    print(f"  uplift since {t}: NW {r_nw * F(t) / 1000:.0f} m, SE {r_se * F(t) / 1000:.0f} m; "
          f"rate then NW {r_nw * math.exp(t / 5000):.0f} mm/yr")


# Passe & Daniels Table 1 Narvik (A=124, T=10700, Be=1200, Bv=19A+5000) forward marine-limit check
def U_passe(t, A, T, Be=1200.0):
    Bv = 19 * A + 5000
    return (2 / math.pi) * A * (math.atan(T / Bv) - math.atan((T - t) / Bv) + math.atan(T / Be) - math.atan((T - t) / Be))


for t in (10400, 10800):
    print(f"  Passe Narvik params: U({t}) = {U_passe(t, 124, 10700):.0f} m -> ML {U_passe(t, 124, 10700) + E_main(t) + osc(t):.0f} m "
          f"(observed Narvik/Bjerkvik ML ~86-92 m); exp model with r=3.99: {3.99 * F(t) / 1000 + E_main(t) + osc(t):.0f} m")
