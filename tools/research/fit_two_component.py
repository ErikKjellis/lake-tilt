"""Sensitivity: two-component exponential F(t)=a*t1*(e^{t/t1}-1)+(1-a)*t2*(e^{t/t2}-1) (F'(0)=1) fitted to C1,C2,C5.
Usage (from tools/): python fit_two_component.py <project_dir>
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy.optimize import minimize

proj = Path(sys.argv[1])
m = json.loads((proj / "data/processed/uplift_time_model.json").read_text())
cons = [c for c in m["constraints"] if c["id"].startswith(("C1", "C2", "C5"))]
def F2(t, a, t1, t2):
    t = np.asarray(t, float)
    return a * t1 * (np.exp(t / t1) - 1) + (1 - a) * t2 * (np.exp(t / t2) - 1)
def chi(p):
    a, t1, t2 = p
    if not (0 <= a <= 0.5 and 800 <= t1 <= 4000 and 4000 <= t2 <= 40000): return 1e9
    return sum(((F2(c["t"], a, t1, t2) - c["F"]) / c["sF"]) ** 2 for c in cons)
best = None
for a0 in (0.02, 0.05, 0.1):
    for t10 in (1200, 1800, 2500):
        for t20 in (6000, 9000, 15000):
            r = minimize(chi, [a0, t10, t20], method="Nelder-Mead", options=dict(xatol=1e-4, fatol=1e-6, maxiter=4000))
            if best is None or r.fun < best.fun: best = r
a, t1, t2 = best.x
print(f"two-component fit: a={a:.4f} tau1={t1:.0f} tau2={t2:.0f} chi2={best.fun:.2f} (n={len(cons)})")
tau = m["tau_years"]
exp = lambda t: tau * (np.exp(t / tau) - 1)
print("chi2 exp(tau=%d) on same set:" % tau, round(sum(((exp(c['t']) - c['F']) / c['sF']) ** 2 for c in cons), 2))
for c in m["constraints"]:
    print(f"  {c['id'][:50]:50s} obs {c['F']/1e3:6.1f}+-{c['sF']/1e3:4.1f}  2comp {F2(c['t'],a,t1,t2)/1e3:6.1f}  exp {exp(c['t'])/1e3:6.1f}")
for t in (10500, 10300, 10000, 9000, 8000, 7000, 6000, 4000, 2000, 1000, 0, -1000):
    print(t, round(float(F2(t, a, t1, t2))), round(float(exp(t))))
m["two_component_sensitivity"] = dict(formula="F=a*tau1*(exp(t/tau1)-1)+(1-a)*tau2*(exp(t/tau2)-1)", a=round(a, 4),
                                      tau1=round(t1), tau2=round(t2), chi2=round(best.fun, 2), fitted_to="C1,C2,C5")
for row in m["F_table"]:
    row["F_two_component"] = round(float(F2(row["t_bp"], a, t1, t2)), 1)
for row in m["tilt_table"]:
    row["F_two_component"] = round(float(F2(row["t_bp"], a, t1, t2)), 1)
(proj / "data/processed/uplift_time_model.json").write_text(json.dumps(m, indent=1), encoding="utf-8")
