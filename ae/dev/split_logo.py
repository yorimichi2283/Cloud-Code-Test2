# Split the "かながわの現場" logo (assets/logo_source.jpg) into per-character
# transparent PNGs (white glyph + alpha; color is applied in AE with a Fill effect)
# and write assets/logo_layout.json with each glyph's position in source pixels.
import json, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
src = np.asarray(Image.open(os.path.join(ASSETS, "logo_source.jpg")).convert("RGB")).astype(float)
H, W, _ = src.shape

BLUE = (6, 157, 212)    # #069DD4
BLACK = (20, 20, 20)    # #141414
# (name, row, x0, x1) ranges measured from column projections
GLYPHS = [
    ("ka", "hira", 296, 564), ("na", "hira", 595, 868), ("ga", "hira", 899, 1185),
    ("wa", "hira", 1208, 1474), ("no", "hira", 1507, 1702),
    ("gen", "kanji", 208, 957), ("ba", "kanji", 1037, 1790),
]
ROWS = {"hira": (430, 704), "kanji": (750, 1497)}
PAD = 6

def alpha_for(region, row):
    if row == "hira":   # red channel separates cyan from white best
        a = (255 - region[:, :, 0]) / (255 - BLUE[0])
    else:
        a = (255 - region.mean(axis=2)) / (255 - BLACK[0])
    a = np.clip(a, 0, 1)
    a[a < 0.02] = 0
    return a

layout = {"source": [W, H], "colors": {"hira": "#069DD4", "kanji": "#141414"}, "glyphs": []}
for name, row, x0, x1 in GLYPHS:
    y0, y1 = ROWS[row]
    a = alpha_for(src[y0:y1, x0:x1], row)
    ys, xs = np.where(a > 0.05)
    cx0, cx1 = max(xs.min() - PAD, 0), min(xs.max() + PAD + 1, a.shape[1])
    cy0, cy1 = max(ys.min() - PAD, 0), min(ys.max() + PAD + 1, a.shape[0])
    a = a[cy0:cy1, cx0:cx1]
    img = np.zeros(a.shape + (2,), dtype=np.uint8)
    img[:, :, 0] = 255
    img[:, :, 1] = np.round(a * 255).astype(np.uint8)
    fn = "logo_%s.png" % name
    Image.fromarray(img, "LA").save(os.path.join(ASSETS, fn), optimize=True)
    gx, gy = x0 + cx0, y0 + cy0
    layout["glyphs"].append({"name": name, "row": row, "file": fn, "x": int(gx), "y": int(gy),
                             "w": int(a.shape[1]), "h": int(a.shape[0])})
json.dump(layout, open(os.path.join(ASSETS, "logo_layout.json"), "w"), indent=1)
print(json.dumps(layout["glyphs"]))
