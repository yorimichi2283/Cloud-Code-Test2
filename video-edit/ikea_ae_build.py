"""Build the After Effects package for the IKEA soft-ice vlog (full-telop version).

One timeline spec drives everything:
  - ae_project/build_ikea_edit.jsx     ExtendScript that builds the comp inside After Effects
  - ae_project/matte/person_matte.mp4  luma matte of the person (for text-behind-person)
  - ae_project/sfx/*.wav               subtle synthesized SFX (+ pre-mixed track)
  - ae_project/preview.mp4             low-res preview of the design

Design rules
  - Spoken captions are static: they just cut in on the first syllable (2-frame fade) and stay still.
  - Motion is reserved for the opening hook and a handful of key moments:
      mask   - the line rises from behind an invisible edge (clipped), optional yellow underline wipe
      track  - letter-spacing collapses while fading in (thin Mincho labels)
  - Timings follow the speaker (Whisper timestamps). Every telop is checked against the Reels safe zone.
The preview and the AE build share the same keyframe data.

usage: python3 ikea_ae_build.py SRC.mp4 FONT_DIR OUT_DIR [--skip-matte] [--skip-preview]
"""
import os, sys, re, json, math, random, shutil, subprocess, functools
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
# Meta guidance for Reels: keep text out of top 14% (~250px), bottom 35% (~670px), sides 6% (~60px).
# The right edge also hosts the like/comment buttons, so keep a wider margin there.
SAFE = dict(left=60, top=250, right=W - 120, bottom=H - 670)
CX = W // 2  # everything is centred on the frame

WHITE, YELLOW, DARK = (255, 255, 255), (255, 210, 31), (30, 28, 26)
FONTS = {  # key -> (PostScript name of the bundled fallback, ttf file)
    "gothic": ("ZenKakuGothicAntique-Black", "ZenKakuGothicAntique_900Black.ttf"),
}
# Preferred fonts in After Effects (Adobe Fonts: Toppan Bunkyu Midashi Gothic). The script uses the first one
# that is installed and falls back to the bundled font otherwise. The preview always uses the bundled font.
FONT_PREFS = {
    "gothic": ["ToppanBunkyuMidashiGothicStdN-ExtraBold", "ToppanBunkyuMidashiGothicStd-ExtraBold",
               "ToppanBunkyuGothicPr6N-DB"],
}
MAX_LINES = 2           # never more than two lines of telop on screen at once
TRACKING = -30          # AE tracking units (1/1000 em)
BASE_Y, ACCENT_Y = 1150, 985
BASE_SIZE, ACCENT_SIZE = 84, 190
MAX_LINE_W = 780
BORDER = 0.022          # thin dark border, fraction of the font size
LINE_GAP = 0.12         # extra space between stacked lines, fraction of the size
DRIFT = 0.03            # slow push-in on animated telops only (100% -> 103%)
FADE = 2 / FPS          # cut-in / cut-out softness of static captions
EXIT = 0.12             # fade-out of animated telops
MASK_IN, MASK_STAGGER = 0.42, 0.08
TRACK_IN, TRACK_FROM = 0.6, 350
BAR_DELAY, BAR_IN, BAR_H = 0.18, 0.4, 0.07
CH_STAGGER, CH_DUR = 0.06, 0.32   # per-character entrances (cascade / popchars)
COUNT_DUR, COUNT_STEP = 0.45, 2 / FPS   # slot-machine digits before the price lands
SWIPE_DIST, SLIDE_DIST = 900, 700
HOOK_END, HOOK_DIM = 2.1, 0.55   # darken the opening shot so the hook reads

# ---------------------------------------------------------------- timeline spec
# Markup: text in [brackets] is the accent colour. "/" starts a new line; a line may carry its own
# size as "size:text".
def P(t0, t1, text, kind="base", **kw):
    d = dict(t0=t0, t1=t1, text=text, kind=kind, x=CX, rot=0.0, behind=False, sfx=False, font="gothic",
             color=WHITE, accent=YELLOW, anim="static", bar=False, counter=False)
    if kind == "base": d.update(y=BASE_Y, size=BASE_SIZE)
    elif kind == "accent": d.update(y=ACCENT_Y, size=ACCENT_SIZE, anim="mask", sfx=True)
    d.update(kw)
    return d

TELOPS = [
    # 0-2.1 exterior: two-line hook only (the shot itself already says "IKEA")
    P(0.10, HOOK_END, "日本は[50円]", "hook", y=660, size=120, anim="mask", counter=True, sfx=True),
    P(0.55, HOOK_END, "本場は[いくら？]", "hook", y=830, size=150, anim="cascade", bar=True, sfx=True),
    # 2.1-8.7 intro talk
    P(2.38, 2.84, "日本だと"),
    P(2.84, 3.16, "イケアの"),
    P(3.16, 3.70, "ソフトクリームって"),
    P(3.70, 4.38, "1個[50円]", "accent", anim="pop", counter=True),
    P(4.38, 5.20, "だと思うんですけど"),
    P(5.66, 6.02, "実際"),
    P(6.02, 7.22, "本場のイケアは"),
    P(7.75, 8.04, "買えるのかを"),
    P(8.04, 8.80, "見てみます"),
    # 8.7-14.2 kiosk
    P(8.98, 10.22, "アイスクリーム"),
    P(10.22, 11.74, "[9]なんで"),
    P(11.74, 12.96, "[150円]", "accent", size=210, y=950, anim="slide", counter=True, bar=True),
    P(12.10, 12.96, "ぐらいで買えるわ"),
    P(12.96, 13.74, "これ普通に"),
    # 14.2-17.4 kiosk scroll
    P(14.38, 15.54, "このシナモンロールは"),
    P(15.54, 16.72, "1個[112円]", "accent", counter=True, bar=True),
    P(16.72, 17.50, "で買えますね"),
    # 17.4-24.4 machine
    P(17.76, 18.80, "セットして"),
    P(19.16, 20.08, "あとはここを"),
    P(20.08, 21.00, "[押すだけ]ですね", anim="squash", sfx=True),
    P(23.04, 24.00, "自動でやってくれる"),
    # 24.4- eating
    P(24.84, 26.04, "実際にアイスクリーム"),
    P(29.48, 30.48, "口の中に入れた"),
    P(30.48, 31.30, "瞬間に"),
    P(31.90, 32.78, "[うわっ！]って", "accent", size=200, anim="burst"),
    P(32.78, 33.68, "色々うまい"),
    P(33.68, 34.16, "アイスクリーム"),
    P(34.16, 35.00, "あるじゃないですか"),
    P(35.14, 36.18, "まあハーゲンダッツの"),
    P(36.18, 37.40, "[5倍濃縮]", "accent", y=400, size=210, anim="cascade", behind=True),
    P(36.84, 37.28, "したみたいな"),
    P(37.28, 38.00, "感じの味がします"),
    P(38.00, 38.60, "これ"),
    P(39.24, 39.68, "意外とね"),
    P(40.30, 42.30, "ぜひ食べてみてください"),
]

