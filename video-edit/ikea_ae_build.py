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
    "mincho": ("ShipporiMinchoB1-ExtraBold", "ShipporiMinchoB1_800ExtraBold.ttf"),
}
# Preferred fonts in After Effects (Adobe Fonts: Toppan Bunkyu Midashi Gothic). The script uses the first one
# that is installed and falls back to the bundled font otherwise. The preview always uses the bundled font.
FONT_PREFS = {
    "gothic": ["ToppanBunkyuMidashiGothicStdN-ExtraBold", "ToppanBunkyuMidashiGothicStd-ExtraBold",
               "ToppanBunkyuGothicPr6N-DB"],
    "mincho": ["ToppanBunkyuMidashiMinchoStdN-ExtraBold", "ToppanBunkyuMidashiMinchoStd-ExtraBold",
               "ToppanBunkyuMinchoPr6N-Regular"],
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
TYPE_STAGGER, TYPE_IN = 0.05, 0.09   # word-by-word captions: characters type in (scale 130% -> 100%)
MARKER_H = 0.5          # yellow highlighter band, fraction of the font size
DOODLE_IN = 0.28        # hand-drawn marks draw on in this long
HOOK_END, HOOK_DIM = 2.1, 0.55   # darken the opening shot so the hook reads

# ---------------------------------------------------------------- timeline spec
# Markup: text in [brackets] is the accent colour. "/" starts a new line; a line may carry its own
# size as "size:text".
def P(t0, t1, text, kind="base", **kw):
    d = dict(t0=t0, t1=t1, text=text, kind=kind, x=CX, rot=0.0, behind=False, sfx=False, font="gothic",
             color=WHITE, accent=YELLOW, anim="static", bar=False, counter=False, edge="dark", marker=False,
             gap=LINE_GAP)
    if kind == "base": d.update(y=BASE_Y, size=BASE_SIZE)
    elif kind == "accent": d.update(y=ACCENT_Y, size=ACCENT_SIZE, anim="mask", sfx=True)
    d.update(kw)
    return d

# Kinetic captions: every spoken word appears on its own as it is said (characters type in), words of one
# phrase pile up in the free space around the speaker (staircase / vertical columns), then clear together.
# Style per word: w = white (dark border, for dark shots) / y = yellow / k = ink (bright shots, light halo) /
# ky = ink on a yellow highlighter band. Font: g = gothic, m = mincho. vert = true vertical writing.
STYLES = {
    "w": dict(color=WHITE, edge="dark"), "y": dict(color=YELLOW, edge="dark"),
    "k": dict(color=DARK, edge="light"), "ky": dict(color=DARK, edge="light", marker=True),
}


def Wd(t, text, x, y, size, style="k", font="g", vert=False, anim=None, **kw):
    st = STYLES[style]
    key = style in ("y", "ky")
    if vert:  # one character per line; long-vowel marks become vertical bars
        text = "/".join("｜" if c == "ー" else c for c in text)
    d = dict(t0=t, t1=None, text=text, kind="word", x=x, y=y, size=size, rot=0.0, behind=False, font=FONT_KEYS[font],
             color=st["color"], accent=st["color"], edge=st["edge"], marker=st.get("marker", False),
             anim=anim or ("pop" if key else "type"), bar=False, counter=False, sfx=key, gap=-0.04 if vert else LINE_GAP)
    d.update(kw)
    return d


FONT_KEYS = {"g": "gothic", "m": "mincho"}


def cluster(t_end, *words):
    for w in words: w["t1"] = t_end
    return list(words)


# Hand-drawn marks: (t0, t1, kind, params, colour)
DOODLES = []


def doodle(t0, t1, kind, color=YELLOW, **kw):
    DOODLES.append(dict(t0=t0, t1=t1, kind=kind, color=color, **kw))


TELOPS = [
    # 0-2.1 exterior (dimmed): hook
    *cluster(HOOK_END,
             Wd(0.10, "日本は", 250, 520, 80, "w", "m"),
             Wd(0.30, "[50円]", 590, 570, 230, "y", counter=True),
             Wd(0.80, "本場は", 300, 800, 80, "w", "m"),
             Wd(1.00, "いくら？", 600, 870, 170, "y")),
    # 2.1-8.7 talking to camera: left column beside the face + the chest
    *cluster(3.70,
             Wd(2.38, "日本だと", 150, 560, 80, vert=True),
             Wd(2.84, "イケアの", 420, 1060, 80, font="m"),
             Wd(3.16, "ソフトクリームって", 540, 1170, 88)),
    *cluster(5.20,
             Wd(3.70, "1個", 220, 1050, 100, font="m"),
             Wd(4.18, "[50円]", 610, 1060, 230, "ky", counter=True),
             Wd(4.38, "だと思うんですけど", 560, 1215, 64)),
    *cluster(7.22,
             Wd(5.66, "実際", 150, 470, 110, vert=True),
             Wd(6.02, "本場の", 400, 1080, 80, font="m"),
             Wd(6.60, "イケアは", 620, 1180, 110)),
    *cluster(8.80,
             Wd(7.75, "買えるのかを", 150, 560, 76, vert=True),
             Wd(8.04, "見てみます", 560, 1170, 120)),
    # 8.7-14.4 kiosk (bright screen): ink + highlighter
    *cluster(11.74,
             Wd(8.98, "アイスクリーム", 540, 520, 110),
             Wd(10.22, "[9]", 330, 820, 320, "ky"),
             Wd(10.58, "なんで", 560, 880, 90, font="m")),
    *cluster(12.96,
             Wd(11.74, "[150円]", 540, 760, 250, "ky", counter=True),
             Wd(12.10, "ぐらいで", 330, 960, 90, font="m"),
             Wd(12.34, "買えるわ", 650, 970, 110)),
    *cluster(13.74,
             Wd(12.96, "これ", 300, 700, 90, font="m"),
             Wd(13.12, "普通に", 560, 770, 140)),
    *cluster(15.54,
             Wd(14.38, "この", 250, 420, 70, font="m"),
             Wd(14.66, "シナモンロールは", 540, 520, 96)),
    *cluster(17.50,
             Wd(15.54, "1個", 250, 980, 90, font="m"),
             Wd(16.00, "[112円]", 600, 1000, 220, "ky", counter=True),
             Wd(16.72, "で買えますね", 640, 1160, 80)),
    # 17.5-24.4 machine (darker metal): white + yellow
    *cluster(18.80,
             Wd(17.76, "セットして", 540, 340, 110, "w")),
    *cluster(21.00,
             Wd(19.16, "あとは", 250, 330, 80, "w", "m"),
             Wd(19.66, "ここを", 480, 420, 110, "w"),
             Wd(20.08, "押すだけ", 540, 600, 190, "y", anim="squash"),
             Wd(20.66, "ですね", 790, 740, 80, "w", "m")),
    *cluster(24.40,
             Wd(23.04, "自動で", 160, 560, 110, "w", vert=True),
             Wd(23.36, "やってくれる", 560, 360, 100, "w")),
    # 24.4- eating (bright wall): top band above the head + side columns
    *cluster(26.04,
             Wd(24.84, "実際に", 540, 330, 120)),
    *cluster(31.30,
             Wd(29.48, "口の中に", 170, 640, 90, vert=True),
             Wd(30.18, "入れた", 880, 620, 90, vert=True),
             Wd(30.48, "瞬間に", 540, 360, 120)),
    *cluster(32.78,
             Wd(31.90, "うわっ！", 530, 380, 170, "ky"),
             Wd(32.22, "って", 880, 520, 70, font="m")),
    *cluster(35.00,
             Wd(32.78, "色々", 170, 560, 110, vert=True),
             Wd(33.32, "うまい", 880, 600, 100, vert=True),
             Wd(33.68, "アイスクリーム", 540, 340, 100),
             Wd(34.16, "あるじゃないですか", 540, 1210, 66)),
    *cluster(36.18,
             Wd(35.14, "まあ", 250, 320, 70, font="m"),
             Wd(35.30, "ハーゲンダッツの", 560, 410, 90)),
    *cluster(38.60,
             Wd(36.18, "5倍濃縮", 530, 440, 190, "ky", behind=True),
             Wd(36.84, "したみたいな", 170, 760, 76, vert=True),
             Wd(37.28, "感じの味がします", 540, 1210, 70),
             Wd(38.00, "これ", 880, 640, 80, font="m", vert=True)),
    # close-up
    *cluster(39.68,
             Wd(39.24, "意外とね", 150, 620, 100, vert=True)),
    *cluster(42.30,
             Wd(40.42, "ぜひ", 150, 560, 110, vert=True),
             Wd(40.58, "食べてみて", 880, 640, 96, vert=True),
             Wd(41.08, "ください", 540, 1200, 90, font="m")),
]

doodle(1.25, HOOK_END, "bang", cx=930, cy=700, r=70, angle=-60)
doodle(4.30, 5.20, "bang", cx=900, cy=900, r=60, angle=-50, color=DARK)
doodle(8.30, 8.80, "swoosh", x0=330, x1=790, y=1245, color=YELLOW)
doodle(11.95, 12.96, "circle", cx=475, cy=1197, rx=150, ry=50, color=YELLOW)
doodle(20.20, 21.00, "arrow", x0=640, y0=760, x1=800, y1=1180, color=YELLOW)
doodle(31.95, 32.78, "bang", cx=850, cy=560, r=70, angle=-40, color=DARK)
doodle(31.95, 32.78, "bang", cx=230, cy=560, r=70, angle=-140, color=DARK)


# Full-screen inserts at the key beats. Text sits in the exact centre of the frame.
def CARD(t0, t1, text, bg, fg, anim, size=240):
    return dict(t0=t0, t1=t1, bg=bg, telop=P(t0, t1, text, "accent", x=W // 2, y=H // 2, size=size, color=fg,
                                             accent=fg, anim=anim, sfx=False, edge="none"))

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
CHAR_ANIMS = ("cascade", "popchars", "type")
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


def marker_keys(p):
    t = p["t0"] + 0.06
    return [[t, 0, "fast"], [t + 0.26, 100, "lin"]]


def blur_keys(p):
    return [[p["t0"], 40, "fast"], [p["t0"] + 0.3, 0, "lin"]] if p["anim"] == "zoom" else None


def char_timing(p):
    """(stagger, duration): every character must be in place by half of the telop's time on screen."""
    n = len(re.sub(r"[\[\]/]|\d+:", "", p["text"]))
    budget = 0.5 * (p["t1"] - p["t0"])
    dur = min(CH_DUR, budget * 0.5)
    stagger = min(CH_STAGGER, (budget - dur) / max(n - 1, 1))
    return stagger, dur


def type_sweep(p):
    """Typewriter: an index range selector sweeps linearly over the N characters of the word."""
    n = len(re.sub(r"[\[\]/]|\d+:", "", p["text"]))
    return n, (n - 1) * TYPE_STAGGER + TYPE_IN


def char_amount(p, k, t):
    """1 = hidden state, 0 = at rest, for the k-th character (cascade / popchars / type)."""
    if p["anim"] == "type":
        n, T = type_sweep(p)
        start = n * clamp((t - p["t0"]) / T)
        x = clamp(start - k)
        return 1 - x * x * (3 - 2 * x)
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
    gap = p.get("gap", LINE_GAP)
    total = sum(heights) + sum(s * gap for s in heights[1:])
    y = -total / 2
    chars, boxes = [], []
    tr = lambda s: s * TRACKING / 1000.0
    for li, (size, runs) in enumerate(lines):
        if li: y += size * gap
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
def glyph(ch, size, color, edge, fk):
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
    if edge == "dark":
        r = max(1, int(round(size * BORDER)))
        ring = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
        rgb = rgb + np.array(DARK, np.float32)[None, None] / 255.0 * np.clip(ring - a, 0, 1)[..., None]
        a = np.maximum(a, ring)
    fill = np.dstack([rgb, a])
    sh = cv2.GaussianBlur(a, (0, 0), max(1.5, size * 0.06))
    shadow = np.zeros_like(fill)
    if edge == "dark":   # tight dark drop shadow
        sh = cv2.warpAffine(sh, np.float32([[1, 0, 0], [0, 1, size * 0.03]]), (cw, chh)) * 0.55
        shadow[..., 3] = sh
    elif edge == "light":  # soft white glow keeps ink text off busy bright backgrounds
        sh = cv2.GaussianBlur(a, (0, 0), max(2.0, size * 0.09)) * 0.6
        shadow[..., :3] = sh[..., None]; shadow[..., 3] = sh
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
    edge = p.get("edge", "dark")
    big = max(b["size"] for b in boxes)
    cw = int(max(b["w"] for b in boxes) + big * 3)
    chh = int(sum(b["size"] for b in boxes) * (1 + abs(p.get("gap", LINE_GAP))) + big * 3)
    canvas = np.zeros((chh, cw, 4), np.float32)
    ox, oy = cw / 2, chh / 2
    per_char = p["anim"] in CHAR_ANIMS
    if p.get("marker"):  # yellow highlighter band behind the word, wiping in from the left
        mx = ease_eval(marker_keys(p), t) / 100.0
        for b in boxes:
            if mx <= 0.002: break
            pad = b["size"] * 0.12
            x0 = int(ox - b["w"] / 2 - pad); x1 = int(x0 + (b["w"] + 2 * pad) * mx)
            yc = oy + b["cy"] + b["size"] * 0.12; hh = b["size"] * MARKER_H / 2
            canvas[int(yc - hh):int(yc + hh), x0:x1, :3] = np.array(YELLOW, np.float32) / 255
            canvas[int(yc - hh):int(yc + hh), x0:x1, 3] = 1
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
                spr = glyph(c["ch"], c["size"], col, edge, p["font"])[pass_]
                cdy, cs, ca = 0.0, 1.0, la
                if per_char:
                    amt = char_amount(p, gk + j, t)
                    if p["anim"] == "cascade": cdy = -0.9 * c["size"] * amt
                    elif p["anim"] == "type": cs = 1 + 0.3 * amt
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


def doodle_paths(d):
    """Polylines (lists of (x, y)) for a hand-drawn mark."""
    k = d["kind"]
    if k == "bang":  # three short strokes fanning out, like a manga exclamation
        out = []
        for da in (-24, 0, 24):
            a = math.radians(d["angle"] + da)
            out.append([(d["cx"] + math.cos(a) * d["r"] * f, d["cy"] + math.sin(a) * d["r"] * f) for f in (0.35, 1.0)])
        return out
    if k == "circle":  # a bit more than one turn, slightly wobbly
        pts = []
        for i in range(73):
            th = math.radians(-210 + i * 5.3)
            w = 1 + 0.05 * math.sin(3 * th)
            pts.append((d["cx"] + d["rx"] * w * math.cos(th), d["cy"] + d["ry"] * w * math.sin(th) - 6 * math.sin(th / 2)))
        return [pts]
    if k == "swoosh":
        n = 30
        return [[(d["x0"] + (d["x1"] - d["x0"]) * i / n, d["y"] + 9 * math.sin(i / n * math.pi * 2.2)) for i in range(n + 1)]]
    if k == "arrow":
        x0, y0, x1, y1 = d["x0"], d["y0"], d["x1"], d["y1"]
        mx, my = (x0 + x1) / 2 + (y1 - y0) * 0.25, (y0 + y1) / 2 - (x1 - x0) * 0.25
        body = [((1 - u) ** 2 * x0 + 2 * (1 - u) * u * mx + u * u * x1, (1 - u) ** 2 * y0 + 2 * (1 - u) * u * my + u * u * y1)
                for u in [i / 24 for i in range(25)]]
        ang = math.atan2(y1 - body[-3][1], x1 - body[-3][0])
        head = [[(x1 - math.cos(ang + s) * 55, y1 - math.sin(ang + s) * 55), (x1, y1)] for s in (0.5, -0.5)]
        return [body] + head
    raise ValueError(k)


def doodle_keys(d):
    return [[d["t0"], 0, "fast"], [d["t0"] + DOODLE_IN, 100, "lin"]]


DOODLE_W = 9


def draw_doodles(frame, t):
    for d in DOODLES:
        if not (d["t0"] <= t < d["t1"]): continue
        prog = ease_eval(doodle_keys(d), t) / 100.0
        alpha = clamp((d["t1"] - t) / EXIT)
        outline = DARK if d["color"] != DARK else WHITE
        layer = np.zeros((H, W), np.uint8); lo = np.zeros((H, W), np.uint8)
        for path in doodle_paths(d):
            seg = [math.dist(a, b) for a, b in zip(path, path[1:])]
            L, acc, pts = sum(seg) * prog, 0.0, [path[0]]
            for (a, b), sl in zip(zip(path, path[1:]), seg):
                if acc + sl <= L: pts.append(b); acc += sl
                else:
                    f = (L - acc) / sl if sl else 0
                    pts.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)); break
            arr = np.array([[int(x * 4), int(y * 4)] for x, y in pts], np.int32)
            cv2.polylines(lo, [arr], False, 255, DOODLE_W + 6, cv2.LINE_AA, shift=2)
            cv2.polylines(layer, [arr], False, 255, DOODLE_W, cv2.LINE_AA, shift=2)
        a_out = lo.astype(np.float32)[..., None] / 255 * alpha
        a_in = layer.astype(np.float32)[..., None] / 255 * alpha
        frame[:] = frame * (1 - a_out) + np.array(outline, np.float32) / 255 * a_out
        frame[:] = frame * (1 - a_in) + np.array(d["color"], np.float32) / 255 * a_in


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
        s = 1 + (DRIFT + 0.01 if p["anim"] != "static" else 0) + (0.12 if p.get("marker") else 0)
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
            draw_doodles(frame, t)
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
                behind=p["behind"], scale=tk["scale"], rot=tk["rot"], pos=tk["pos"],
                opacity=opacity_keys(p), bar=bar_keys(p) if p["bar"] else None, blur=blur_keys(p),
                motionBlur=p["anim"] in MOTION_BLUR, chStagger=char_timing(p)[0], chDur=char_timing(p)[1],
                edge=p.get("edge", "dark"), gap=p.get("gap", LINE_GAP), typeN=type_sweep(p)[0], typeT=type_sweep(p)[1],
                marker=marker_keys(p) if p.get("marker") else None)

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

