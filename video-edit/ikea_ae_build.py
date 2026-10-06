"""Build the After Effects package for the IKEA soft-ice vlog (full-telop, per-character version).

One timeline spec drives everything:
  - ae_project/build_ikea_edit.jsx     ExtendScript that builds the comp inside After Effects
  - ae_project/matte/person_matte.mp4  luma matte of the person (for text-behind-person)
  - ae_project/sfx/*.wav               subtle synthesized SFX (+ pre-mixed track)
  - ae_project/preview.mp4             low-res preview of the design

Every character appears at the moment it is spoken (Whisper character timestamps in asr_chars.json,
aligned to the corrected caption text). The preview and the AE build share the same keyframe data,
so what the preview shows is what the script builds. Every telop is checked against the Reels safe zone.

usage: python3 ikea_ae_build.py SRC.mp4 FONT_DIR OUT_DIR [--skip-matte] [--skip-preview]
"""
import os, sys, re, json, math, shutil, difflib, subprocess, functools
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
# Meta guidance for Reels: keep text out of top 14% (~250px), bottom 35% (~670px), sides 6% (~60px).
# The right edge also hosts the like/comment buttons, so keep a wider margin there.
SAFE = dict(left=60, top=250, right=W - 120, bottom=H - 670)
CX = (SAFE["left"] + SAFE["right"]) // 2  # horizontal center of the safe area (510)

WHITE, YELLOW, DARK = (255, 255, 255), (255, 210, 31), (30, 28, 26)
FONT = ("RoundedMplus1c-Black", "MPLUSRounded1c_900Black.ttf")  # (PostScript name for AE, ttf file)
TRACKING = -30          # AE tracking units (1/1000 em)
BASE_Y, BIG_Y = 1150, 985
BASE_SIZE, BIG_SIZE = 84, 190
MAX_LINE_W = 780          # leaves room for the slow push-in and the slam overshoot
BORDER = 0.022          # dark border width, as a fraction of the font size (thin)
LINE_GAP = 0.12         # extra space between stacked lines, fraction of the size
DRIFT = 0.035           # slow push-in while a telop is on screen (scale 100% -> 103.5%)
EXIT = 0.10             # fade-out length at the end of every telop
CHAR_IN = 0.16          # how long one character takes to animate in
LEAD = 0.03             # characters start this much before they are spoken

# Per-character reveal styles: the "hidden" state of a character; the animator blends from it to rest.
# dy is in units of the font size; scale in %; blur in units of the font size; rot in degrees.
STYLES = {
    "rise":  dict(dy=0.45, opacity=0, scale=70),
    "drop":  dict(dy=-0.6, opacity=0, scale=100),
    "pop":   dict(dy=0.0, opacity=0, scale=0),
    "blur":  dict(dy=0.0, opacity=0, scale=140, blur=0.22),
    "spin":  dict(dy=0.1, opacity=0, scale=40, rot=-70),
}

# ---------------------------------------------------------------- timeline spec
# Markup: text in [brackets] is the accent colour. "/" starts a new line; a line may carry its own
# size as "size:text".
# anim: reveal (per-character, at speech timing, with `style`), slam (whole telop smashes in and
# shakes), slide (whole telop slides in with motion blur), wave (reveal + characters keep bobbing).
def P(t0, t1, text, kind="base", **kw):
    d = dict(t0=t0, t1=t1, text=text, kind=kind, x=CX, rot=0.0, behind=False, sfx=True,
             color=WHITE, accent=YELLOW, anim="reveal", style="rise", frm=(1, 0), dist=700, dur=0.22)
    if kind == "base": d.update(y=BASE_Y, size=BASE_SIZE, sfx=False)
    elif kind == "big": d.update(y=BIG_Y, size=BIG_SIZE, anim="slam")
    d.update(kw)
    return d