# Full-screen inserts at the key beats. Text sits in the exact centre of the frame.
def CARD(t0, t1, text, bg, fg, anim, size=240):
    return dict(t0=t0, t1=t1, bg=bg, telop=P(t0, t1, text, "accent", x=W // 2, y=H // 2, size=size, color=fg,
                                             accent=fg, anim=anim, sfx=False))

CARDS = [
    CARD(7.22, 7.75, "いくら？", YELLOW, DARK, "cascade"),          # calls back to the hook's question
    CARD(13.74, 14.38, "安いんじゃ/ない？", DARK, YELLOW, "swipe", size=160),
    CARD(26.04, 26.80, "食べます", YELLOW, DARK, "zoom"),
    CARD(39.68, 40.30, "リーズナブル", DARK, YELLOW, "popchars", size=200),
]


def parse_lines(p):
    """-> list of [size, [(text, is_accent), ...]]"""
    lines = []
    for raw in p["text"].split("/"):
        size = p["size"]
        m = re.match(r"^(\d+):(.*)$", raw)
        if m: size, raw = int(m.group(1)), m.group(2)
        runs = [(s.strip("[]"), s.startswith("[")) for s in re.findall(r"\[[^\]]+\]|[^\[]+", raw)]
        lines.append([size, runs])
    return lines

# ---------------------------------------------------------------- keyframes (shared by preview and AE)
# key = [time, value, ease_out_of_this_key]   ease: "lin" | "fast" (expo-like ease-out) | "io"
CHAR_ANIMS = ("cascade", "popchars")
MOTION_BLUR = ("slide", "swipe", "cascade", "burst")


def telop_keys(p):
    """Null layer: position / scale ([sx, sy]) / rotation."""
    t0, t1, x, y, r = p["t0"], p["t1"], p["x"], p["y"], p["rot"]
    d = 100 * (1 + DRIFT)
    k = dict(scale=[[t0, [100, 100], "lin"]], rot=[[t0, r, "lin"]], pos=[[t0, [x, y], "lin"]])
    a = p["anim"]
    if a == "static": return k
    k["scale"] = [[t0, [100, 100], "lin"], [t1, [d, d], "lin"]]
    if a == "pop":
        k["scale"] = [[t0, [55, 55], "fast"], [t0 + 0.12, [110, 110], "io"], [t0 + 0.22, [100, 100], "lin"], [t1, [d, d], "lin"]]
    elif a == "slide":
        k["pos"] = [[t0, [x + SLIDE_DIST, y], "fast"], [t0 + 0.32, [x, y], "lin"]]
    elif a == "burst":
        s = t0 + 0.14
        k["scale"] = [[t0, [175, 175], "fast"], [s, [94, 94], "io"], [t0 + 0.24, [100, 100], "lin"], [t1, [d, d], "lin"]]
        k["rot"] = [[s, r, "io"], [s + 0.04, r - 7, "io"], [s + 0.08, r + 6, "io"], [s + 0.12, r - 4, "io"],
                    [s + 0.16, r + 2, "io"], [s + 0.20, r, "lin"]]
    elif a == "zoom":
        k["scale"] = [[t0, [330, 330], "fast"], [t0 + 0.3, [100, 100], "lin"], [t1, [d + 1, d + 1], "lin"]]
    elif a == "squash":  # pressed like a button
        k["scale"] = [[t0, [100, 100], "io"], [t0 + 0.08, [118, 76], "io"], [t0 + 0.18, [94, 108], "io"],
                      [t0 + 0.28, [100, 100], "lin"]]
    return k


def opacity_keys(p):
    """Per text layer."""
    t0, t1 = p["t0"], p["t1"]
    if p["anim"] == "static":
        return [[t0, 0, "lin"], [t0 + FADE, 100, "lin"], [t1 - FADE, 100, "lin"], [t1, 0, "lin"]]
    k = [[t0, 0, "lin"], [t0 + FADE, 100, "lin"]] if p["anim"] in ("pop", "slide", "burst", "zoom") else []
    if p["kind"] == "hook" and t1 == HOOK_END:
        return k + [[t1 - 0.25, 100, "io"], [t1, 0, "lin"]]
    return k + [[t1 - EXIT, 100, "io"], [t1, 0, "lin"]]


def line_keys(p, li, size):
    """Animator keys for line `li`: mask -> y offset; track -> tracking + opacity; swipe -> x offset."""
    t = p["t0"] + li * MASK_STAGGER
    if p["anim"] == "mask":
        return dict(dy=[[t, size * 1.15, "fast"], [t + MASK_IN, 0, "lin"]])
    if p["anim"] == "track":
        return dict(tracking=[[t, TRACK_FROM, "fast"], [t + TRACK_IN, 0, "lin"]],
                    opacity=[[t, 0, "io"], [t + TRACK_IN * 0.6, 100, "lin"]])
    if p["anim"] == "swipe":
        side = -1 if li % 2 == 0 else 1
        return dict(dx=[[t, side * SWIPE_DIST, "fast"], [t + 0.34, 0, "lin"]])
    return {}


def blur_keys(p):
    return [[p["t0"], 40, "fast"], [p["t0"] + 0.3, 0, "lin"]] if p["anim"] == "zoom" else None


def char_timing(p):
    """(stagger, duration): every character must be in place by half of the telop's time on screen."""
    n = len(re.sub(r"[\[\]/]|\d+:", "", p["text"]))
    budget = 0.5 * (p["t1"] - p["t0"])
    dur = min(CH_DUR, budget * 0.5)
    stagger = min(CH_STAGGER, (budget - dur) / max(n - 1, 1))
    return stagger, dur


def char_amount(p, k, t):
    """1 = hidden state, 0 = at rest, for the k-th character (cascade / popchars)."""
    stagger, dur = char_timing(p)
    q = clamp((t - p["t0"] - k * stagger) / dur)
    return (1 - q) ** 3


def counter_text(p, t):
    """Slot-machine digits in the accent run until the price lands."""
    if not p["counter"] or t >= p["t0"] + COUNT_DUR: return p["text"]
    step = int((t - p["t0"]) / COUNT_STEP)
    rng = random.Random(f'{p["t0"]}-{step}')
    def spin(m):
        body = re.sub(r"\d", lambda _: str(rng.randint(0, 9)), m.group(0))
        return body
    return re.sub(r"\[[^\]]*\]", spin, p["text"])


def counter_keys(p):
    """[time, text] for every digit change (the last one is the real price)."""
    if not p["counter"]: return []
    ts = [p["t0"] + i * COUNT_STEP for i in range(int(COUNT_DUR / COUNT_STEP))] + [p["t0"] + COUNT_DUR]
    return [[round(t, 4), counter_text(p, t + 1e-4)] for t in ts]


def bar_keys(p):
    t = p["t0"] + BAR_DELAY
    return [[t, 0, "fast"], [t + BAR_IN, 100, "lin"]]