function addGlow(L, size) {
    var ds = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    ds.property("ADBE Drop Shadow-0001").setValue([1, 1, 1, 1]);
    setMax(ds.property("ADBE Drop Shadow-0002"), 0.6);
    ds.property("ADBE Drop Shadow-0004").setValue(0);
    ds.property("ADBE Drop Shadow-0005").setValue(Math.max(6, size * 0.2));
}

function addRun(comp, text, size, color, edge, fontName) {
    var border = edge === "dark";
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
    else if (edge === "light") addGlow(L, size);
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

// type: characters appear one after another (index range selector sweeps over the word, scale 130% -> 100%)
function addType(L, run, p) {
    var pr = addAnimator(L, "Type", ["ADBE Text Scale 3D", "ADBE Text Opacity"]);
    pr("ADBE Text Scale 3D").setValue([130, 130, 100]);
    pr("ADBE Text Opacity").setValue(0);
    try {
        var mo = L.property("ADBE Text Properties").property("ADBE Text More Options");
        mo.property("ADBE Text Anchor Point Option").setValue(1);       // per character
        mo.property("ADBE Text Anchor Point Align").setValue([0, -45]); // scale around the glyph centre
    } catch (e) {}
    var ai = animators(L).numProperties;
    var sel = function () { return animators(L).property(ai).property("ADBE Text Selectors").property(1); };
    animators(L).property(ai).property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    sel().property("ADBE Text Range Advanced").property("ADBE Text Range Units").setValue(2);  // Index
    sel().property("ADBE Text Index End").setValue(run.n);
    var ta = p.t0 + p.typeT * run.k0 / p.typeN, tb = p.t0 + p.typeT * (run.k0 + run.n) / p.typeN;
    applyKeys(sel().property("ADBE Text Index Start"), [[ta, 0, "lin"], [tb, run.n, "lin"]]);
}

// highlighter band behind a word (shape layer under the text, wipes in from the left)
function addMarker(comp, nul, firstText, x, yc, w, size, keys, t0, t1) {
    var L = comp.layers.addShape();
    var root = L.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group");
    var g = function () { return root.property(1).property("ADBE Vectors Group"); };
    g().addProperty("ADBE Vector Shape - Rect"); g().addProperty("ADBE Vector Graphic - Fill");
    var h = size * DATA.markerH;
    g().property(1).property("ADBE Vector Rect Size").setValue([w, h]);
    g().property(1).property("ADBE Vector Rect Position").setValue([w / 2, 0]);
    g().property(2).property("ADBE Vector Fill Color").setValue(DATA.yellow);
    L.parent = nul;
    xf(L).property("ADBE Anchor Point").setValue([0, 0]);
    xf(L).property("ADBE Position").setValue([x, yc]);
    applyKeys(xf(L).property("ADBE Scale"), keys, function (v) { return [v, 100, 100]; });
    L.inPoint = t0; L.outPoint = t1;
    L.moveAfter(firstText);
    return L;
}

// hand-drawn marks: open paths stroked yellow / ink with an outline, drawn on with Trim Paths
function addDoodle(comp, d, idx) {
    var L = comp.layers.addShape();
    L.name = "DOODLE " + idx;
    var root = L.property("ADBE Root Vectors Group");
    for (var i = 0; i < d.paths.length; i++) {
        root.addProperty("ADBE Vector Group");
        var gi = root.numProperties;
        var c = function () { return root.property(gi).property("ADBE Vectors Group"); };
        c().addProperty("ADBE Vector Shape - Group");
        c().addProperty("ADBE Vector Graphic - Stroke");
        c().addProperty("ADBE Vector Graphic - Stroke");
        var s = new Shape(); s.vertices = d.paths[i]; s.closed = false;
        c().property(1).property("ADBE Vector Shape").setValue(s);
        var strokes = [[2, d.color, DATA.doodleW], [3, d.outline, DATA.doodleW + 6]];
        for (var k = 0; k < strokes.length; k++) {
            var st = c().property(strokes[k][0]);
            st.property("ADBE Vector Stroke Color").setValue(strokes[k][1]);
            st.property("ADBE Vector Stroke Width").setValue(strokes[k][2]);
            try { st.property("ADBE Vector Stroke Line Cap").setValue(2); st.property("ADBE Vector Stroke Line Join").setValue(2); } catch (e) {}
        }
    }
    root.addProperty("ADBE Vector Filter - Trim");
    applyKeys(root.property(root.numProperties).property("ADBE Vector Trim End"), d.keys);
    xf(L).property("ADBE Anchor Point").setValue([0, 0]);
    xf(L).property("ADBE Position").setValue([0, 0]);
    applyKeys(xf(L).property("ADBE Opacity"), [[d.t1 - 0.12, 100, "io"], [d.t1, 0, "lin"]]);
    L.inPoint = d.t0; L.outPoint = d.t1;
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
            var L = addRun(comp, run.text, line.size, run.accent ? p.accent : p.color, p.edge, p.font);
            L.startTime = 0; L.inPoint = p.t0; L.outPoint = p.t1;
            var r = L.sourceRectAtTime(p.t1 - 0.01, false);
            items.push({ layer: L, rect: r, x: lw, run: run });
            lw += r.width + line.size * DATA.tracking / 1000;
            top = -line.size * 0.88; bot = line.size * 0.12;   // em box around the baseline
        }
        lineBoxes.push({ items: items, width: lw - line.size * DATA.tracking / 1000, top: top, bot: bot,
                         size: line.size, keys: line.keys });
        totalH += (bot - top) + (li ? line.size * p.gap : 0);
    }
    var y = -totalH / 2;
    for (li = 0; li < lineBoxes.length; li++) {
        var lb = lineBoxes[li];
        if (li) y += lb.size * p.gap;
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
                else if (p.anim === "type") addType(it.layer, it.run, p);
                if (p.blur) addBlurIn(it.layer, p.blur);
                if (it.run.counter) addCounter(it.layer, it.run.counter);
                if (p.motionBlur || p.anim === "swipe") it.layer.motionBlur = true;
            } catch (e) { WARN.push(p.name + ": " + e.toString()); }
        }
        if (p.marker) {
            try {
                var pad = lb.size * 0.12;
                var mk = addMarker(comp, nul, lb.items[0].layer, -lb.width / 2 - pad, y + lb.size * 0.62,
                                   lb.width + 2 * pad, lb.size, p.marker, p.t0, p.t1);
                mk.name = "  " + p.name + " / highlighter";
                applyKeys(xf(mk).property("ADBE Opacity"), p.opacity);
            } catch (e3) { WARN.push(p.name + " highlighter: " + e3.toString()); }
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
    for (i = 0; i < DATA.doodles.length; i++) {
        try { addDoodle(comp, DATA.doodles[i], i + 1); } catch (e4) { WARN.push("doodle " + (i + 1) + ": " + e4.toString()); }
    }
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
             "Adobe Fonts の「凸版文久見出しゴシック」「凸版文久見出し明朝」を有効にしておくと、それが使われます。\n"
             "（無い場合は fonts フォルダの Zen Kaku Gothic Antique / しっぽり明朝 を使います。先にインストールしてください）\n"
             "次の画面で素材動画（編集前の高画質版）を選んでください。",
    "pick": "素材動画を選択",
    "fallback": "凸版文久見出しの書体が見つからなかったため、代わりのフォントを使いました: ",
    "done": "完成しました。赤い部分はリールのUIで隠れる範囲です（ガイドレイヤーなので書き出しには入りません）。",
}


def export_jsx(path, duration):
    data = dict(
        duration=round(duration, 3),
        telops=[jsx_phrase(p) for p in TELOPS],
        cards=[dict(t0=c["t0"], t1=c["t1"], bg=[v / 255 for v in c["bg"]], telop=jsx_phrase(c["telop"])) for c in CARDS],
        behindSegments=sorted({(p["t0"], p["t1"]) for p in TELOPS if p["behind"]}),
        doodles=[dict(t0=d["t0"], t1=d["t1"], paths=[[list(map(lambda v: round(v, 1), pt)) for pt in path]
                                                    for path in doodle_paths(d)],
                      color=[c / 255 for c in d["color"]],
                      outline=[c / 255 for c in (DARK if d["color"] != DARK else WHITE)], keys=doodle_keys(d))
                 for d in DOODLES],
        doodleW=DOODLE_W, markerH=MARKER_H, typeIn=TYPE_IN,
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