TELOPS = [
    # 0-2.1 exterior
    P(0.20, 2.10, "100:スウェーデンの/230:[イケア]を", "big", y=700, size=0, anim="reveal", style="drop"),
    P(0.76, 1.18, "見つけたんで"),
    P(1.18, 2.10, "行ってみたいと思います"),
    # 2.1-8.7 intro talk
    P(2.38, 2.84, "日本だと", style="pop"),
    P(2.84, 3.16, "イケアの", style="pop"),
    P(3.16, 3.70, "ソフトクリームって", style="pop"),
    P(3.70, 4.38, "1個[50円]", "big"),
    P(4.38, 5.20, "だと思うんですけど"),
    P(5.66, 6.02, "実際", style="blur"),
    P(6.02, 7.22, "本場のイケアは"),
    P(7.75, 8.04, "買えるのかを"),
    P(8.04, 8.80, "見てみます"),
    # 8.7-14.2 kiosk
    P(8.98, 10.22, "アイスクリーム", style="pop"),
    P(10.22, 11.74, "[9]なんで", "big", rot=-2),
    P(11.74, 12.96, "[150円]", "big", size=210, y=950, x=CX - 30, anim="slide", frm=(1, 0)),
    P(12.10, 12.96, "ぐらいで買えるわ"),
    P(12.96, 13.74, "これ普通に", style="pop"),
    P(13.74, 14.38, "[安い]んじゃない？", "big", size=150, rot=-3, anim="wave", style="pop"),
    # 14.2-17.4 kiosk scroll
    P(14.38, 15.54, "このシナモンロールは"),
    P(15.54, 16.72, "1個[112円]", "big"),
    P(16.72, 17.50, "で買えますね"),
    # 17.4-24.4 machine
    P(17.76, 18.80, "セットして", style="drop"),
    P(19.16, 20.08, "あとはここを"),
    P(20.08, 21.00, "[押すだけ]ですね", "big", size=150, rot=2),
    P(23.04, 24.00, "自動でやってくれる", style="blur"),
    # 24.4- eating
    P(24.84, 26.04, "実際に"),
    P(26.04, 26.95, "90:アイスクリーム/190:[食べます]", "big", anim="reveal", style="drop"),
    P(29.48, 30.48, "口の中に入れた", style="blur"),
    P(30.48, 31.30, "瞬間に", style="pop"),
    P(31.90, 32.78, "[うわっ！]って", "big", size=200, rot=-4, x=CX + 20, anim="wave", style="pop"),
    P(32.78, 33.68, "色々うまい"),
    P(33.68, 34.16, "アイスクリーム", style="pop"),
    P(34.16, 35.00, "あるじゃないですか"),
    P(35.14, 36.18, "まあハーゲンダッツの"),
    P(36.18, 37.40, "[5倍濃縮]", "big", y=400, size=210, anim="reveal", style="drop", behind=True),
    P(36.84, 37.28, "したみたいな", style="pop"),
    P(37.28, 38.00, "感じの味がします"),
    P(38.00, 38.60, "これ", style="pop"),
    P(39.24, 39.68, "意外とね", style="spin"),
    P(39.68, 40.42, "[リーズナブル]なので", "big", size=120),
    P(40.42, 42.30, "ぜひ食べてみてください"),
]

