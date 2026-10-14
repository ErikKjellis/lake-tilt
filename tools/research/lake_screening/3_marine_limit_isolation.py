import json, math, sys, csv
import numpy as np
from scipy.spatial import cKDTree
from scipy.optimize import brentq
from pyproj import Transformer
d=sys.argv[1]
mg=json.load(open(f"{d}/mgpkt.json",encoding="utf-8"))["features"]
tr=Transformer.from_crs("EPSG:4258","EPSG:25833",always_xy=True)
xy=[];hh=[]
for f in mg:
    h=f["properties"].get("høyde")
    if h is None: continue
    x,y=tr.transform(*f["geometry"]["coordinates"][:2]); xy.append((x,y)); hh.append(h)
xy=np.array(xy);hh=np.array(hh,float);kd=cKDTree(xy)
def E(t):
    e=-(2/np.pi)*29*(np.arctan(9200/1300)-np.arctan((9200-t)/1300))-(2/np.pi)*36*(np.arctan(13700/1350)-np.arctan((13700-t)/1350))
    return float(e-1.5*np.exp(-0.5*((t-12000)/5300)**2)*np.sin((t-310)*0.01)+0.01)
F=lambda t:5000*(math.exp(t/5000)-1)
rows=json.load(open(f"{d}/ranking.json",encoding="utf-8"))
T=Transformer.from_crs("EPSG:4258","EPSG:25833",always_xy=True)
TDEG=10300
for x in rows:
    X,Y=T.transform(x["lon"],x["lat"])
    dist,ii=kd.query((X,Y),k=6)
    w=1/np.maximum(dist,1000)**2; ml=float((w*hh[ii]).sum()/w.sum())
    x["ml_m"]=round(ml); x["ml_nearest_km"]=round(float(dist[0])/1000,1)
    h=x["hoyde"] or 0; r=(x["r_min"]+x["r_max"])/2
    x["submarine"]=h<ml
    if h<ml:
        s=(ml-E(TDEG))/(r*F(TDEG)/1000)
        g=lambda t:s*r*F(t)/1000+E(t)-h
        t=brentq(g,0,TDEG) if g(0)<0 else 0
        x["iso_bp"]=int(round(t,-2)); x["tilt_hist_m"]=round(x["dr"]*s*F(t)/1000,1)
    else:
        x["iso_bp"]=None; x["tilt_hist_m"]=round(x["dr"]*F(TDEG)/1000,1)
json.dump(rows,open(f"{d}/ranking.json","w",encoding="utf-8"),ensure_ascii=False)
with open(f"{d}/ranking.csv","w",newline="",encoding="utf-8") as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
sel=[x for x in rows if x["dr"]>=0.15]; sel.sort(key=lambda x:-x["tilt_hist_m"])
for x in sel[:60]:
    print(f"{x['navn'][:22]:22} {x['vatnlnr']:6} h={x['hoyde']:5} ML={x['ml_m']:4}({x['ml_nearest_km']}) A={x['areal_km2']:6} dr={x['dr']:.2f} L={x['len_km']:5} al={x['align']} iso={x['iso_bp']} hist={x['tilt_hist_m']:5} B={'Y' if x['bathy'] else '-'} dmax={x['maksdyp']} {x['oppmaltaar']} reg={int(x['regulert'])} {x['grense']} {x['kommune']}")
print("--- submarine with dr>=0.3")
for x in rows:
    if x["submarine"] and x["dr"]>=0.3: print(x["navn"],x["hoyde"],x["ml_m"],x["dr"],x["iso_bp"],x["tilt_hist_m"])
