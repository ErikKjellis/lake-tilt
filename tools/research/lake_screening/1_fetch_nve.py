import json, urllib.parse, urllib.request, sys
from pathlib import Path
BASE="https://kart.nve.no/enterprise/rest/services/Innsjodatabase2/MapServer"
out=Path(sys.argv[1])
def q(layer, **p):
    p={"outSR":25833,"f":"geojson",**p}
    feats=[];off=0
    while True:
        p["resultOffset"]=off;p["resultRecordCount"]=1000
        with urllib.request.urlopen(f"{BASE}/{layer}/query?"+urllib.parse.urlencode(p),timeout=300) as r: j=json.load(r)
        f=j.get("features",[]);feats+=f
        if len(f)<1000: break
        off+=1000
    return {"type":"FeatureCollection","features":feats}
lakes=q(5,where="areal_km2>=2",outFields="vatnlnr,navn,hoyde,areal_km2,magasinnr,magkategori,grensesjo,land2,kommune,dybdekart",returnGeometry="true",maxAllowableOffset=50,geometryPrecision=0)
(out/"lakes.geojson").write_text(json.dumps(lakes));print("lakes",len(lakes["features"]))
dk=q(4,where="1=1",outFields="vatnlnr,innsjonavn,maksdyp_m,middeldyp_m,oppmaltaar,oppmaltmetode,ekvidistanse_m,arealdybdekart_km2",returnGeometry="false")
(out/"dybdekart.geojson").write_text(json.dumps(dk));print("dybdekart",len(dk["features"]))
