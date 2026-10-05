"""evalexpr.js --dump で書き出したジオメトリから、おおまかなプレビュー画像を描く開発用ツール。

AE のレンダリングを再現するものではなく、配置・大きさ・色・タイミングの確認用。
    python3 dev/render_preview.py geometry.json out_dir [背景画像...]
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_PATH = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"
W, H = 1920, 1080


def rgba(c, a=1.0):
    return tuple(int(round(max(0, min(1, v)) * 255)) for v in c[:3]) + (int(round(max(0, min(1, a)) * 255)),)


def hblur(img, length):
    """横方向のボックスブラー（AE の方向ブラーの近似）"""
    if length < 1:
        return img
    k = int(length)
    arr = np.asarray(img).astype(np.float32)
    # 乗算済みアルファでぼかす
    a = arr[..., 3:4] / 255.0
    arr = np.concatenate([arr[..., :3] * a, arr[..., 3:4]], axis=2)
    pad = np.pad(arr, ((0, 0), (k, k), (0, 0)), mode="constant")
    cs = np.cumsum(pad, axis=1)
    cs = np.concatenate([np.zeros_like(cs[:, :1]), cs], axis=1)
    out = (cs[:, 2 * k + 1:] - cs[:, :-2 * k - 1]) / (2 * k + 1)
    out = out[:, :W]
    a = np.maximum(out[..., 3:4], 1e-6) / 255.0
    out = np.concatenate([np.where(a > 1e-4, out[..., :3] / a, 0), out[..., 3:4]], axis=2)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def text_layer(op):
    font = ImageFont.truetype(FONT_PATH, max(1, int(round(op["fontSize"] * op["sy"]))))
    anchor = {"LEFT_JUSTIFY": "ls", "CENTER_JUSTIFY": "ms", "RIGHT_JUSTIFY": "rs"}[op["justification"]]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    ox, oy = op["origin"]
    sw = op["strokeWidth"] * op["sy"] / 2 if op["stroke"] else 0
    kwargs = {}
    if sw >= 0.5:
        kwargs = dict(stroke_width=int(round(sw)), stroke_fill=rgba(op["stroke"]))
    d.text((ox, oy), op["text"], font=font, fill=rgba(op["fill"]), anchor=anchor, **kwargs)
    ratio = op["sx"] / op["sy"] if op["sy"] else 1
    if abs(ratio - 1) > 1e-3:
        # 原点を中心に横方向だけ拡縮
        scaled = layer.resize((max(1, int(W * ratio)), H), Image.LANCZOS)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dx = int(round(ox - ox * ratio))
        layer.paste(scaled, (dx, 0), scaled)
    # ドロップシャドウ／グロー（上から順に、それまでの合成結果のアルファから作る）
    for sh in op["shadows"]:
        if sh["opacity"] <= 0:
            continue
        alpha = layer.split()[3]
        rad = sh["softness"] / 2.5
        if rad > 0:
            alpha = alpha.filter(ImageFilter.GaussianBlur(rad))
        alpha = alpha.point(lambda v, o=sh["opacity"]: int(v * o))
        shadow = Image.new("RGBA", (W, H), rgba(sh["color"]))
        shadow.putalpha(alpha)
        dist = sh["distance"]
        off = (int(round(dist * math.sin(math.radians(135)))), int(round(-dist * math.cos(math.radians(135)))))
        moved = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        moved.paste(shadow, off)
        layer = Image.alpha_composite(moved, layer)
    if op["dirBlur"] > 0:
        layer = hblur(layer, op["dirBlur"] / 2)
    if op["opacity"] < 1:
        a = layer.split()[3].point(lambda v, o=op["opacity"]: int(v * o))
        layer.putalpha(a)
    return layer


def rect_layer(ops):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for op in ops:
        tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        x0, x1 = sorted([op["x0"], op["x1"]])
        y0, y1 = sorted([op["y0"], op["y1"]])
        if x1 - x0 < 0.5 or y1 - y0 < 0.5:
            continue
        ImageDraw.Draw(tmp).rectangle([x0, y0, x1, y1], fill=rgba(op["color"], op["opacity"]))
        layer = Image.alpha_composite(layer, tmp)
    first = ops[0]
    if first.get("blurH", 0) > 0:
        arr = layer
        layer = hblur(arr, first["blurH"])
    if first.get("dirBlur", 0) > 0:
        layer = hblur(layer, first["dirBlur"] / 2)
    return layer


def render(ops, bg):
    canvas = bg.copy().convert("RGBA")
    i = 0
    while i < len(ops):
        op = ops[i]
        if op["type"] == "rect":
            group = [op]
            while i + 1 < len(ops) and ops[i + 1]["type"] == "rect" and ops[i + 1]["layer"] == op["layer"]:
                i += 1
                group.append(ops[i])
            canvas = Image.alpha_composite(canvas, rect_layer(group))
        else:
            canvas = Image.alpha_composite(canvas, text_layer(op))
        i += 1
    return canvas


def main():
    geo = json.load(open(sys.argv[1]))
    out_dir = sys.argv[2]
    bgs = sys.argv[3:]
    os.makedirs(out_dir, exist_ok=True)
    for ci, (comp, frames) in enumerate(geo.items()):
        if ci < len(bgs) and os.path.exists(bgs[ci]):
            bg = Image.open(bgs[ci]).convert("RGB").resize((W, H), Image.LANCZOS)
        else:
            bg = Image.new("RGB", (W, H), (70, 80, 90))
        for t, ops in frames.items():
            img = render(ops, bg)
            img.convert("RGB").save(os.path.join(out_dir, f"c{ci + 1}_t{float(t):.2f}.png"))
    print("done", out_dir)


if __name__ == "__main__":
    main()