CARDS = [
    # covers "いくらぐらいで" - the question the video is about
    dict(t0=7.22, t1=7.75, bg=YELLOW, telop=P(7.22, 7.75, "いくら？", "big", x=CX, y=760, size=240, color=DARK,
                                              accent=DARK, dur=0.2)),
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


def plain(p): return "".join(t for _, runs in parse_lines(p) for t, _ in runs)

# ---------------------------------------------------------------- speech timing
@functools.lru_cache(maxsize=1)
def asr_chars():
    return json.load(open(os.path.join(HERE, "asr_chars.json"), encoding="utf-8"))


def char_times(p):
    """Spoken time of every character of the telop, aligned to the ASR character stream."""
    text = plain(p)
    win = [c for c in asr_chars() if p["t0"] - 0.4 <= c[1] <= p["t1"] + 0.4]
    ref = "".join(c[0] for c in win)
    times = [None] * len(text)
    for a, b, n in difflib.SequenceMatcher(None, text, ref, autojunk=False).get_matching_blocks():
        for k in range(n): times[a + k] = win[b + k][1]
    # fill gaps: interpolate between known neighbours, else spread from t0 at speaking pace
    known = [i for i, v in enumerate(times) if v is not None]
    for i in range(len(times)):
        if times[i] is not None: continue
        prev = max([k for k in known if k < i], default=None)
        nxt = min([k for k in known if k > i], default=None)
        if prev is not None and nxt is not None:
            times[i] = times[prev] + (times[nxt] - times[prev]) * (i - prev) / (nxt - prev)
        elif prev is not None:
            times[i] = times[prev] + 0.07 * (i - prev)
        elif nxt is not None:
            times[i] = max(p["t0"], times[nxt] - 0.07 * (nxt - i))
        else:
            times[i] = p["t0"] + 0.07 * i
    out, last = [], p["t0"] - LEAD
    limit = p["t1"] - EXIT - CHAR_IN
    for v in times:
        v = min(max(v - LEAD, last, p["t0"]), max(limit, p["t0"]))
        out.append(v); last = v
    return out


def reveal_keys(times):
    """Piecewise-linear index 'start' of a range selector: char k animates in from times[k]."""
    keys = []
    n = len(times)
    for k, t in enumerate(times):
        nxt = times[k + 1] if k + 1 < n else t + CHAR_IN
        if keys and t <= keys[-1][0] + 1e-4:
            keys[-1] = [keys[-1][0], k]  # collapsed timing: just keep the higher value
        else:
            keys.append([t, k])
        keys.append([max(min(t + CHAR_IN, nxt), t + 1 / FPS), k + 1])
    clean = []
    for t, v in keys:  # strictly increasing times
        if clean and t <= clean[-1][0] + 1e-4: clean[-1][1] = max(clean[-1][1], v)
        else: clean.append([round(t, 4), v])
    return clean


def lerp_keys(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    for (t0, v0, *_), (t1, v1, *_) in zip(keys, keys[1:]):
        if t <= t1: return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return keys[-1][1]

# ---------------------------------------------------------------- whole-telop keyframes (null layer)
# key = [time, value, ease_out_of_this_key]   ease: "lin" | "fast" (expo-like ease-out) | "io"
def telop_keys(p):
    t0, t1, d, r = p["t0"], p["t1"], p["dur"], p["rot"]
    end = max(t1, t0 + d + 0.05)
    scale = [[t0, 100, "lin"], [end, 100 * (1 + DRIFT), "lin"]]
    rot = [[t0, r, "lin"]]
    pos = [[t0, [p["x"], p["y"]], "lin"]]
    if p["anim"] == "slam":
        scale = [[t0, 230, "fast"], [t0 + d * 0.6, 94, "io"], [t0 + d, 100, "lin"], [end, 100 * (1 + DRIFT), "lin"]]
        s = t0 + d
        rot = [[s, r, "io"], [s + 0.04, r - 5, "io"], [s + 0.08, r + 4, "io"], [s + 0.12, r - 2, "io"],
               [s + 0.16, r, "lin"]]
    elif p["anim"] == "slide":
        fx, fy = p["frm"]
        pos = [[t0, [p["x"] + fx * p["dist"], p["y"] + fy * p["dist"]], "fast"], [t0 + d, [p["x"], p["y"]], "lin"]]
    return dict(scale=scale, rot=rot, pos=pos)


def ease_eval(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    for (ta, va, e), (tb, vb, _) in zip(keys, keys[1:]):
        if t <= tb:
            x = (t - ta) / (tb - ta)
            u = x if e == "lin" else (1 - (1 - x) ** 4 if e == "fast" else x * x * (3 - 2 * x))
            if isinstance(va, list): return [a + (b - a) * u for a, b in zip(va, vb)]
            return va + (vb - va) * u
    return keys[-1][1]


def opacity_keys(p):
    """Per text layer: quick fade-in for whole-telop entrances, short fade-out at the end."""
    k = []
    if p["anim"] in ("slam", "slide"): k += [[p["t0"], 0, "lin"], [p["t0"] + 2 / FPS, 100, "lin"]]
    k += [[p["t1"] - EXIT, 100, "lin"], [p["t1"], 0, "lin"]]
    return k

# ---------------------------------------------------------------- layout + glyphs
FONT_DIR = None

@functools.lru_cache(maxsize=None)
def font(size): return ImageFont.truetype(os.path.join(FONT_DIR, FONT[1]), size)


def advance(ch, size): return font(size).getlength(ch) + size * TRACKING / 1000.0


def fit_sizes(p):
    """Shrink lines that would not fit the safe width."""
    parts, changed = [], False
    for size, runs in parse_lines(p):
        w = sum(advance(c, size) for t, _ in runs for c in t)
        new = int(size * MAX_LINE_W / w) if w > MAX_LINE_W else size
        changed |= new != size
        parts.append((new, runs))
    if not changed: return
    if len(parts) == 1: p["size"] = parts[0][0]
    else: p["text"] = "/".join(f"{sz}:" + "".join(f"[{t}]" if a else t for t, a in runs) for sz, runs in parts)


def layout(p):
    """Characters with their centre relative to the telop centre."""
    lines = parse_lines(p)
    heights = [s for s, _ in lines]
    total = sum(heights) + sum(s * LINE_GAP for s in heights[1:])
    y = -total / 2
    chars, k = [], 0
    for li, (size, runs) in enumerate(lines):
        if li: y += size * LINE_GAP
        width = sum(advance(c, size) for t, _ in runs for c in t) - size * TRACKING / 1000.0
        x = -width / 2
        for ri, (t, acc) in enumerate(runs):
            for c in t:
                a = advance(c, size)
                chars.append(dict(ch=c, x=x + (a - size * TRACKING / 1000.0) / 2, y=y + size / 2, size=size,
                                  accent=acc, line=li, run=ri, idx=k))
                x += a; k += 1
        y += size
    return chars


@functools.lru_cache(maxsize=None)
def glyph(ch, size, color, border):
    """(fill_sprite, shadow_sprite) premultiplied RGBA, centred on the character cell."""
    f = font(size)
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
    sh = cv2.warpAffine(sh, np.float32([[1, 0, 0], [0, 1, size * 0.03]]), (cw, chh)) * 0.55
    shadow = np.zeros_like(fill); shadow[..., 3] = sh
    # centre of the character cell (advance / 2, middle of the em box)
    cx, cy = pad + adv / 2, pad + asc - size / 2 + size * 0.06
    M = np.float32([[1, 0, cw / 2 - cx], [0, 1, chh / 2 - cy]])
    return cv2.warpAffine(fill, M, (cw, chh)), cv2.warpAffine(shadow, M, (cw, chh))


def motion_blur(spr, dx, dy):
    L = int(math.hypot(dx, dy))
    if L < 2: return spr
    L = min(L, 160)
    k = np.zeros((L * 2 + 1, L * 2 + 1), np.float32)
    ux, uy = dx / math.hypot(dx, dy), dy / math.hypot(dx, dy)
    for i in range(L + 1):
        t = i - L / 2
        k[int(round(L + uy * t)), int(round(L + ux * t))] = 1
    k /= k.sum()
    return cv2.filter2D(cv2.copyMakeBorder(spr, L, L, L, L, cv2.BORDER_CONSTANT, value=0), -1, k)


def composite(frame, spr, cx, cy, alpha=1.0, scale=1.0, blur=0.0, vel=(0, 0), rot=0.0):
    if alpha <= 0.003 or scale <= 0.01: return
    s = spr
    if abs(scale - 1.0) > 1e-3 or rot:
        h, w = s.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), -rot, scale)
        side = int(math.hypot(w, h) * max(scale, 1)) + 2
        M[0, 2] += (side - w) / 2; M[1, 2] += (side - h) / 2
        s = cv2.warpAffine(s, M, (side, side), flags=cv2.INTER_LINEAR)
    if blur > 0.3: s = cv2.GaussianBlur(s, (0, 0), blur)
    if vel != (0, 0): s = motion_blur(s, *vel)
    if alpha < 1: s = s * alpha
    h, w = s.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    sub = s[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    reg = frame[fy0:fy1, fx0:fx1]
    reg *= (1 - sub[..., 3:4]); reg += sub[..., :3]


def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))