def ease_eval(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    for (ta, va, e), (tb, vb, _) in zip(keys, keys[1:]):
        if t <= tb:
            x = (t - ta) / (tb - ta)
            u = x if e == "lin" else (1 - (1 - x) ** 4 if e == "fast" else x * x * (3 - 2 * x))
            if isinstance(va, list): return [a + (b - a) * u for a, b in zip(va, vb)]
            return va + (vb - va) * u
    return keys[-1][1]

# ---------------------------------------------------------------- layout + glyphs
FONT_DIR = None

@functools.lru_cache(maxsize=None)
def font(key, size): return ImageFont.truetype(os.path.join(FONT_DIR, FONTS[key][1]), size)


def advance(ch, size, fk): return font(fk, size).getlength(ch) + size * TRACKING / 1000.0


def fit_sizes(p):
    """Shrink lines that would not fit the safe width."""
    parts, changed = [], False
    for size, runs in parse_lines(p):
        w = sum(advance(c, size, p["font"]) for t, _ in runs for c in t)
        new = int(size * MAX_LINE_W / w) if w > MAX_LINE_W else size
        changed |= new != size
        parts.append((new, runs))
    if not changed: return
    if len(parts) == 1: p["size"] = parts[0][0]
    else: p["text"] = "/".join(f"{sz}:" + "".join(f"[{t}]" if a else t for t, a in runs) for sz, runs in parts)


def layout(p):
    """Characters with their centre relative to the telop centre, plus per-line boxes."""
    lines = parse_lines(p)
    heights = [s for s, _ in lines]
    total = sum(heights) + sum(s * LINE_GAP for s in heights[1:])
    y = -total / 2
    chars, boxes = [], []
    tr = lambda s: s * TRACKING / 1000.0
    for li, (size, runs) in enumerate(lines):
        if li: y += size * LINE_GAP
        width = sum(advance(c, size, p["font"]) for t, _ in runs for c in t) - tr(size)
        x = -width / 2
        k = 0
        for ri, (t, acc) in enumerate(runs):
            for c in t:
                a = advance(c, size, p["font"])
                chars.append(dict(ch=c, x=x + (a - tr(size)) / 2, y=y + size / 2, size=size, accent=acc,
                                  line=li, run=ri, k=k))
                x += a; k += 1
        boxes.append(dict(cy=y + size / 2, w=width, size=size, n=k))
        y += size
    return chars, boxes


@functools.lru_cache(maxsize=None)
def glyph(ch, size, color, border, fk):
    """(fill_sprite, shadow_sprite) premultiplied RGBA, centred on the character cell."""
    f = font(fk, size)
    asc, desc = f.getmetrics()
    adv = f.getlength(ch)
    pad = int(size * 0.35)
    cw, chh = int(adv) + pad * 2, asc + desc + pad * 2
    img = Image.new("L", (cw, chh), 0)
    ImageDraw.Draw(img).text((pad, pad), ch, font=f, fill=255)
    a = np.asarray(img, np.float32) / 255.0
    rgb = np.array(color, np.float32)[None, None] / 255.0 * a[..., None]
    if border:
        r = max(1, int(round(size * BORDER)))
        ring = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
        rgb = rgb + np.array(DARK, np.float32)[None, None] / 255.0 * np.clip(ring - a, 0, 1)[..., None]
        a = np.maximum(a, ring)
    fill = np.dstack([rgb, a])
    sh = cv2.GaussianBlur(a, (0, 0), max(1.5, size * 0.06))
    sh = cv2.warpAffine(sh, np.float32([[1, 0, 0], [0, 1, size * 0.03]]), (cw, chh)) * (0.55 if border else 0)
    shadow = np.zeros_like(fill); shadow[..., 3] = sh
    cx, cy = pad + adv / 2, pad + asc - size / 2 + size * 0.06
    M = np.float32([[1, 0, cw / 2 - cx], [0, 1, chh / 2 - cy]])
    return cv2.warpAffine(fill, M, (cw, chh)), cv2.warpAffine(shadow, M, (cw, chh))


def paste(canvas, spr, cx, cy, alpha=1.0):
    h, w = spr.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    H_, W_ = canvas.shape[:2]
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W_, x0 + w), min(H_, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    sub = spr[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0] * alpha
    reg = canvas[fy0:fy1, fx0:fx1]
    reg[..., :3] = reg[..., :3] * (1 - sub[..., 3:4]) + sub[..., :3]
    reg[..., 3] = reg[..., 3] * (1 - sub[..., 3]) + sub[..., 3]


def composite(frame, spr, cx, cy, scale=1.0, rot=0.0):
    s = spr
    if abs(scale - 1.0) > 1e-3 or rot:
        h, w = s.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), -rot, scale)
        side = int(math.hypot(w, h) * max(scale, 1)) + 2
        M[0, 2] += (side - w) / 2; M[1, 2] += (side - h) / 2
        s = cv2.warpAffine(s, M, (side, side), flags=cv2.INTER_LINEAR)
    h, w = s.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    sub = s[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    reg = frame[fy0:fy1, fx0:fx1]
    reg *= (1 - sub[..., 3:4]); reg += sub[..., :3]


def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))


def lerp(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0, *_), (t1, v1, *_) in zip(keys, keys[1:]):
        if t <= t1: return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return keys[-1][1]


def motion_blur(spr, dx, dy):
    L = int(math.hypot(dx, dy))
    if L < 2: return spr
    L = min(L, 160)
    k = np.zeros((L * 2 + 1, L * 2 + 1), np.float32)
    ux, uy = dx / math.hypot(dx, dy), dy / math.hypot(dx, dy)
    for i in range(L + 1):
        u = i - L / 2
        k[int(round(L + uy * u)), int(round(L + ux * u))] = 1
    k /= k.sum()
    out = cv2.filter2D(cv2.copyMakeBorder(spr, L, L, L, L, cv2.BORDER_CONSTANT, value=0), -1, k)
    return out[L:-L, L:-L]


def scaled(spr, s):
    if abs(s - 1) < 1e-3: return spr
    if s < 0.02: return None
    h, w = spr.shape[:2]
    return cv2.resize(spr, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_LINEAR)


