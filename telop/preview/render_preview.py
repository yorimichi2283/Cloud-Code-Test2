"""
テロップアニメーションのプレビュー動画を書き出すスクリプト。
AE 用スクリプト (../telop_gekiyaba_drink.jsx) と同じ見た目・タイミングを Python で再現する。

使い方:
  python3 render_preview.py <フォントファイル(.otf/.ttf)> <出力ディレクトリ>
  例: python3 render_preview.py NotoSerifJP-Black.otf ./out
"""
import math
import os
import random
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS, FRAMES = 1920, 1080, 30, 120

# ---- 見た目（JSX の CONFIG と合わせる） ----
FILL_TOP = (255, 70, 40)
FILL_BOTTOM = (170, 0, 12)
WHITE = (255, 255, 255)
OUTER = (45, 8, 4)
WHITE_STROKE_RATIO = 0.16   # 白フチの線幅 / 文字サイズ（AE の線幅＝見える太さ×2）
OUTER_STROKE_RATIO = 0.34   # 外側の濃いフチ
SHADOW_OFFSET = 10
SHADOW_BLUR = 6
SHADOW_ALPHA = 0.7

LINES = [
    # text, font size, center position, start frame, out start frame
    ("激ヤバドリンクを", 120, (960, 760), 0, 102),
    ("飲んでみる", 160, (960, 915), 9, 104),
]

SS = 2  # スプライトのスーパーサンプリング倍率


def make_sprite(text, size, font_path):
    s = size * SS
    font = ImageFont.truetype(font_path, s)
    w_outer = round(s * OUTER_STROKE_RATIO / 2)
    w_white = round(s * WHITE_STROKE_RATIO / 2)
    pad = w_outer + (SHADOW_OFFSET + SHADOW_BLUR * 3) * SS
    l, t, r, b = font.getbbox(text)
    cw, ch = r - l + pad * 2, b - t + pad * 2
    org = (pad - l, pad - t)

    def mask(stroke):
        m = Image.new("L", (cw, ch), 0)
        ImageDraw.Draw(m).text(org, text, font=font, fill=255, stroke_width=stroke, stroke_fill=255)
        return m

    m_outer, m_white, m_fill = mask(w_outer), mask(w_white), mask(0)

    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    # ドロップシャドウ
    sh = Image.new("L", (cw, ch), 0)
    sh.paste(m_outer, (SHADOW_OFFSET * SS, SHADOW_OFFSET * SS))
    sh = sh.filter(ImageFilter.GaussianBlur(SHADOW_BLUR * SS)).point(lambda v: int(v * SHADOW_ALPHA))
    out.paste((0, 0, 0, 255), (0, 0), sh)
    out.paste(OUTER + (255,), (0, 0), m_outer)
    out.paste(WHITE + (255,), (0, 0), m_white)
    # 縦グラデーション（文字の上端→下端）
    grad = Image.new("RGBA", (cw, ch))
    gt, gb = org[1] + t, org[1] + b
    gd = ImageDraw.Draw(grad)
    for y in range(ch):
        k = min(max((y - gt) / max(gb - gt, 1), 0), 1)
        c = tuple(round(FILL_TOP[i] + (FILL_BOTTOM[i] - FILL_TOP[i]) * k) for i in range(3))
        gd.line([(0, y), (cw, y)], fill=c + (255,))
    out.paste(grad, (0, 0), m_fill)
    # 回転・拡大の中心＝文字本体の中心
    center = (org[0] + (l + r) / 2, org[1] + (t + b) / 2)
    return out, center


def ease(a, b, k, mode):
    if mode == "out":
        k = 1 - (1 - k) ** 3
    elif mode == "in":
        k = k ** 3
    elif mode == "inout":
        k = k * k * (3 - 2 * k)
    return a + (b - a) * k


def interp(keys, f):
    """keys: [(frame, value, mode_to_next)]"""
    if f <= keys[0][0]:
        return keys[0][1]
    for (f0, v0, m), (f1, v1, _) in zip(keys, keys[1:]):
        if f0 <= f <= f1:
            return ease(v0, v1, (f - f0) / (f1 - f0), m)
    return keys[-1][1]


def line_state(f, start, out):
    lf = f - start
    if lf < 0:
        return None
    scale = interp([(0, 380, "out"), (5, 92, "inout"), (8, 106, "inout"), (11, 100, "lin"),
                    (out - start, 103, "in"), (out - start + 6, 0, "lin")], lf)
    rot = interp([(0, -10, "out"), (5, 0, "lin")], lf)
    opa = interp([(0, 0, "lin"), (2, 100, "lin")], lf)
    # 着地時のシェイク（JSX の position エクスプレッションと同じ考え方）
    dx = dy = 0.0
    t0, dur, amp = 5, 9, 22
    if t0 <= lf < t0 + dur:
        rnd = random.Random(start * 1000 + lf)
        decay = 1 - (lf - t0) / dur
        dx, dy = rnd.uniform(-1, 1) * amp * decay, rnd.uniform(-1, 1) * amp * decay
    return scale / 100, rot, opa / 100, dx, dy


def background():
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        k = y / H
        d.line([(0, y), (W, y)], fill=(int(40 + 30 * k), int(60 + 20 * k), int(80 - 20 * k)))
    return bg


def main():
    font_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    sprites = [make_sprite(t, s, font_path) for t, s, *_ in LINES]
    bg = background()
    with tempfile.TemporaryDirectory() as tmp:
        for f in range(FRAMES):
            frame = bg.copy().convert("RGBA")
            for (text, size, pos, start, out), (spr, c) in zip(LINES, sprites):
                st = line_state(f, start, out)
                if st is None or st[0] <= 0.001:
                    continue
                sc, rot, opa, dx, dy = st
                k = sc / SS
                img = spr.resize((max(1, round(spr.width * k)), max(1, round(spr.height * k))), Image.LANCZOS)
                cx, cy = c[0] * k, c[1] * k
                if rot:
                    # 中心を合わせて回転
                    big = Image.new("RGBA", (img.width * 2, img.height * 2), (0, 0, 0, 0))
                    ox, oy = round(img.width - cx), round(img.height - cy)
                    big.paste(img, (ox, oy))
                    img = big.rotate(-rot, resample=Image.BICUBIC, center=(img.width, img.height))
                    cx, cy = big.width / 2, big.height / 2
                if opa < 1:
                    a = img.getchannel("A").point(lambda v: int(v * opa))
                    img.putalpha(a)
                frame.alpha_composite(img, (round(pos[0] - cx + dx), round(pos[1] - cy + dy)))
            frame.convert("RGB").save(os.path.join(tmp, f"f{f:04d}.png"))
            if f == 40:
                frame.convert("RGB").save(os.path.join(out_dir, "preview_still.png"))
        src = os.path.join(tmp, "f%04d.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", src,
                        "-vf", "scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
                        os.path.join(out_dir, "preview.mp4")], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", src,
                        "-vf", "fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse",
                        os.path.join(out_dir, "preview.gif")], check=True)


if __name__ == "__main__":
    main()