@functools.lru_cache(maxsize=None)
def _cached(pid):
    p = ALL[pid]
    return layout(p), reveal_keys(char_times(p)), telop_keys(p), opacity_keys(p)


def draw_phrase(frame, p, t):
    if not (p["t0"] <= t < p["t1"]): return
    chars, rkeys, tk, okeys = _cached(id(p))
    S = ease_eval(tk["scale"], t) / 100.0
    R = ease_eval(tk["rot"], t)
    PX, PY = ease_eval(tk["pos"], t)
    PX2, PY2 = ease_eval(tk["pos"], t + 1 / FPS)
    vel = ((PX2 - PX) * 0.8, (PY2 - PY) * 0.8) if p["anim"] == "slide" else (0, 0)
    alpha = lerp_keys(okeys, t) / 100.0
    per_char = p["anim"] in ("reveal", "wave")
    st = STYLES[p["style"]]
    start = lerp_keys(rkeys, t) if per_char else len(chars)
    cr, sr = math.cos(math.radians(R)), math.sin(math.radians(R))
    border = p["color"] != DARK
    items = []
    for c in chars:
        amt = 1 - smooth(start - c["idx"]) if per_char else 0.0  # 1 = hidden state, 0 = at rest
        dx, dy = 0.0, st["dy"] * c["size"] * amt if per_char else 0.0
        if p["anim"] == "wave":
            dy += -0.10 * c["size"] * math.sin(2 * math.pi * 2.2 * t + c["idx"] * 1.1)
        cs = (1 + (st["scale"] / 100.0 - 1) * amt) if per_char else 1.0
        ca = alpha * (1 - amt * (1 - st["opacity"] / 100.0))
        crot = st.get("rot", 0) * amt
        cblur = st.get("blur", 0) * c["size"] * amt * S * 0.5
        lx, ly = (c["x"] + dx) * S, (c["y"] + dy) * S
        X, Y = PX + lx * cr - ly * sr, PY + lx * sr + ly * cr
        col = p["accent"] if c["accent"] else p["color"]
        fill, shadow = glyph(c["ch"], c["size"], col, border)
        items.append((fill, shadow, X, Y, ca, S * cs, cblur, R + crot))
    for fill, shadow, X, Y, a, s, b, r in items:
        composite(frame, shadow, X, Y, a, s, b, vel, r)
    for fill, shadow, X, Y, a, s, b, r in items:
        composite(frame, fill, X, Y, a, s, b, vel, r)


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

