"""Summarise a paleolakes.py run: spill-point history in calendar years and a map of palaeo-lakes.

Usage: python -I tools/research/lake_screening/summarise_paleolakes.py CONFIG.json [OUT.png]
Time function as in the Altevatnet viewer: F(t) = tau (exp(t/tau) - 1), tau = 5000 yr, t in yr BP.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
TAU = 5000.0
t_of_F = lambda F: TAU * math.log1p(F / TAU) if F > -TAU else float("nan")
F_of_t = lambda t: TAU * math.expm1(t / TAU)


def main():
    cfg = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    res = json.loads((ROOT / "data" / "processed" / f"{cfg['lake']}_paleolakes.json").read_text())
    Fs = np.array(res["F"])
    names = [L["name"] for L in res["lakes"]]
    for li, L in enumerate(res["lakes"]):
        print(f"\n=== {L['name']} ===")
        prev = None
        for i, F in enumerate(Fs):
            s = L["stats"][i]
            key = (None if s["spill_x"] is None else (round(s["spill_x"] / 500), round(s["spill_y"] / 500)), tuple(s["merged_with"]))
            if key != prev or i == len(Fs) - 1:
                t = t_of_F(F)
                print(f"F={F:7.0f} (~{t:6.0f} BP)  level {L['S'][i]:7.2f}  area {s['area_km2']:6.1f} km2  "
                      f"spill ({s['spill_x']}, {s['spill_y']})  merged with {[names[m] for m in s['merged_with']]}")
                prev = key

    if len(sys.argv) > 2:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        d = np.load(ROOT / "data" / "processed" / f"{cfg['lake']}_paleolakes.npz")
        z = d["z"]
        ny, nx, cell, x0, y_top = res["ny"], res["nx"], res["cell"], res["x0"], res["y_top"]
        ext = [x0, x0 + nx * cell, y_top - ny * cell, y_top]
        ages = [0, 6000, 8000, 9000, 9500, 10000]
        fig, axs = plt.subplots(2, 3, figsize=(15, 10), constrained_layout=True)
        cols = ["tab:blue", "tab:orange", "tab:green", "tab:purple"]
        for ax, age in zip(axs.ravel(), ages):
            F = F_of_t(age)
            ax.imshow(z, extent=ext, cmap="Greys_r", vmin=250, vmax=1100)
            for li in range(len(res["lakes"])):
                wet = np.zeros(ny * nx, bool)
                idx, a, b = d[f"idx{li}"], d[f"a{li}"], d[f"b{li}"]
                wet[idx[(a <= F) & (F <= b)]] = True
                ov = np.zeros((ny, nx, 4))
                ov[wet.reshape(ny, nx)] = matplotlib.colors.to_rgba(cols[li], 0.55)
                ax.imshow(ov, extent=ext)
                i = int(np.argmin(np.abs(Fs - F)))
                s = res["lakes"][li]["stats"][i]
                if s["spill_x"] is not None:
                    ax.plot(s["spill_x"], s["spill_y"], "v", color=cols[li], mec="k", ms=10)
            ax.set_title(f"{age} cal BP (F = {F:.0f})")
            ax.set_xticks([]); ax.set_yticks([])
        handles = [plt.Line2D([], [], color=c, lw=8, alpha=0.55) for c in cols[:len(names)]]
        fig.legend(handles, names + [], loc="lower center", ncol=len(names))
        fig.suptitle(f"{cfg['name']}: palaeo-lakes (land fixed, water tilts); triangles = spill points")
        fig.savefig(sys.argv[2], dpi=110)
        print("wrote", sys.argv[2])


if __name__ == "__main__":
    main()
