"""Plot a crop of a .npy/.json DEM with contours and the lake outlines.
Usage: python -I tools/plot_crop.py BASE X0 X1 Y0 Y1 VMIN VMAX CINT OUT.png"""
import json, sys, numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from shapely.geometry import shape
base=sys.argv[1]; X0,X1,Y0,Y1=(float(v) for v in sys.argv[2:6]); vmin,vmax,ci=(float(v) for v in sys.argv[6:9]); out=sys.argv[9]
a=np.load(base+".npy"); m=json.load(open(base+".json"))
x0,y0,d=m["x0"],m["y0"],m["dx"]
c0=int((X0-x0)/d); c1=int((X1-x0)/d); r0=int((y0-Y1)/d); r1=int((y0-Y0)/d)
s=a[r0:r1,c0:c1]
fig,ax=plt.subplots(figsize=(12,11*(Y1-Y0)/(X1-X0)+1),dpi=100)
im=ax.imshow(s,extent=[X0,X1,Y0,Y1],cmap="terrain",vmin=vmin,vmax=vmax)
xs=X0+(np.arange(s.shape[1])+0.5)*d; ys=Y1-(np.arange(s.shape[0])+0.5)*d
cs=ax.contour(xs,ys,s,levels=np.arange(vmin,vmax,ci),colors="k",linewidths=0.3)
ax.clabel(cs,fontsize=6,fmt="%g")
for fn,col in [("data/raw/altevatn_innsjo.geojson","b"),("data/raw/altevatn_omkrets_dybdemalt.geojson","r")]:
    for f in json.load(open(fn))["features"]:
        g=shape(f["geometry"])
        geoms=[g] if g.geom_type=="Polygon" else list(getattr(g,"geoms",[]))
        for p in geoms:
            if p.geom_type!="Polygon": continue
            xy=np.array(p.exterior.coords); ax.plot(xy[:,0],xy[:,1],col+"-",lw=0.8)
ax.set_xlim(X0,X1); ax.set_ylim(Y0,Y1)
plt.colorbar(im,shrink=0.7); ax.set_title(f"{base} crop; contours {ci:g} m; blue=regulated lake, red=1959 outline")
ax.grid(alpha=0.3); fig.tight_layout(); fig.savefig(out); print("wrote",out)