def draw_phrase(frame, p, t):
    if not (p["t0"] <= t < p["t1"]): return
    q = dict(p, text=counter_text(p, t))
    chars, boxes = layout(q)
    tk = telop_keys(p)
    SX, SY = ease_eval(tk["scale"], t)
    alpha = lerp(opacity_keys(p), t) / 100.0
    if alpha <= 0.003: return
    border = not p.get("on_card")
    big = max(b["size"] for b in boxes)
    cw = int(max(b["w"] for b in boxes) + big * 3)
    chh = int(sum(b["size"] for b in boxes) * (1 + LINE_GAP) + big * 3)
    canvas = np.zeros((chh, cw, 4), np.float32)
    ox, oy = cw / 2, chh / 2
    per_char = p["anim"] in CHAR_ANIMS
    gk = 0
    for li, b in enumerate(boxes):
        lk = line_keys(p, li, b["size"])
        layer = np.zeros_like(canvas)
        dy = ease_eval(lk["dy"], t) if "dy" in lk else 0.0
        dx = ease_eval(lk["dx"], t) if "dx" in lk else 0.0
        track = ease_eval(lk["tracking"], t) if "tracking" in lk else 0.0
        la = ease_eval(lk["opacity"], t) / 100.0 if "opacity" in lk else 1.0
        line_chars = [c for c in chars if c["line"] == li]
        n = len(line_chars)
        for pass_ in (1, 0):  # shadows first, then fills
            for j, c in enumerate(line_chars):
                spread = (c["k"] - (n - 1) / 2) * c["size"] * track / 1000.0
                col = p["accent"] if c["accent"] else p["color"]
                spr = glyph(c["ch"], c["size"], col, border, p["font"])[pass_]
                cdy, cs, ca = 0.0, 1.0, la
                if per_char:
                    amt = char_amount(p, gk + j, t)
                    if p["anim"] == "cascade": cdy = -0.9 * c["size"] * amt
                    else: cs = 1 - amt
                    ca = la * (1 - amt)
                spr = scaled(spr, cs)
                if spr is None or ca <= 0.003: continue
                paste(layer, spr, ox + c["x"] + spread + dx, oy + c["y"] + dy + cdy, ca)
        if "dx" in lk:
            v = ease_eval(lk["dx"], t + 1 / FPS) - dx
            layer = motion_blur(layer, -v * 0.8, 0)
        if p["anim"] == "mask":  # clip to the line's band: text rises from behind its lower edge
            top = int(oy + b["cy"] - b["size"] * 0.75); bot = int(oy + b["cy"] + b["size"] * 0.6)
            layer[:max(0, top)] = 0; layer[max(0, bot):] = 0
        paste(canvas, layer, cw / 2, chh / 2)
        gk += n
    if p["bar"]:
        b = boxes[-1]
        sx = ease_eval(bar_keys(p), t) / 100.0
        if sx > 0.002:
            bh = max(3, int(b["size"] * BAR_H)); y = int(oy + b["cy"] + b["size"] * 0.62)
            x0 = int(ox - b["w"] / 2); x1 = int(x0 + b["w"] * sx)
            canvas[y:y + bh, x0:x1, :3] = np.array(YELLOW, np.float32) / 255
            canvas[y:y + bh, x0:x1, 3] = 1
    bk = blur_keys(p)
    if bk:
        bl = ease_eval(bk, t)
        if bl > 0.5: canvas = cv2.GaussianBlur(canvas, (0, 0), bl / 2)
    canvas *= alpha
    if abs(SX - SY) > 1e-3:  # non-uniform scale (squash): pre-stretch, then composite uniformly
        h, w = canvas.shape[:2]
        canvas = cv2.resize(canvas, (max(1, int(w * SX / SY)), h), interpolation=cv2.INTER_LINEAR)
    PX, PY = ease_eval(tk["pos"], t)
    if p["anim"] == "slide":
        PX2, _ = ease_eval(tk["pos"], t + 1 / FPS)
        canvas = motion_blur(canvas, (PX - PX2) * 0.8, 0)
    composite(frame, canvas, PX, PY, SY / 100.0, ease_eval(tk["rot"], t))


@functools.lru_cache(maxsize=4)
def card_base(bg):
    return np.ones((H, W, 3), np.float32) * np.array(bg, np.float32) / 255


def draw_card(frame, c, t):
    img = card_base(c["bg"]).copy()
    lt = t - c["t0"]
    yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
    band = 0.5 + 0.5 * np.sin(((xx * 0.8 + yy * 0.45) / 300.0 + lt * 0.5) * 2 * math.pi)
    band = cv2.resize(cv2.GaussianBlur(band, (0, 0), 8), (W, H))
    img *= (0.93 + 0.1 * band)[..., None]
    frame[:] = img
    draw_phrase(frame, c["telop"], t)


def hook_dim(t):
    """Opacity of the black solid that darkens the opening shot."""
    return HOOK_DIM * clamp((HOOK_END - t) / 0.25) if t < HOOK_END else 0.0

# ---------------------------------------------------------------- safe-zone check
def all_phrases(): return TELOPS + [c["telop"] for c in CARDS]


def check_safe_zone():
    bad = []
    for p in all_phrases():
        chars, boxes = layout(p)
        s = 1 + (DRIFT + 0.01 if p["anim"] != "static" else 0)
        r = math.radians(p["rot"])
        xs, ys = [], []
        for c in chars:
            hw = advance(c["ch"], c["size"], p["font"]) / 2 + c["size"] * BORDER
            hh = c["size"] * 0.5 + c["size"] * BORDER + (c["size"] * (0.62 + BAR_H) if p["bar"] else 0)
            for ox, oy in [(-hw, -hh), (hw, -hh), (-hw, hh), (hw, hh)]:
                lx, ly = (c["x"] + ox) * s, (c["y"] + oy) * s
                xs.append(p["x"] + lx * math.cos(r) - ly * math.sin(r))
                ys.append(p["y"] + lx * math.sin(r) + ly * math.cos(r))
        box = (min(xs), min(ys), max(xs), max(ys))
        if box[0] < SAFE["left"] or box[1] < SAFE["top"] or box[2] > SAFE["right"] or box[3] > SAFE["bottom"]:
            bad.append((p["text"], p["t0"], [round(v) for v in box]))
    return bad

def check_max_lines():
    """At any moment, at most MAX_LINES lines of telop (cards count on their own)."""
    bad = []
    edges = sorted({p["t0"] for p in TELOPS} | {c["t0"] for c in CARDS})
    for t in edges:
        t += 0.5 / FPS
        if any(c["t0"] <= t < c["t1"] for c in CARDS): continue
        n = sum(len(parse_lines(p)) for p in TELOPS if p["t0"] <= t < p["t1"])
        if n > MAX_LINES: bad.append((round(t, 2), n, [p["text"] for p in TELOPS if p["t0"] <= t < p["t1"]]))
    for c in CARDS:
        if len(parse_lines(c["telop"])) > MAX_LINES: bad.append((c["t0"], "card", c["telop"]["text"]))
    return bad


# ---------------------------------------------------------------- person matte
def export_matte(src, out_path, model):
    import mediapipe as mp
    from mediapipe.tasks import python as mpp
    from mediapipe.tasks.python import vision
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=mpp.BaseOptions(model_asset_path=model), output_confidence_masks=True,
        running_mode=vision.RunningMode.VIDEO))
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "8", "-preset", "slow",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path], stdin=subprocess.PIPE)
    prev, i = None, 0
    while True:
        buf = dec.stdout.read(W * H * 3)
        if len(buf) < W * H * 3: break
        rgb = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        r = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)),
                                  int(i * 1000 / FPS))
        m = 1 - r.confidence_masks[0].numpy_view()[..., 0].astype(np.float32)
        m = cv2.GaussianBlur(np.clip((m - 0.5) * 2.5 + 0.5, 0, 1), (0, 0), 2.0)
        if prev is not None: m = 0.6 * m + 0.4 * prev
        prev = m
        enc.stdin.write((m * 255 + 0.5).astype(np.uint8).tobytes()); i += 1
    enc.stdin.close(); enc.wait(); dec.wait(); seg.close()
    return i