# ---------------------------------------------------------------- safe-zone check
def all_phrases(): return TELOPS + [c["telop"] for c in CARDS]
ALL = {}


def check_safe_zone():
    bad = []
    for p in all_phrases():
        chars = layout(p)
        s = 1 + DRIFT + (0.06 if p["anim"] == "slam" else 0)
        r = math.radians(p["rot"] + (5 if p["anim"] == "slam" else 0) * (1 if p["rot"] >= 0 else -1))
        xs, ys = [], []
        for c in chars:
            hw = advance(c["ch"], c["size"]) / 2 + c["size"] * BORDER
            hh = c["size"] * 0.5 + c["size"] * BORDER
            wave = 0.1 * c["size"] if p["anim"] == "wave" else 0
            for ox, oy in [(-hw, -hh - wave), (hw, -hh - wave), (-hw, hh + wave), (hw, hh + wave)]:
                lx, ly = (c["x"] + ox) * s, (c["y"] + oy) * s
                xs.append(p["x"] + lx * math.cos(r) - ly * math.sin(r))
                ys.append(p["y"] + lx * math.sin(r) + ly * math.cos(r))
        box = (min(xs), min(ys), max(xs), max(ys))
        if box[0] < SAFE["left"] or box[1] < SAFE["top"] or box[2] > SAFE["right"] or box[3] > SAFE["bottom"]:
            bad.append((p["text"], p["t0"], [round(v) for v in box]))
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
def sfx_thump(d=0.22):
    t = np.arange(int(SR * d)) / SR; f = 110 * np.exp(-t * 14) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 20)

SFX_GAIN = dict(whoosh=0.13, pop=0.14, thump=0.30)

