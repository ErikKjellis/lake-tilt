"""Calibrate the uplift time function F(t) [years] for Altevatnet, U(x,y,t) = r(x,y) * F(t),
where r = present NKG2016LU_lev rate and t = years BP (t<0 = future).  Writes
data/processed/uplift_time_model.json.

Usage (from tools/): python time_function.py <project_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import brentq, minimize_scalar

from nkg_lib import load

proj = Path(sys.argv[1])
s_xy, _ = load(proj, "lev")
r = lambda x, y: float(s_xy(np.array([x]), np.array([y]))[0])

# ------------------------------------------------------------------ geometry / rates
NW = (657701.19, 7621216.70)       # Barduelva outlet = Altevatn dam (NVE damnr 1015 at 657679, 7621227)
SE = (696701.64, 7608715.57)
L_km = np.hypot(SE[0] - NW[0], SE[1] - NW[1]) / 1000
r_nw, r_se = r(*NW), r(*SE)
r_c = r(679107.0, 7612800.5)
dr = r_se - r_nw
grid = json.loads((proj / "data/processed/uplift_rate_grid.json").read_text())
g_max = grid["plane_fit_lev"]["grad_mag_mm_yr_per_km"]

# ------------------------------------------------------------------ eustasy (Passe & Daniels 2015, formula 4+5)
def E_passe(t):
    t = np.asarray(t, float)
    e = -(2 / np.pi) * 29 * (np.arctan(9200 / 1300) - np.arctan((9200 - t) / 1300)) \
        - (2 / np.pi) * 36 * (np.arctan(13700 / 1350) - np.arctan((13700 - t) / 1350))
    osc = -1.5 * np.exp(-0.5 * ((t - 12000) / 5300) ** 2) * np.sin((t - 310) * 0.01) + 0.01
    return e + osc


# ------------------------------------------------------------------ candidate time functions
def F_exp(t, tau):
    t = np.asarray(t, float)
    return tau * (np.exp(t / tau) - 1.0)


def passe_terms(t, A, T, Be=1200.0):
    Bv = 19 * A + 5000
    t = np.asarray(t, float)
    U = (2 / np.pi) * A * (np.arctan(T / Bv) - np.arctan((T - t) / Bv) + np.arctan(T / Be) - np.arctan((T - t) / Be))
    rate = (2 / np.pi) * A * (Bv / (Bv ** 2 + T ** 2) + Be / (Be ** 2 + T ** 2))  # m/yr at t=0
    return U, rate


def passe_A_for_rate(rate_mm, T, Be=1200.0):
    return brentq(lambda A: passe_terms(0.0, A, T, Be)[1] * 1000 - rate_mm, 1, 600)


def F_passe(t, rate_mm, T, Be=1200.0):
    A = passe_A_for_rate(rate_mm, T, Be)
    U, rate = passe_terms(t, A, T, Be)
    return U / rate, A


# ------------------------------------------------------------------ calibration constraints (F in years)
cons = []
# C1: Tornetrask ice-dammed-lake shorelines (Ploeg & Stroeven 2024): 0.5-0.7 m/km toward 325 deg, age 10.1-9.9 ka
g_torn = 0.01781e-3  # m/yr/km, NKG2016LU_lev gradient component along 145 deg true over the Tornetrask basin
cons.append(dict(id="C1 Tornetrask ice-dammed lake shorelines", t=10000, F=0.6 / g_torn, sF=0.1 / g_torn,
                 kind="gradient ratio (eustasy-free)", use=True))
# C2: Malselv marine limit 80 m (Eilertsen et al. 2005, NGU MG point), deglaciated ~9.2 14C ka ~ 10.4 cal ka
t2 = 10400; r2 = r(660993, 7659967)
U2 = 80 - float(E_passe(t2)); sU2 = np.hypot(np.hypot(3, 6), 0.0)  # ML +-3 m, eustasy +-6 m
F2 = U2 / (r2 / 1000); sF2 = F2 * np.hypot(sU2 / U2, 0.25 / r2)
cons.append(dict(id="C2 Malselv marine limit 80 m", t=t2, F=F2, sF=sF2, kind="absolute (ML - eustasy)", use=True,
                 note=f"r={r2:.2f} mm/yr, E={float(E_passe(t2)):.1f} m, U={U2:.0f} m"))
# C3: Ovre Salangen marine limit 83 m (Sveian 2011, NGU), age assumed 10.6+-0.3 ka (not dated here)
t3 = 10600; r3 = r(628079, 7638335); U3 = 83 - float(E_passe(t3))
cons.append(dict(id="C3 Ovre Salangen marine limit 83 m (age assumed)", t=t3, F=U3 / (r3 / 1000),
                 sF=U3 / (r3 / 1000) * 0.15, kind="absolute", use=False, note=f"r={r3:.2f}, U={U3:.0f} m"))
# C4: Troms Main (Younger Dryas) shoreline 0.9-1.1 m/km (Andersen 1968), ~12.0 ka; NKG gradient Malangen-Ullsfjord ~0.019
cons.append(dict(id="C4 Troms Main shoreline (YD) 0.9-1.1 m/km", t=12000, F=1.0 / 0.019e-3, sF=0.15 / 0.019e-3,
                 kind="gradient ratio, coastal, pre-dates Altevatn deglaciation", use=False))
# C5: Lofoten-Vesteralen isobase gradients (Balascio et al. 2024) 0.25/0.14/0.07 m/km at 7/5/3 ka; NKG grad 0.0227
for t, G in ((7000, 0.25), (5000, 0.14), (3000, 0.07)):
    cons.append(dict(id=f"C5 Lofoten-Vesteralen gradient {G} m/km", t=t, F=G / 0.0227e-3, sF=0.3 * G / 0.0227e-3,
                     kind="gradient ratio, outer coast", use=False))

# ------------------------------------------------------------------ fit exponential tau to primary constraints
prim = [c for c in cons if c["use"]]
def chi2(tau):
    return sum(((F_exp(c["t"], tau) - c["F"]) / c["sF"]) ** 2 for c in prim)
res = minimize_scalar(chi2, bounds=(2000, 12000), method="bounded")
tau_best = float(res.x)
# 1-sigma range: chi2 <= min+1
taus = np.linspace(2500, 9000, 6501)
ch = np.array([chi2(t) for t in taus])
ok = taus[ch <= ch.min() + 1]
tau_lo, tau_hi = float(ok.min()), float(ok.max())
TAU = round(tau_best / 100) * 100
print(f"exp fit: tau_best={tau_best:.0f} (1 sigma {tau_lo:.0f}-{tau_hi:.0f}); adopted tau={TAU}; chi2={res.fun:.2f}")

# Passe variant for the lake centre (rate r_c) with T = 10500 (approx time of local max uplift rate)
T_P = 10500.0
Fp = lambda t: F_passe(t, r_c, T_P)[0]
A_c = F_passe(0, r_c, T_P)[1]
print(f"Passe variant: A={A_c:.1f} m, Bv={19*A_c+5000:.0f} yr, T={T_P:.0f}, Be=1200")

print("\nConstraint check (F in kyr):  obs +- s | exp(tau) | Passe(T=10.5ka)")
for c in cons:
    c["F_exp"] = float(F_exp(c["t"], TAU)); c["F_passe"] = float(Fp(c["t"]))
    print(f"  {c['id'][:52]:52s} t={c['t']:6d} {c['F']/1e3:6.1f} +- {c['sF']/1e3:4.1f} | {c['F_exp']/1e3:6.1f} | {c['F_passe']/1e3:6.1f}")

# Marine-limit forward check: predicted ML elevation at Malselv/Salangen/Storfjord with each F
print("\nForward check of marine limits (m a.s.l.): S = r*F(t) + E(t)")
for nm, (x, y), t, obs in (("Malselv", (660993, 7659967), 10400, 80), ("Ovre Salangen", (628079, 7638335), 10600, 83),
                           ("Storfjord (Corner 1980)", (702093, 7677400), 10500, 96),
                           ("Bjerkvik/Narvik", (606554, 7606784), 10800, 90)):
    rr = r(x, y) / 1000
    print(f"  {nm:24s} obs {obs:4d}  exp {rr*F_exp(t, TAU)+E_passe(t):6.1f}  Passe-shape {rr*Fp(t)+E_passe(t):6.1f}   (t={t})")

# ------------------------------------------------------------------ tables
def tilt_row(t, F):
    dU = dr / 1000 * F
    return dict(t_bp=int(t), F_years=round(float(F), 1), diff_uplift_SE_minus_NW_m=round(float(dU), 3),
                tilt_m_per_km=round(float(dU / L_km), 5),
                max_tilt_m_per_km=round(float(g_max / 1000 * F), 5),
                uplift_NW_m=round(float(r_nw / 1000 * F), 2), uplift_SE_m=round(float(r_se / 1000 * F), 2))

T_DEGLAC = 10300
t_list = [10500, 10000, 9000, 8000, 7000, 6000, 4000, 2000, 1000, 0, -500, -1000, -2000, -3000]
tilt_table = [tilt_row(t, F_exp(t, TAU)) | dict(F_lo=round(float(F_exp(t, tau_lo)), 1), F_hi=round(float(F_exp(t, tau_hi)), 1),
              F_passe=round(float(Fp(t)), 1)) for t in t_list]
F_table = [dict(t_bp=int(t), F_years=round(float(F_exp(t, TAU)), 1), F_lo=round(float(F_exp(t, tau_lo)), 1),
                F_hi=round(float(F_exp(t, tau_hi)), 1), F_passe=round(float(Fp(t)), 1))
           for t in list(range(10500, -1, -250)) + [-250, -500, -750, -1000, -1500, -2000, -3000]]

print(f"\nL={L_km:.2f} km, r_nw={r_nw:.3f}, r_se={r_se:.3f}, dr={dr:.3f} mm/yr, g_max={g_max:.5f} mm/yr/km")
print(" t_bp     F     dU(m)  tilt(m/km)  [F_lo-F_hi]   F_passe")
for row in tilt_table:
    print(f"{row['t_bp']:6d} {row['F_years']:8.0f} {row['diff_uplift_SE_minus_NW_m']:7.2f} {row['tilt_m_per_km']:8.4f}"
          f"   [{row['F_lo']:7.0f}-{row['F_hi']:7.0f}] {row['F_passe']:8.0f}")

out = dict(
    form="exponential relaxation (separable): U(x,y,t) = r(x,y) * F(t), F(t) = tau*(exp(t/tau)-1), t in years BP (t<0 future)",
    tau_years=TAU, tau_fit=round(tau_best), tau_1sigma=[round(tau_lo), round(tau_hi)],
    rate_model="NKG2016LU_lev (data/processed/uplift_rate_grid.json 'values')",
    deglaciation_cal_bp=dict(best=T_DEGLAC, min=9900, max=10700),
    lake=dict(NW_outlet_xy=NW, SE_end_xy=SE, length_km=round(L_km, 3), r_nw_mm_yr=round(r_nw, 4), r_se_mm_yr=round(r_se, 4),
              dr_mm_yr=round(dr, 4), grad_max_mm_yr_per_km=g_max),
    passe_variant=dict(formula="U=(2/pi)A[atan(T/Bv)-atan((T-t)/Bv)+atan(T/Be)-atan((T-t)/Be)], Bv=19A+5000 (Passe & Daniels 2015)",
                       A_m=round(A_c, 1), T=T_P, Be=1200.0, Bv=round(19 * A_c + 5000), note="F_passe = U(t)/U'(0); same r scaling"),
    eustasy="Passe & Daniels (2015) formulas 4-5",
    constraints=cons, tilt_table=tilt_table, F_table=F_table,
)
(proj / "data/processed/uplift_time_model.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
print("wrote data/processed/uplift_time_model.json")
