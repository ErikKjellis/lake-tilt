"""Convert 6-digit grid refs from Bargel (1984) map 1532 II (assumed ED50 / UTM 34N, 100-km digit E=4, N=76xx)
to WGS84 and ETRS89/UTM33. Northing digits 9xx -> 75 9xx00, others -> 76 0xx00 etc."""
from pyproj import Transformer
t_ed = Transformer.from_crs(23034, 4326, always_xy=True)   # ED50 UTM34
t_33 = Transformer.from_crs(4326, 25833, always_xy=True)
refs = {
    "Andersholmen (esker island)": "461 999",
    "Strandvoll Altevatn": "435 015",
    "Strandvoll Gavdnjajavri": "312 008",
    "Strandvoll Havgajavri": "287 038",
    "Esker section E end Altevatn": "529 036",
    "Meltwater cut Gavdnjajavri-Altevatn": "404 995",
    "Balgastatcacca overflow canyon": "393 141",
    "Big slukas S side Altevatn": "409 000",
    "Suddesgaldnjajakka transfer outlet": "505 011",
    "Doarrujakka transfer": "493 069",
    "Multujakka transfer": "500 088",
    "Navsti": "475 175",
}
for k, r in refs.items():
    e3, n3 = r.split()
    E = 400000 + int(e3) * 100
    n = int(n3)
    N = (7500000 if n >= 900 else 7600000) + n * 100
    lon, lat = t_ed.transform(E, N)
    x, y = t_33.transform(lon, lat)
    print(f"{k:40s} {r}  ED50/34: {E} {N}  WGS84 {lat:.5f} {lon:.5f}  UTM33 {x:.0f} {y:.0f}")