def sfx_events():
    ev = []
    for p in TELOPS:
        if not p["sfx"]: continue
        if p["anim"] == "slide": ev.append(("whoosh", p["t0"] - 0.06))
        elif p["anim"] in ("slam", "wave"): ev.append(("pop", p["t0"]))
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
    snd = dict(whoosh=sfx_whoosh(), pop=sfx_pop(), thump=sfx_thump())
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
    chars, rkeys, tk, okeys = _cached(id(p))
    per_char = p["anim"] in ("reveal", "wave")
    lines = []
    for li, (size, runs) in enumerate(parse_lines(p)):
        jr = []
        for ri, (text, acc) in enumerate(runs):
            idx = [c["idx"] for c in chars if c["line"] == li and c["run"] == ri]
            k0, n = idx[0], len(idx)
            keys = []
            if per_char:  # this run's own index space: clamp(start - k0, 0, n)
                pts = sorted({round(t, 4) for t, _ in rkeys})
                for t in pts:
                    v = min(max(lerp_keys(rkeys, t) - k0, 0), n)
                    if len(keys) >= 2 and keys[-1][1] == v and keys[-2][1] == v: keys[-1][0] = t
                    else: keys.append([t, round(v, 4)])
            jr.append(dict(text=text, accent=acc, n=n, keys=keys))
        lines.append(dict(size=size, runs=jr))
    name = re.sub(r"[\[\]]|\d+:", "", p["text"]).replace("/", " ")
    st = STYLES[p["style"]]
    return dict(name=f'{p["t0"]:05.2f} {name}', t0=p["t0"], t1=p["t1"], lines=lines, anim=p["anim"],
                style=dict(dy=st["dy"], opacity=st["opacity"], scale=st["scale"], blur=st.get("blur", 0),
                           rot=st.get("rot", 0)),
                color=[c / 255 for c in p["color"]], accent=[c / 255 for c in p["accent"]],
                border=p["color"] != DARK, behind=p["behind"], scale=tk["scale"], rot=tk["rot"], pos=tk["pos"],
                opacity=okeys)