# ---------------------------------------------------------------- SFX (kept quiet on purpose)
SR = 48000
def sfx_whoosh(d=0.32):
    from scipy.signal import butter, sosfilt
    n = int(SR * d); noise = np.random.default_rng(1).standard_normal(n + SR // 10)
    out = np.zeros(n); seg = n // 8
    for i in range(8):
        fc = 700 * (3.2 ** (i / 7))
        sos = butter(2, [fc * 0.6, fc * 1.6], btype="band", fs=SR, output="sos")
        out[i * seg:(i + 1) * seg] = sosfilt(sos, noise)[SR // 10 + i * seg: SR // 10 + (i + 1) * seg]
    t = np.linspace(0, 1, n); env = np.sin(np.pi * np.clip(t / 0.75, 0, 1)) ** 2 * np.clip((1 - t) / 0.25, 0, 1)
    return out * env / (np.abs(out).max() + 1e-9)
def sfx_pop(d=0.09):
    t = np.arange(int(SR * d)) / SR; f = 480 * np.exp(-t * 20) + 260
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)
def sfx_tick(d=0.012):
    n = int(SR * d); return np.random.default_rng(2).standard_normal(n) * np.exp(-np.arange(n) / (n / 4))
def sfx_thump(d=0.22):
    t = np.arange(int(SR * d)) / SR; f = 110 * np.exp(-t * 14) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 20)

SFX_GAIN = dict(whoosh=0.09, pop=0.12, tick=0.035, thump=0.30)

def sfx_events():
    ev = []
    for p in all_phrases():
        if p["sfx"]:
            ev.append(("pop", p["t0"]) if p["anim"] in ("pop", "burst", "popchars", "squash")
                      else ("whoosh", p["t0"] - 0.05))
        ev += [("tick", t) for t, _ in counter_keys(p)[:-1]]
    ev += [("thump", c["t0"]) for c in CARDS]
    return ev

def write_wav(path, x):
    import wave
    x = np.clip(x, -1, 1)
    st = np.stack([x, x], 1) if x.ndim == 1 else x
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((st * 32767).astype("<i2").tobytes())

def export_sfx(out_dir, dur):
    if os.path.isdir(out_dir): shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    snd = dict(whoosh=sfx_whoosh(), pop=sfx_pop(), tick=sfx_tick(), thump=sfx_thump())
    for k, v in snd.items(): write_wav(os.path.join(out_dir, f"{k}.wav"), v * 0.8)
    track = np.zeros(int(SR * (dur + 1)))
    for k, t in sfx_events():
        i = max(0, int(t * SR)); s = snd[k] * SFX_GAIN[k]; track[i:i + len(s)] += s[:len(track) - i]
    write_wav(os.path.join(out_dir, "sfx_mix.wav"), track[:int(SR * dur)])
    return track[:int(SR * dur)]

# ---------------------------------------------------------------- preview
def render_preview(src, out, sfx_track, matte_path, scale=0.5):
    a = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True).stdout
    orig = np.frombuffer(a, np.float32).reshape(-1, 2)
    sfx_track = np.pad(sfx_track, (0, max(0, len(orig) - len(sfx_track))))[:len(orig)]
    mix = np.clip(orig + sfx_track[:, None], -0.98, 0.98).astype(np.float32)
    wav = out + ".f32"; mix.tofile(wav)
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           stdout=subprocess.PIPE)
    mdec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", matte_path, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                            stdout=subprocess.PIPE)
    ow, oh = int(W * scale) // 2 * 2, int(H * scale) // 2 * 2
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}",
                            "-r", str(FPS), "-i", "-", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", wav,
                            "-c:v", "libx264", "-profile:v", "main", "-crf", "24", "-preset", "medium",
                            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest",
                            "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    i = 0
    while True:
        buf = dec.stdout.read(W * H * 3); mbuf = mdec.stdout.read(W * H)
        if len(buf) < W * H * 3: break
        t = i / FPS
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32) / 255
        frame *= 1 - hook_dim(t)
        card = next((c for c in CARDS if c["t0"] <= t < c["t1"]), None)
        if card: draw_card(frame, card, t)
        else:
            behind = [p for p in TELOPS if p["behind"] and p["t0"] <= t < p["t1"]]
            if behind and len(mbuf) == W * H:
                m = np.frombuffer(mbuf, np.uint8).reshape(H, W).astype(np.float32)[..., None] / 255
                person = frame.copy()
                for p in behind: draw_phrase(frame, p, t)
                frame = frame * (1 - m) + person * m
            for p in TELOPS:
                if not p["behind"]: draw_phrase(frame, p, t)
        small = cv2.resize(frame, (ow, oh), interpolation=cv2.INTER_AREA)
        enc.stdin.write((np.clip(small, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()); i += 1
    enc.stdin.close(); enc.wait(); dec.wait(); mdec.wait(); os.remove(wav)


def probe_duration(src):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                capture_output=True, text=True).stdout.strip())

# ---------------------------------------------------------------- After Effects ExtendScript
def jsx_phrase(p):
    lines, k0 = [], 0
    ckeys = counter_keys(p)
    for li, (size, runs) in enumerate(parse_lines(p)):
        jr = []
        for t, a in runs:
            run = dict(text=t, accent=a, k0=k0, n=len(t))
            if ckeys and a:  # slot digits live in the accent run
                run["counter"] = [[tt, "".join(r for r, acc in parse_lines(dict(p, text=txt))[li][1] if acc)]
                                  for tt, txt in ckeys]
            jr.append(run); k0 += len(t)
        lines.append(dict(size=size, runs=jr, keys=line_keys(p, li, size)))
    tk = telop_keys(p)
    name = re.sub(r"[\[\]]|\d+:", "", p["text"]).replace("/", " ")
    return dict(name=f'{p["t0"]:05.2f} {name}', t0=p["t0"], t1=p["t1"], lines=lines, anim=p["anim"],
                font=FONTS[p["font"]][0], color=[c / 255 for c in p["color"]], accent=[c / 255 for c in p["accent"]],
                border=not p.get("on_card"), behind=p["behind"], scale=tk["scale"], rot=tk["rot"], pos=tk["pos"],
                opacity=opacity_keys(p), bar=bar_keys(p) if p["bar"] else None, blur=blur_keys(p),
                motionBlur=p["anim"] in MOTION_BLUR, chStagger=char_timing(p)[0], chDur=char_timing(p)[1])

