"""Convert listed EPSG:25833 points to WGS84 lat/lon."""
from pyproj import Transformer
tr = Transformer.from_crs(25833, 4326, always_xy=True)
pts = {
 "Altevatn main dam (damnr 1015, N250 pt)": (657768.7, 7620977.7),
 "Altevatn main dam line start": (657679.1, 7621227.5),
 "Altevatn overflow dam (damnr 1016)": (657936.7, 7620752.5),
 "Innset kraftverk": (655246.1, 7621232.8),
 "Innsetvatn dam": (651500.7, 7622988.5),
 "Irggajavri sperredam": (697457.0, 7615294.3),
 "Multojohka sperredam": (695739.6, 7615889.4),
 "Salvasskardelva transfer outlet": (658227.1, 7620538.9),
 "Station Altevatnet vest 196.50.2": (658727.0, 7621159.4),
 "Station Altevatn 196.24.0": (657740.8, 7621111.1),
 "Station Langranen 196.50.1": (681495.8, 7611173.3),
 "Storfoss old gauge 196.4.0": (656585.3, 7620596.0),
 "Leinavatn outlet (nearest pt to Altevatn)": (692436, 7604368),
 "Altevatn pt nearest Leinavatn (HRV)": (692287, 7604580),
}
for k, (x, y) in pts.items():
    lon, lat = tr.transform(x, y)
    print(f"{k:45s} {x:.0f} {y:.0f} -> {lat:.5f} {lon:.5f}")