JSX_TEMPLATE = r"""// IKEA soft-ice vlog - After Effects builder (generated by ikea_ae_build.py)
// Run in After Effects: File > Scripts > Run Script File...
(function () {
var DATA = %(data)s;
var MSG = %(msg)s;
var W = 1080, H = 1920, FPS = 30;
var root = File($.fileName).parent;
var WARN = [];

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
function sc3(v) { return [v, v, 100]; }

function addShadow(L, size) {
    var ds = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    ds.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
    setMax(ds.property("ADBE Drop Shadow-0002"), 0.55);
    ds.property("ADBE Drop Shadow-0003").setValue(180);
    ds.property("ADBE Drop Shadow-0004").setValue(Math.max(2, size * 0.03));
    ds.property("ADBE Drop Shadow-0005").setValue(Math.max(4, size * 0.12));
}

function addRun(comp, text, size, color, border) {
    var L = comp.layers.addText(text);
    var src = L.property("ADBE Text Properties").property("ADBE Text Document");
    var td = src.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    td.font = DATA.font; td.fontSize = size; td.tracking = DATA.tracking;
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

// Per-character reveal: animator holds the hidden state; an index range selector's Start walks over the
// characters at the moment each one is spoken.
function addReveal(L, run, size, st) {
    // scale / rotate each character around its own centre instead of its baseline
    try {
        var mo = L.property("ADBE Text Properties").property("ADBE Text More Options");
        mo.property("ADBE Text Anchor Point Option").setValue(1);      // Character
        mo.property("ADBE Text Anchor Point Align").setValue([0, -45]);
    } catch (e) { WARN.push("grouping alignment: " + e.toString()); }
    animators(L).addProperty("ADBE Text Animator");
    var ai = animators(L).numProperties;
    function A() { return animators(L).property(ai); }
    A().name = "Reveal (speech timed)";
    var names = ["ADBE Text Position 3D", "ADBE Text Scale 3D", "ADBE Text Opacity"];
    if (st.rot) names.push("ADBE Text Rotation");
    if (st.blur) names.push("ADBE Text Blur");
    for (var i = 0; i < names.length; i++) A().property("ADBE Text Animator Properties").addProperty(names[i]);
    var pr = function (n) { return A().property("ADBE Text Animator Properties").property(n); };
    pr("ADBE Text Position 3D").setValue([0, st.dy * size, 0]);
    pr("ADBE Text Scale 3D").setValue([st.scale, st.scale, 100]);
    pr("ADBE Text Opacity").setValue(st.opacity);
    if (st.rot) pr("ADBE Text Rotation").setValue(st.rot);
    if (st.blur) pr("ADBE Text Blur").setValue([st.blur * size * 0.5, st.blur * size * 0.5]);
    A().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
    var sel = function () { return A().property("ADBE Text Selectors").property(1); };
    sel().property("ADBE Text Range Advanced").property("ADBE Text Range Units").setValue(2);  // Index
    sel().property("ADBE Text Index End").setValue(run.n);
    var start = sel().property("ADBE Text Index Start");
    for (var k = 0; k < run.keys.length; k++) start.setValueAtTime(run.keys[k][0], run.keys[k][1]);
    for (k = 1; k <= start.numKeys; k++)
        start.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
}

function addWave(L, size) {
    try {
        animators(L).addProperty("ADBE Text Animator");
        var ai = animators(L).numProperties;
        function A() { return animators(L).property(ai); }
        A().name = "Wave";
        A().property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
        A().property("ADBE Text Animator Properties").property("ADBE Text Position 3D").setValue([0, -size * 0.1, 0]);
        A().property("ADBE Text Selectors").addProperty("ADBE Text Wiggly Selector");
        var w = A().property("ADBE Text Selectors").property(1);
        try { w.property("ADBE Text Wiggly Rate").setValue(2.2); } catch (e1) {}
        try { w.property("ADBE Text Wiggly Correlation").setValue(30); } catch (e2) {}
    } catch (e) { WARN.push("wave: " + e.toString()); }
}

// One telop = a null (scale / rotation / position animation) + one text layer per colour run.
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
            var L = addRun(comp, run.text, line.size, run.accent ? p.accent : p.color, p.border);
            L.startTime = 0; L.inPoint = p.t0; L.outPoint = p.t1;
            var r = L.sourceRectAtTime(p.t1 - 0.01, false);
            items.push({ layer: L, rect: r, x: lw, run: run });
            lw += r.width + line.size * DATA.tracking / 1000;
            top = Math.min(top, r.top); bot = Math.max(bot, r.top + r.height);
        }
        lineBoxes.push({ items: items, width: lw - line.size * DATA.tracking / 1000, top: top, bot: bot, size: line.size });
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
            if (p.anim === "reveal" || p.anim === "wave") {
                try { addReveal(it.layer, it.run, lb.size, p.style); } catch (e) { WARN.push(p.name + ": " + e.toString()); }
            }
            if (p.anim === "wave") addWave(it.layer, lb.size);
            if (p.anim === "slide") it.layer.motionBlur = true;
        }
        y += lb.bot - lb.top;
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
             "先に fonts フォルダのフォントをインストールしておいてください。\n"
             "次の画面で素材動画（編集前の高画質版）を選んでください。",
    "pick": "素材動画を選択",
    "done": "完成しました。赤い部分はリールのUIで隠れる範囲です（ガイドレイヤーなので書き出しには入りません）。",
}


def export_jsx(path, duration):
    data = dict(
        duration=round(duration, 3),
        telops=[jsx_phrase(p) for p in TELOPS],
        cards=[dict(t0=c["t0"], t1=c["t1"], bg=[v / 255 for v in c["bg"]], telop=jsx_phrase(c["telop"])) for c in CARDS],
        behindSegments=sorted({(p["t0"], p["t1"]) for p in TELOPS if p["behind"]}),
        safe=SAFE, font=FONT[0], tracking=TRACKING, border=BORDER, lineGap=LINE_GAP, dark=[c / 255 for c in DARK],
    )
    js = (JSX_TEMPLATE.replace("%(data)s", json.dumps(data, ensure_ascii=True, indent=1))
          .replace("%(msg)s", json.dumps(MSG, ensure_ascii=True)))
    with open(path, "w", encoding="ascii") as f:
        f.write(js)


def prepare(font_dir):
    global FONT_DIR
    FONT_DIR = font_dir
    for p in all_phrases():
        fit_sizes(p)
        ALL[id(p)] = p


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
    if os.path.isdir(fdir):
        for fn in os.listdir(fdir):
            if fn.endswith(".ttf") and fn != FONT[1]: os.remove(os.path.join(fdir, fn))
    os.makedirs(fdir, exist_ok=True)
    shutil.copy(os.path.join(FONT_DIR, FONT[1]), os.path.join(fdir, FONT[1]))
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