JSX_TEMPLATE = r"""// IKEA soft-ice vlog - After Effects builder (generated by ikea_ae_build.py)
// Run in After Effects: File > Scripts > Run Script File...
(function () {
var DATA = %(data)s;
var MSG = %(msg)s;
var W = 1080, H = 1920, FPS = 30;
var root = File($.fileName).parent;
var WARN = [];
var FONT_MAP = {};

// Use the first preferred font that is installed (Toppan Bunkyu via Adobe Fonts); otherwise the bundled one.
function resolveFonts(comp) {
    var probe = comp.layers.addText("\u3042");
    var src = probe.property("ADBE Text Properties").property("ADBE Text Document");
    for (var fb in DATA.fontPrefs) {
        var cands = DATA.fontPrefs[fb], chosen = fb;
        for (var i = 0; i < cands.length; i++) {
            try {
                var td = src.value; td.font = cands[i]; src.setValue(td);
                if (src.value.font === cands[i]) { chosen = cands[i]; break; }
            } catch (e) {}
        }
        FONT_MAP[fb] = chosen;
        if (chosen === fb) WARN.push(MSG.fallback + fb);
    }
    probe.remove();
}

function xf(L) { return L.property("ADBE Transform Group"); }
function setMax(prop, frac) { prop.setValue(prop.hasMax ? prop.maxValue * frac : frac * 100); }
function dims(prop) { var v = prop.value; return (v instanceof Array && !prop.isSpatial) ? v.length : 1; }
function easeArr(n, inf) { var a = []; for (var i = 0; i < n; i++) a.push(new KeyframeEase(0, inf)); return a; }

// keys: [[time, value, ease]]; ease of a key describes the segment that leaves it:
// "lin" linear, "fast" expo-like ease-out, "io" ease in-out.  conv(value) -> AE value.
function applyKeys(prop, keys, conv) {
    var i, n = dims(prop);
    for (i = 0; i < keys.length; i++) prop.setValueAtTime(keys[i][0], conv ? conv(keys[i][1]) : keys[i][1]);
    if (keys.length < 2) return;
    for (i = 1; i <= prop.numKeys; i++) {
        var outE = i <= keys.length ? keys[i - 1][2] : "lin";
        var inE = i > 1 ? keys[i - 2][2] : "lin";
        var linIn = inE === "lin", linOut = outE === "lin";
        var inInf = inE === "fast" ? 92 : 50, outInf = outE === "fast" ? 0.1 : 50;
        if (!linIn || !linOut) prop.setTemporalEaseAtKey(i, easeArr(n, linIn ? 33 : inInf), easeArr(n, linOut ? 33 : outInf));
        prop.setInterpolationTypeAtKey(i,
            linIn ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER,
            linOut ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER);
    }
    if (prop.isSpatial) for (i = 1; i <= prop.numKeys; i++) { try { prop.setSpatialAutoBezierAtKey(i, false); } catch (e) {} }
}
function sc3(v) { return (v instanceof Array) ? [v[0], v[1], 100] : [v, v, 100]; }
function dx3(v) { return [v, 0, 0]; }
function dy3(v) { return [0, v, 0]; }

function addShadow(L, size) {
    var ds = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    ds.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
    setMax(ds.property("ADBE Drop Shadow-0002"), 0.55);
    ds.property("ADBE Drop Shadow-0003").setValue(180);
    ds.property("ADBE Drop Shadow-0004").setValue(Math.max(2, size * 0.03));
    ds.property("ADBE Drop Shadow-0005").setValue(Math.max(4, size * 0.12));
}

function addRun(comp, text, size, color, border, fontName) {
    var L = comp.layers.addText(text);
    var src = L.property("ADBE Text Properties").property("ADBE Text Document");
    var td = src.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    td.font = FONT_MAP[fontName] || fontName; td.fontSize = size; td.tracking = DATA.tracking;
    td.applyFill = true; td.fillColor = color;
    if (border) {  // thin dark border drawn behind the fill
        td.applyStroke = true; td.strokeColor = DATA.dark; td.strokeOverFill = false;
        td.strokeWidth = Math.max(2, Math.round(size * DATA.border * 2));
    } else td.applyStroke = false;
    td.justification = ParagraphJustification.LEFT_JUSTIFY;
    src.setValue(td);
    if (border) addShadow(L, size);
    return L;
}

function animators(L) { return L.property("ADBE Text Properties").property("ADBE Text Animators"); }
function addAnimator(L, name, props) {
    animators(L).addProperty("ADBE Text Animator");
    var ai = animators(L).numProperties;
    animators(L).property(ai).name = name;
    for (var i = 0; i < props.length; i++)
        animators(L).property(ai).property("ADBE Text Animator Properties").addProperty(props[i]);
    return function (n) { return animators(L).property(ai).property("ADBE Text Animator Properties").property(n); };
}

// mask: the run rises from behind the lower edge of a layer mask (the mask does not move with the animator)
function addMaskRise(L, rect, size, keys) {
    var m = L.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
    var s = new Shape(), padX = size * 0.3, top = rect.top - size * 0.3, bot = rect.top + rect.height + size * 0.08;
    s.vertices = [[rect.left - padX, top], [rect.left + rect.width + padX, top],
                  [rect.left + rect.width + padX, bot], [rect.left - padX, bot]];
    s.closed = true;
    m.property("ADBE Mask Shape").setValue(s);
    var pr = addAnimator(L, "Rise", ["ADBE Text Position 3D"]);
    applyKeys(pr("ADBE Text Position 3D"), keys.dy, dy3);
}

// track: letter spacing collapses while fading in
function addTrackIn(L, keys) {
    var pr = addAnimator(L, "Track in", ["ADBE Text Tracking Amount", "ADBE Text Opacity"]);
    applyKeys(pr("ADBE Text Tracking Amount"), keys.tracking);
    applyKeys(pr("ADBE Text Opacity"), keys.opacity);
}

// swipe: the whole line slides in sideways (layer motion blur on)
function addSwipe(L, keys) {
    var pr = addAnimator(L, "Swipe", ["ADBE Text Position 3D"]);
    applyKeys(pr("ADBE Text Position 3D"), keys.dx, dx3);
}

// cascade / popchars: characters enter one after another (range selector offset sweeps left -> right)
function addChars(L, run, p, size) {
    var props = p.anim === "cascade" ? ["ADBE Text Position 3D", "ADBE Text Opacity"] : ["ADBE Text Scale 3D", "ADBE Text Opacity"];
    var pr = addAnimator(L, p.anim === "cascade" ? "Cascade" : "Pop chars", props);
    if (p.anim === "cascade") pr("ADBE Text Position 3D").setValue([0, -0.9 * size, 0]);
    else pr("ADBE Text Scale 3D").setValue([0, 0, 100]);
    pr("ADBE Text Opacity").setValue(0);
    var anims = animators(L), ai = anims.numProperties;
    var A = function () { return animators(L).property(ai); };
    A().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var adv = A().property("ADBE Text Selectors").property(1).property("ADBE Text Range Advanced");
    adv.property("ADBE Text Range Shape").setValue(2);        // Ramp Up
    adv.property("ADBE Text Levels Max Ease").setValue(100);  // Ease High
    var off = A().property("ADBE Text Selectors").property(1).property("ADBE Text Percent Offset");
    var t0 = p.t0 + run.k0 * p.chStagger;
    applyKeys(off, [[t0, -100, "lin"], [t0 + p.chDur * 1.5 + p.chStagger * run.n, 100, "lin"]]);
}

// slot-machine digits: Source Text keyframes (hold)
function addCounter(L, keys) {
    var src = L.property("ADBE Text Properties").property("ADBE Text Document");
    for (var i = 0; i < keys.length; i++) {
        var td = src.value; td.text = keys[i][1];
        src.setValueAtTime(keys[i][0], td);
    }
}

function addBlurIn(L, keys) {
    var gb = L.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
    applyKeys(gb.property("ADBE Gaussian Blur 2-0001"), keys);
    try { gb.property("ADBE Gaussian Blur 2-0003").setValue(1); } catch (e) {}  // repeat edge pixels
}

function addBar(comp, nul, x, y, w, size, keys, t0, t1) {
    var L = comp.layers.addShape();
    var root = L.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group");
    var g = function () { return root.property(1).property("ADBE Vectors Group"); };
    g().addProperty("ADBE Vector Shape - Rect"); g().addProperty("ADBE Vector Graphic - Fill");
    var h = Math.max(3, Math.round(size * DATA.barH));
    g().property(1).property("ADBE Vector Rect Size").setValue([w, h]);
    g().property(1).property("ADBE Vector Rect Position").setValue([w / 2, h / 2]);
    g().property(2).property("ADBE Vector Fill Color").setValue(DATA.yellow);
    L.parent = nul;
    xf(L).property("ADBE Anchor Point").setValue([0, 0]);
    xf(L).property("ADBE Position").setValue([x, y]);
    applyKeys(xf(L).property("ADBE Scale"), keys, function (v) { return [v, 100, 100]; });
    L.inPoint = t0; L.outPoint = t1;
    return L;
}

// One telop = a null (position / slow push-in) + one text layer per colour run.
function addPhrase(comp, p) {
    var nul = comp.layers.addNull(comp.duration);
    nul.name = "TELOP " + p.name;
    nul.startTime = 0; nul.inPoint = p.t0; nul.outPoint = p.t1;
    xf(nul).property("ADBE Anchor Point").setValue([0, 0, 0]);
    applyKeys(xf(nul).property("ADBE Position"), p.pos);
    applyKeys(xf(nul).property("ADBE Scale"), p.scale, sc3);
    applyKeys(xf(nul).property("ADBE Rotate Z"), p.rot);
    var lineBoxes = [], totalH = 0, li, k;
    for (li = 0; li < p.lines.length; li++) {
        var line = p.lines[li], lw = 0, top = 1e9, bot = -1e9, items = [];
        for (var ri = 0; ri < line.runs.length; ri++) {
            var run = line.runs[ri];
            var L = addRun(comp, run.text, line.size, run.accent ? p.accent : p.color, p.border, p.font);
            L.startTime = 0; L.inPoint = p.t0; L.outPoint = p.t1;
            var r = L.sourceRectAtTime(p.t1 - 0.01, false);
            items.push({ layer: L, rect: r, x: lw, run: run });
            lw += r.width + line.size * DATA.tracking / 1000;
            top = Math.min(top, r.top); bot = Math.max(bot, r.top + r.height);
        }
        lineBoxes.push({ items: items, width: lw - line.size * DATA.tracking / 1000, top: top, bot: bot,
                         size: line.size, keys: line.keys });
        totalH += (bot - top) + (li ? line.size * DATA.lineGap : 0);
    }
    var y = -totalH / 2;
    for (li = 0; li < lineBoxes.length; li++) {
        var lb = lineBoxes[li];
        if (li) y += lb.size * DATA.lineGap;
        for (k = 0; k < lb.items.length; k++) {
            var it = lb.items[k];
            it.layer.parent = nul;
            xf(it.layer).property("ADBE Position").setValue([-lb.width / 2 + it.x - it.rect.left, y - lb.top]);
            it.layer.name = "  " + p.name + " / " + (li + 1) + "-" + (k + 1);
            applyKeys(xf(it.layer).property("ADBE Opacity"), p.opacity);
            try {
                if (p.anim === "mask") addMaskRise(it.layer, it.rect, lb.size, lb.keys);
                else if (p.anim === "track") addTrackIn(it.layer, lb.keys);
                else if (p.anim === "swipe") addSwipe(it.layer, lb.keys);
                else if (p.anim === "cascade" || p.anim === "popchars") addChars(it.layer, it.run, p, lb.size);
                if (p.blur) addBlurIn(it.layer, p.blur);
                if (it.run.counter) addCounter(it.layer, it.run.counter);
                if (p.motionBlur || p.anim === "swipe") it.layer.motionBlur = true;
            } catch (e) { WARN.push(p.name + ": " + e.toString()); }
        }
        y += lb.bot - lb.top;
        if (p.bar && li === lineBoxes.length - 1) {
            try {
                var bar = addBar(comp, nul, -lb.width / 2, y + lb.size * 0.08, lb.width, lb.size, p.bar, p.t0, p.t1);
                bar.name = "  " + p.name + " / underline";
                applyKeys(xf(bar).property("ADBE Opacity"), p.opacity);
            } catch (e2) { WARN.push(p.name + " underline: " + e2.toString()); }
        }
    }
    return nul;
}

// ---------- shape helpers
function shapeLayer(comp, name) {
    var L = comp.layers.addShape(); L.name = name;
    xf(L).property("ADBE Position").setValue([0, 0]);
    return L;
}
function addRect(L, cx, cy, w, h, color, opacity) {
    var root = L.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group");
    var gi = root.numProperties;
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    var c = root.property(gi).property("ADBE Vectors Group");
    c.property(1).property("ADBE Vector Rect Size").setValue([w, h]);
    c.property(2).property("ADBE Vector Fill Color").setValue(color);
    c.property(2).property("ADBE Vector Fill Opacity").setValue(opacity);
    root.property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([cx, cy]);
}

function addCard(comp, c, idx) {
    var solid = comp.layers.addSolid(c.bg, "CARD " + idx + " bg", W, H, 1, comp.duration);
    solid.inPoint = c.t0; solid.outPoint = c.t1;
    var st = shapeLayer(comp, "CARD " + idx + " light");
    for (var k = -6; k <= 6; k++) addRect(st, 540, 960 + k * 320, 3200, 140, k % 2 ? [1, 1, 1] : [0, 0, 0], 7);
    xf(st).property("ADBE Anchor Point").setValue([540, 960]);
    xf(st).property("ADBE Rotate Z").setValue(-30);
    xf(st).property("ADBE Position").setValuesAtTimes([c.t0, c.t1], [[540, 960], [590, 990]]);
    st.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2").property("ADBE Gaussian Blur 2-0001").setValue(90);
    st.inPoint = c.t0; st.outPoint = c.t1;
    addPhrase(comp, c.telop);
}

function addSafeGuide(comp) {
    var g = shapeLayer(comp, "GUIDE  Reels safe zone (not rendered)");
    var s = DATA.safe, red = [1, 0.15, 0.15];
    addRect(g, W / 2, s.top / 2, W, s.top, red, 25);
    addRect(g, W / 2, (s.bottom + H) / 2, W, H - s.bottom, red, 25);
    addRect(g, s.left / 2, (s.top + s.bottom) / 2, s.left, s.bottom - s.top, red, 25);
    addRect(g, (s.right + W) / 2, (s.top + s.bottom) / 2, W - s.right, s.bottom - s.top, red, 25);
    g.guideLayer = true;
}

function importFile(path) {
    var f = new File(path);
    if (!f.exists) return null;
    return app.project.importFile(new ImportOptions(f));
}

// ---------------------------------------------------------- build
app.beginUndoGroup("IKEA soft-ice edit");
try {
    if (!app.project) app.newProject();
    alert(MSG.intro);
    var srcFile = File.openDialog(MSG.pick);
    var folder = app.project.items.addFolder("IKEA_edit");
    var comp = app.project.items.addComp("IKEA_SoftCream_Reel", W, H, 1, DATA.duration, FPS);
    comp.parentFolder = folder;
    comp.motionBlur = true;
    comp.bgColor = [0, 0, 0];
    resolveFonts(comp);

    var srcItem = srcFile ? app.project.importFile(new ImportOptions(srcFile)) : null;
    if (srcItem) srcItem.parentFolder = folder;
    function addFootage(name) {
        var L = srcItem ? comp.layers.add(srcItem) : comp.layers.addSolid([0.5, 0.5, 0.5], "REPLACE ME footage", W, H, 1, DATA.duration);
        L.name = name;
        if (srcItem && srcItem.width) {
            var s = Math.max(W / srcItem.width, H / srcItem.height) * 100;
            xf(L).property("ADBE Scale").setValue([s, s, 100]);
        }
        return L;
    }
    addFootage("FOOTAGE (base)");

    // darken the opening shot so the hook reads
    var dim = comp.layers.addSolid([0, 0, 0], "HOOK dim", W, H, 1, comp.duration);
    dim.inPoint = 0; dim.outPoint = DATA.hookEnd;
    applyKeys(xf(dim).property("ADBE Opacity"), DATA.hookDim);

    var i;
    for (i = 0; i < DATA.telops.length; i++) if (DATA.telops[i].behind) addPhrase(comp, DATA.telops[i]);

    var matteItem = importFile(root.fsName + "/matte/person_matte.mp4");
    if (matteItem) matteItem.parentFolder = folder;
    for (var sgi = 0; sgi < DATA.behindSegments.length; sgi++) {
        var seg = DATA.behindSegments[sgi];
        var cut = addFootage("PERSON cut-out " + (sgi + 1));
        if (srcItem) cut.audioEnabled = false;
        cut.inPoint = seg[0]; cut.outPoint = seg[1];
        if (matteItem) {
            var mt = comp.layers.add(matteItem);
            mt.name = "PERSON matte " + (sgi + 1) + " (luma)";
            mt.inPoint = seg[0]; mt.outPoint = seg[1];
            if (mt.hasAudio) mt.audioEnabled = false;
            if (typeof cut.setTrackMatte === "function") { cut.setTrackMatte(mt, TrackMatteType.LUMA); mt.enabled = false; }
            else { mt.moveBefore(cut); cut.trackMatteType = TrackMatteType.LUMA; }
        }
    }

    for (i = 0; i < DATA.telops.length; i++) if (!DATA.telops[i].behind) addPhrase(comp, DATA.telops[i]);
    for (i = 0; i < DATA.cards.length; i++) addCard(comp, DATA.cards[i], i + 1);

    var sfx = importFile(root.fsName + "/sfx/sfx_mix.wav");
    if (sfx) { sfx.parentFolder = folder; var sl = comp.layers.add(sfx); sl.name = "SFX mix"; }

    addSafeGuide(comp);
    comp.openInViewer();
    alert(MSG.done + (WARN.length ? "\n\n" + WARN.slice(0, 8).join("\n") : ""));
} catch (err) {
    alert("Error: " + err.toString() + " (line " + err.line + ")");
}
app.endUndoGroup();
})();
"""

