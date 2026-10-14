import json, sys, math, csv
import numpy as np
from pathlib import Path
from shapely.geometry import shape, Point
from shapely import prepared
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator
nkg=Path(sys.argv[1]); d=Path(sys.argv[2])
a=np.loadtxt(nkg/"NKG2016LU_lev.dat")
LAT=49.0+np.arange(313)/12.0; LON=np.arange(301)/6.0
g=np.full((313,301),np.nan); g[np.rint((a[:,0]-49)*12).astype(int),np.rint(a[:,1]*6).astype(int)]=a[:,2]
f=RegularGridInterpolator((LAT,LON),g)
tr=Transformer.from_crs("EPSG:25833","EPSG:4258",always_xy=True)
dk={}
for ft in json.loads((d/"dybdekart.geojson").read_text())["features"]:
    p=ft["properties"]; dk.setdefault(p["vatnlnr"],p)
F10=5000*(math.exp(2)-1)
rows=[]
for ft in json.loads((d/"lakes.geojson").read_text())["features"]:
    p=ft["properties"]
    if p.get("land2") and p["land2"]!="NO" and False: pass
    geom=shape(ft["geometry"]).buffer(0)
    if geom.is_empty: continue
    minx,miny,maxx,maxy=geom.bounds
    step=max(200,min(1000,math.sqrt(geom.area)/15))
    xs,ys=np.meshgrid(np.arange(minx,maxx,step),np.arange(miny,maxy,step))
    pg=prepared.prep(geom)
    pts=[(x,y) for x,y in zip(xs.ravel(),ys.ravel()) if pg.contains(Point(x,y))]
    bnd=geom.exterior.coords if geom.geom_type=="Polygon" else [c for gg in geom.geoms for c in gg.exterior.coords]
    pts+=list(bnd)
    P=np.array(pts)
    lon,lat=tr.transform(P[:,0],P[:,1])
    r=f(np.column_stack([lat,lon]))
    imax,imin=int(np.nanargmax(r)),int(np.nanargmin(r))
    dr=float(np.nanmax(r)-np.nanmin(r))
    # plane fit -> gradient direction
    A=np.column_stack([P[:,0]-P[:,0].mean(),P[:,1]-P[:,1].mean(),np.ones(len(P))])
    c,*_=np.linalg.lstsq(A,r,rcond=None)
    gmag=math.hypot(c[0],c[1])*1000  # mm/yr per km
    gaz=(math.degrees(math.atan2(c[0],c[1]))+360)%360  # direction of increasing uplift
    # principal axis length
    C=np.cov((P[:,0]-P[:,0].mean(),P[:,1]-P[:,1].mean()))
    w,v=np.linalg.eigh(C); ax=v[:,1]
    proj=(P-P.mean(0))@ax; L=(proj.max()-proj.min())/1000
    laz=(math.degrees(math.atan2(ax[0],ax[1]))+360)%180
    ali=abs(math.cos(math.radians(gaz-laz)))
    ext_along_grad=(P-P.mean(0))@np.array([math.sin(math.radians(gaz)),math.cos(math.radians(gaz))])
    q=dk.get(p["vatnlnr"])
    clon,clat=tr.transform(*geom.representative_point().coords[0])
    rows.append(dict(vatnlnr=p["vatnlnr"],navn=p["navn"],hoyde=p["hoyde"],areal_km2=round(p["areal_km2"],1),
      kommune=p["kommune"],regulert=bool(p.get("magasinnr")),grense=p.get("land2") or "",
      r_min=round(float(np.nanmin(r)),2),r_max=round(float(np.nanmax(r)),2),dr=round(dr,3),
      tilt10k_m=round(dr*F10/1000,1),grad_mm_km=round(gmag,4),grad_az=round(gaz),len_km=round(L,1),axis_az=round(laz),align=round(ali,2),
      ext_grad_km=round((ext_along_grad.max()-ext_along_grad.min())/1000,1),
      lat=round(clat,3),lon=round(clon,3),
      bathy=bool(q),maksdyp=q and q["maksdyp_m"],oppmaltaar=q and q["oppmaltaar"],metode=q and q["oppmaltmetode"],ekvid=q and q["ekvidistanse_m"]))
rows.sort(key=lambda x:-x["dr"])
with open(d/"ranking.csv","w",newline="",encoding="utf-8") as fh:
    w=csv.DictWriter(fh,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
json.dump(rows,open(d/"ranking.json","w",encoding="utf-8"),ensure_ascii=False)
for x in rows[:70]:
    print(f"{x['navn'][:22]:22} {x['vatnlnr']:6} h={x['hoyde']:5} A={x['areal_km2']:6} dr={x['dr']:.2f} tilt10k={x['tilt10k_m']:5} L={x['len_km']:5} al={x['align']} bathy={'Y' if x['bathy'] else '-'} dmax={x['maksdyp']} {x['oppmaltaar']} reg={int(x['regulert'])} {x['grense']} {x['kommune']}")