MSG = {
    "intro": "IKEAソフトクリーム 編集プロジェクトを作ります。\n"
             "Adobe Fonts の「凸版文久見出しゴシック」を有効にしておくと、それが使われます。\n"
             "（無い場合は fonts フォルダの Zen Kaku Gothic Antique を使います。先にインストールしてください）\n"
             "次の画面で素材動画（編集前の高画質版）を選んでください。",
    "pick": "素材動画を選択",
    "fallback": "凸版文久見出しゴシックが見つからなかったため、代わりのフォントを使いました: ",
    "done": "完成しました。赤い部分はリールのUIで隠れる範囲です（ガイドレイヤーなので書き出しには入りません）。",
}


def export_jsx(path, duration):
    data = dict(
        duration=round(duration, 3),
        telops=[jsx_phrase(p) for p in TELOPS],
        cards=[dict(t0=c["t0"], t1=c["t1"], bg=[v / 255 for v in c["bg"]], telop=jsx_phrase(c["telop"])) for c in CARDS],
        behindSegments=sorted({(p["t0"], p["t1"]) for p in TELOPS if p["behind"]}),
        fontPrefs={FONTS[k][0]: v for k, v in FONT_PREFS.items()},
        safe=SAFE, tracking=TRACKING, border=BORDER, lineGap=LINE_GAP, barH=BAR_H,
        dark=[c / 255 for c in DARK], yellow=[c / 255 for c in YELLOW],
        hookEnd=HOOK_END, hookDim=[[0, HOOK_DIM * 100, "lin"], [HOOK_END - 0.25, HOOK_DIM * 100, "io"], [HOOK_END, 0, "lin"]],
    )
    js = (JSX_TEMPLATE.replace("%(data)s", json.dumps(data, ensure_ascii=True, indent=1))
          .replace("%(msg)s", json.dumps(MSG, ensure_ascii=True)))
    with open(path, "w", encoding="ascii") as f:
        f.write(js)


def prepare(font_dir):
    global FONT_DIR
    FONT_DIR = font_dir
    for c in CARDS: c["telop"]["on_card"] = True
    for p in all_phrases(): fit_sizes(p)


def main():
    src, font_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    model = os.environ.get("SEG_MODEL", "selfie_multiclass_256x256.tflite")
    os.makedirs(out, exist_ok=True)
    prepare(font_dir)
    bad = check_safe_zone()
    if bad:
        print("SAFE ZONE VIOLATIONS:"); [print("  ", b) for b in bad]; sys.exit(1)
    bad = check_max_lines()
    if bad:
        print("MORE THAN %d LINES:" % MAX_LINES); [print("  ", b) for b in bad]; sys.exit(1)
    print("safe zone: all telops inside", SAFE)
    dur = probe_duration(src)
    export_jsx(os.path.join(out, "build_ikea_edit.jsx"), dur)
    fdir = os.path.join(out, "fonts")
    used = {FONTS[p["font"]][1] for p in all_phrases()}
    if os.path.isdir(fdir):
        for fn in os.listdir(fdir):
            if fn.endswith(".ttf") and fn not in used: os.remove(os.path.join(fdir, fn))
    os.makedirs(fdir, exist_ok=True)
    for fn in used: shutil.copy(os.path.join(FONT_DIR, fn), os.path.join(fdir, fn))
    sfx = export_sfx(os.path.join(out, "sfx"), dur)
    matte = os.path.join(out, "matte", "person_matte.mp4")
    if "--skip-matte" not in sys.argv:
        os.makedirs(os.path.dirname(matte), exist_ok=True)
        print("matte frames:", export_matte(src, matte, model))
    if "--skip-preview" not in sys.argv:
        render_preview(src, os.path.join(out, "preview.mp4"), sfx, matte)
    print("done")


if __name__ == "__main__":
    main()
