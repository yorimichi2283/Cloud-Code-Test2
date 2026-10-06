"""Build the After Effects package for the IKEA soft-ice vlog.

One timeline spec drives everything:
  - ae_project/build_ikea_edit.jsx   ExtendScript that builds the comp inside After Effects
  - ae_project/matte/person_matte.mp4  luma matte of the person (for text-behind-person)
  - ae_project/sfx/*.wav             subtle synthesized SFX (+ pre-mixed track)
  - ae_project/preview.mp4           low-res preview of the design
and checks every telop against the Instagram Reels safe zone.

usage: python3 ikea_ae_build.py SRC.mp4 FONT_DIR OUT_DIR [--skip-matte] [--skip-preview]
"""
import os, sys, json, math, shutil, subprocess, functools
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
# Meta guidance for Reels: keep text out of top 14% (~250px), bottom 35% (~670px), sides 6% (~60px).
# The right edge also hosts the like/comment buttons, so keep a wider margin there.
SAFE = dict(left=60, top=250, right=W - 120, bottom=H - 670)
CX = (SAFE["left"] + SAFE["right"]) // 2  # horizontal center of the safe area (510)

WHITE, RUST, BEIGE, INK = (255, 255, 255), (162, 65, 37), (239, 233, 223), (40, 36, 34)
FONTS = {  # key -> (PostScript name for AE, ttf file)
    "gothic": ("RoundedMplus1c-Black", "MPLUSRounded1c_900Black.ttf"),
    "mincho": ("ShipporiMinchoB1-ExtraBold", "ShipporiMinchoB1_800ExtraBold.ttf"),
}

# ---------------------------------------------------------------- timeline spec
def T(t0, t1, text, x, y, size, color=WHITE, font="gothic", anim="fly", **kw):
    d = dict(t0=t0, t1=t1, text=text, x=x, y=y, size=size, color=color, font=font, anim=anim,
             frm=(0, -1), dist=600, dur=0.3, behind=False, rot=0.0, outline=0, tracking=-40,
             stagger=0.05, sfx=True)
    d.update(kw)
    return d

# source shots: 0-2.1 exterior / 2.1-8.7 talk / 8.7-14.23 kiosk / 14.23-17.37 kiosk scroll /
# 17.37-18.83 cone / 18.83-21.1 button / 21.1-24.4 dispensing / 24.4-27.0 eating /
# 27.0-28.77 looking up / 28.77-38.83 eating talk / 38.83-end close-up
TELOPS = [
    # exterior: title hook, IKEA letters drop in one by one + outline echo
    T(0.15, 2.1, "スウェーデンの", CX, 520, 120, WHITE, "mincho", "type", dur=0.5),
    T(0.40, 2.1, "IKEA", CX, 760, 360, WHITE, "gothic", "cascade", dist=420, dur=0.35, stagger=0.07),
    T(0.75, 2.1, "IKEA", CX + 22, 782, 360, WHITE, "gothic", "blur", outline=5, sfx=False),
    # intro talk: over the collar, under the chin
    T(2.30, 4.6, "本場の", 230, 905, 120, WHITE, "mincho", "blur", rot=-6),
    T(2.55, 4.6, "ソフト", CX, 1015, 230, RUST, "gothic", "fly", frm=(-1, 0), dist=900),
    T(2.85, 4.6, "クリーム", CX, 1150, 200, WHITE, "gothic", "fly", frm=(1, 0), dist=900),
    # kiosk
    T(8.90, 11.0, "注文は", CX, 520, 130, WHITE, "mincho", "type", dur=0.35),
    T(9.15, 11.0, "タッチパネル", CX, 700, 145, WHITE, "gothic", "fly", frm=(0, 1), dist=600),
    # price: giant 9 + rotated SEK + outline echo
    T(11.10, 14.23, "たったの", CX, 400, 130, WHITE, "mincho", "type", dur=0.4),
    T(11.40, 14.23, "9", 400, 760, 600, RUST, "gothic", "pop", dur=0.32),
    T(11.50, 14.23, "9", 428, 788, 600, RUST, "gothic", "blur", outline=6, sfx=False),
    T(11.70, 14.23, "SEK", 735, 760, 190, WHITE, "gothic", "fly", frm=(0, 1), dist=500, rot=-90),
    # kiosk scroll
    T(14.45, 17.37, "ちなみに", CX, 420, 120, WHITE, "mincho", "type", dur=0.4),
    T(14.75, 17.37, "シナモンロール", CX, 600, 126, WHITE, "gothic", "fly", frm=(1, 0), dist=900),
    T(15.10, 17.37, "7 SEK", CX, 830, 240, RUST, "gothic", "pop", dur=0.3),
    # button
    T(19.00, 21.1, "ボタンを", CX, 420, 140, WHITE, "mincho", "blur"),
    T(19.25, 21.1, "押すだけ", CX, 610, 215, WHITE, "gothic", "fly", frm=(0, 1), dist=600),
    T(19.70, 21.1, "ポチッ", 700, 880, 170, RUST, "gothic", "pop", rot=12, dur=0.25),
    # dispensing
    T(21.30, 23.2, "自動で", CX, 420, 140, WHITE, "mincho", "type", dur=0.35),
    T(21.60, 23.2, "出てくる", CX, 610, 240, WHITE, "gothic", "fly", frm=(-1, 0), dist=900),
    T(22.20, 23.2, "にゅ〜", 690, 880, 170, WHITE, "gothic", "blur", outline=5, rot=-10),
    T(23.30, 24.4, "完成", CX, 640, 400, RUST, "gothic", "pop", dur=0.3),
    T(23.40, 24.4, "完成", CX + 24, 664, 400, RUST, "gothic", "blur", outline=6, sfx=False),
    # looking up
    T(27.10, 28.77, "!!", 760, 470, 380, RUST, "gothic", "pop", rot=10, dur=0.28, tracking=-120),
    # eating talk: sign on the machine said "Vaniljglass" -> text play, behind the head
    T(28.90, 31.5, "VANILJ", CX, 440, 240, WHITE, "gothic", "blur", behind=True),
    T(29.15, 31.5, "GLASS", 885, 800, 150, RUST, "gothic", "fly", frm=(0, 1), dist=500, rot=-90),
    T(29.60, 31.5, "スウェーデン語でバニラアイス", CX, 1180, 66, WHITE, "mincho", "type", dur=0.6),
    # outro: close-up fills the top, so the title sits on the chest
    T(38.95, 42.3, "IKEA", CX, 985, 270, WHITE, "gothic", "cascade", dist=260, stagger=0.07),
    T(39.30, 42.3, "ソフトクリーム", CX, 1170, 126, RUST, "gothic", "fly", frm=(0, 1), dist=500),
]
CARDS = [
    dict(t0=6.60, t1=7.35, style="rust", telops=[T(6.60, 7.35, "食べてみた", CX, 760, 190, WHITE, "gothic", "cascade", dist=260, stagger=0.06)]),
    dict(t0=17.37, t1=18.10, style="beige", telops=[T(17.37, 18.10, "セルフ式", CX, 760, 215, RUST, "gothic", "cascade", dist=260)]),
    dict(t0=24.40, t1=25.15, style="rust", telops=[T(24.40, 25.15, "実食", CX, 760, 400, WHITE, "gothic", "cascade", dist=320, stagger=0.09)]),
]
BEHIND_SEGMENTS = sorted({(t["t0"], t["t1"]) for t in TELOPS if t["behind"]})

# ---------------------------------------------------------------- glyph rendering (preview + safe check)
FONT_DIR = None

def font_path(key): return os.path.join(FONT_DIR, FONTS[key][1])

def ease_out_expo(x): x = min(max(x, 0), 1); return 1 - 2 ** (-10 * x) if x < 1 else 1.0
def ease_out_back(x, s=1.9): x = min(max(x, 0), 1) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))

@functools.lru_cache(maxsize=1024)
def glyph_mask(text, font, size, outline, tracking):
    """Alpha mask of the text (float32) and per-char x centers relative to the mask center."""
    f = ImageFont.truetype(font_path(font), size)
    track = size * tracking / 1000.0
    adv = [f.getlength(c) for c in text]
    tw = sum(adv) + track * (len(text) - 1)
    asc, desc = f.getmetrics()
    pad = int(size * 0.3) + outline * 2
    cw, ch = int(tw) + pad * 2 + 1, asc + desc + pad * 2
    img = Image.new("L", (cw, ch), 0); d = ImageDraw.Draw(img)
    centers, x = [], pad
    for c, a in zip(text, adv):
        if outline:
            d.text((x, pad), c, font=f, fill=0, stroke_width=outline, stroke_fill=255)
        else:
            d.text((x, pad), c, font=f, fill=255)
        centers.append(x + a / 2 - cw / 2); x += a + track
    m = np.asarray(img, np.float32) / 255.0
    if outline:  # hollow
        inner = Image.new("L", (cw, ch), 0); di = ImageDraw.Draw(inner); x = pad
        for c, a in zip(text, adv):
            di.text((x, pad), c, font=f, fill=255); x += a + track
        m = np.clip(m - np.asarray(inner, np.float32) / 255.0, 0, 1)
    # recentre on the ink bounding box (AE anchors on sourceRect center)
    ys, xs = np.nonzero(m > 0.02)
    cx_ink, cy_ink = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    M = np.float32([[1, 0, cw / 2 - cx_ink], [0, 1, ch / 2 - cy_ink]])
    m = cv2.warpAffine(m, M, (cw, ch))
    centers = [c + cw / 2 - cx_ink for c in centers]
    return m, tuple(centers), (xs.max() - xs.min(), ys.max() - ys.min())


def sprite(text, font, size, color, outline, tracking, shadow=True):
    m, _, _ = glyph_mask(text, font, size, outline, tracking)
    h, w = m.shape
    out = np.zeros((h, w, 4), np.float32)
    if shadow:
        s = cv2.GaussianBlur(m, (0, 0), size * 0.09)
        s = cv2.warpAffine(s, np.float32([[1, 0, size * 0.02], [0, 1, size * 0.05]]), (w, h))
        out[..., 3] = np.clip(s * 0.62, 0, 0.75)
    col = np.array(color, np.float32) / 255.0
    out[..., :3] = col * m[..., None]
    out[..., 3] = out[..., 3] * (1 - m) + m
    return out


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
    s = spr
    if scale != 1.0 or rot:
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


def draw_telop(frame, o, t):
    if not (o["t0"] <= t < o["t1"]): return
    lt, dur = t - o["t0"], o["dur"]
    args = (o["font"], o["size"], o["color"], o["outline"], o["tracking"])
    p = lt / dur
    if o["anim"] == "type":
        n = max(1, int(math.ceil(clamp(p) * len(o["text"]))))
        full = sprite(o["text"], *args)
        part = sprite(o["text"][:n], *args)
        _, _, (fw, _) = glyph_mask(o["text"], o["font"], o["size"], o["outline"], o["tracking"])
        _, _, (pw, _) = glyph_mask(o["text"][:n], o["font"], o["size"], o["outline"], o["tracking"])
        composite(frame, part, o["x"] - fw / 2 + pw / 2, o["y"], rot=o["rot"])
    elif o["anim"] == "cascade":
        _, centers, _ = glyph_mask(o["text"], o["font"], o["size"], o["outline"], o["tracking"])
        full = sprite(o["text"], *args)
        for k, (c, ch) in enumerate(zip(centers, o["text"])):
            q = (lt - k * o["stagger"]) / dur
            if q <= 0: continue
            e = ease_out_back(q, 1.4)
            cs = sprite(ch, *args)
            composite(frame, cs, o["x"] + c, o["y"] - (1 - e) * o["dist"], alpha=clamp(q * 3))
    elif o["anim"] == "fly":
        spr = sprite(o["text"], *args)
        e, e2 = ease_out_expo(p), ease_out_expo(p + 1 / (FPS * dur))
        off, off2 = (1 - e) * o["dist"], (1 - e2) * o["dist"]
        fx, fy = o["frm"]
        composite(frame, spr, o["x"] + fx * off, o["y"] + fy * off, alpha=clamp(p * 4),
                  vel=(fx * (off - off2) * 1.6, fy * (off - off2) * 1.6), rot=o["rot"])
    elif o["anim"] == "blur":
        e = ease_out_expo(p)
        composite(frame, sprite(o["text"], *args), o["x"], o["y"], alpha=clamp(p * 2.2),
                  scale=1.18 - 0.18 * e, blur=(1 - e) * 22, rot=o["rot"])
    elif o["anim"] == "pop":
        composite(frame, sprite(o["text"], *args), o["x"], o["y"], alpha=clamp(p * 5),
                  scale=0.55 + 0.45 * ease_out_back(p), rot=o["rot"])


@functools.lru_cache(maxsize=4)
def card_base(style):
    if style == "rust":
        return np.ones((H, W, 3), np.float32) * np.array(RUST, np.float32) / 255
    img = np.ones((H, W, 3), np.float32) * np.array(BEIGE, np.float32) / 255
    ink = (np.array(INK, np.float32) / 255).tolist()
    for (x, y, sx, sy) in card_brackets():
        cv2.line(img, (x, y), (x + sx * 110, y), ink, 9); cv2.line(img, (x, y), (x, y + sy * 110), ink, 9)
    return img


def card_brackets():
    l, t, r, b = SAFE["left"] + 20, SAFE["top"] + 20, SAFE["right"] - 20, SAFE["bottom"] - 20
    return [(l, t, 1, 1), (r, t, -1, 1), (l, b, 1, -1), (r, b, -1, -1)]


def draw_card(frame, c, t):
    img = card_base(c["style"]).copy()
    if c["style"] == "rust":  # drifting soft diagonal light streaks
        lt = t - c["t0"]
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        band = 0.5 + 0.5 * np.sin(((xx * 0.8 + yy * 0.45) / 260.0 + lt * 0.6) * 2 * math.pi)
        band = cv2.resize(cv2.GaussianBlur(band, (0, 0), 6), (W, H))
        img *= (0.86 + 0.24 * band)[..., None]
    frame[:] = img
    for o in c["telops"]: draw_telop(frame, o, t)


# ---------------------------------------------------------------- safe-zone check
def check_safe_zone():
    bad = []
    for o in TELOPS + [o for c in CARDS for o in c["telops"]]:
        m, _, _ = glyph_mask(o["text"], o["font"], o["size"], o["outline"], o["tracking"])
        h, w = m.shape
        ys, xs = np.nonzero(m > 0.02)
        pts = np.stack([xs - w / 2, ys - h / 2], 1)
        a = math.radians(o["rot"])
        rx = pts[:, 0] * math.cos(a) - pts[:, 1] * math.sin(a) + o["x"]
        ry = pts[:, 0] * math.sin(a) + pts[:, 1] * math.cos(a) + o["y"]
        box = (rx.min(), ry.min(), rx.max(), ry.max())
        if box[0] < SAFE["left"] or box[1] < SAFE["top"] or box[2] > SAFE["right"] or box[3] > SAFE["bottom"]:
            bad.append((o["text"], o["t0"], [round(v) for v in box]))
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


# ---------------------------------------------------------------- SFX
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
def sfx_pop(d=0.11):
    t = np.arange(int(SR * d)) / SR; f = 520 * np.exp(-t * 18) + 240
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)
def sfx_thump(d=0.22):
    t = np.arange(int(SR * d)) / SR; f = 110 * np.exp(-t * 14) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 20)
def sfx_tick(d=0.012):
    n = int(SR * d); return np.random.default_rng(2).standard_normal(n) * np.exp(-np.arange(n) / (n / 4))

SFX_GAIN = dict(whoosh=0.16, pop=0.22, thump=0.35, tick=0.05, swell=0.08)

def sfx_events():
    ev = []
    for o in TELOPS + [o for c in CARDS for o in c["telops"]]:
        if not o["sfx"]: continue
        if o["anim"] in ("fly", "cascade"): ev.append(("whoosh", o["t0"] - 0.06))
        elif o["anim"] == "pop": ev.append(("pop", o["t0"]))
        elif o["anim"] == "blur": ev.append(("swell", o["t0"] - 0.05))
        elif o["anim"] == "type":
            n = len(o["text"])
            ev += [("tick", o["t0"] + o["dur"] * k / n) for k in range(n)]
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
    os.makedirs(out_dir, exist_ok=True)
    snd = dict(whoosh=sfx_whoosh(), pop=sfx_pop(), thump=sfx_thump(), tick=sfx_tick(),
               swell=sfx_whoosh(0.4)[::-1].copy())
    for k, v in snd.items(): write_wav(os.path.join(out_dir, f"{k}.wav"), v * SFX_GAIN[k] / max(SFX_GAIN.values()) * 0.9)
    track = np.zeros(int(SR * (dur + 1)))
    for k, t in sfx_events():
        i = max(0, int(t * SR)); s = snd[k] * SFX_GAIN[k]; track[i:i + len(s)] += s[:len(track) - i]
    write_wav(os.path.join(out_dir, "sfx_mix.wav"), track[:int(SR * dur)])
    return track[:int(SR * dur)]


# ---------------------------------------------------------------- preview
def render_preview(src, out, sfx_track, matte_path, scale=0.5):
    dur = probe_duration(src)
    a = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True).stdout
    orig = np.frombuffer(a, np.float32).reshape(-1, 2)
    sfx_track = np.pad(sfx_track, (0, max(0, len(orig) - len(sfx_track))))[:len(orig)]
    mix = np.clip(orig + sfx_track[:len(orig), None], -0.98, 0.98).astype(np.float32)
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
            behind = [o for o in TELOPS if o["behind"] and o["t0"] <= t < o["t1"]]
            if behind:
                m = np.frombuffer(mbuf, np.uint8).reshape(H, W).astype(np.float32)[..., None] / 255
                person = frame.copy()
                for o in behind: draw_telop(frame, o, t)
                frame = frame * (1 - m) + person * m
            for o in TELOPS:
                if not o["behind"]: draw_telop(frame, o, t)
        small = cv2.resize(frame, (ow, oh), interpolation=cv2.INTER_AREA)
        enc.stdin.write((np.clip(small, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()); i += 1
    enc.stdin.close(); enc.wait(); dec.wait(); mdec.wait(); os.remove(wav)


def probe_duration(src):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                                capture_output=True, text=True).stdout.strip())


# ---------------------------------------------------------------- After Effects ExtendScript
def jsx_telop(o):
    return dict(name=f'{o["t0"]:05.2f} {o["text"]}', t0=o["t0"], t1=o["t1"], text=o["text"], x=o["x"], y=o["y"],
                size=o["size"], color=[c / 255 for c in o["color"]], font=FONTS[o["font"]][0], anim=o["anim"],
                frm=list(o["frm"]), dist=o["dist"], dur=o["dur"], behind=o["behind"], rot=o["rot"],
                outline=o["outline"], tracking=o["tracking"], stagger=o["stagger"])

JSX_TEMPLATE = r"""// IKEA soft-ice vlog - After Effects builder (generated by ikea_ae_build.py)
// Run in After Effects: File > Scripts > Run Script File...
(function () {
var DATA = %(data)s;
var MSG = %(msg)s;
var W = 1080, H = 1920, FPS = 30;
var root = File($.fileName).parent;

function ease(prop, k, inInf, outInf) {
    var n = prop.value instanceof Array && !prop.isSpatial ? prop.value.length : 1;
    var ins = [], outs = [];
    for (var i = 0; i < n; i++) { ins.push(new KeyframeEase(0, inInf)); outs.push(new KeyframeEase(0, outInf)); }
    prop.setTemporalEaseAtKey(k, ins, outs);
}
function expoOut(prop) { // fast start, long soft landing
    ease(prop, 1, 33, 0.1); ease(prop, 2, 92, 33);
}
function setMax(prop, frac) { prop.setValue(prop.hasMax ? prop.maxValue * frac : frac * 100); }
function textProps(L) { return L.property("ADBE Text Properties"); }

function addDropShadow(L) {
    var ds = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    ds.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
    setMax(ds.property("ADBE Drop Shadow-0002"), 0.55);
    ds.property("ADBE Drop Shadow-0003").setValue(160);
    ds.property("ADBE Drop Shadow-0004").setValue(10);
    ds.property("ADBE Drop Shadow-0005").setValue(40);
}

function addTelop(comp, o) {
    var L = comp.layers.addText(o.text);
    L.name = o.name;
    var src = textProps(L).property("ADBE Text Document");
    var td = src.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    td.font = o.font;
    td.fontSize = o.size;
    td.tracking = o.tracking;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    if (o.outline > 0) {
        td.applyFill = false; td.applyStroke = true;
        td.strokeColor = o.color; td.strokeWidth = o.outline * 2; td.strokeOverFill = true;
    } else {
        td.applyFill = true; td.fillColor = o.color; td.applyStroke = false;
    }
    src.setValue(td);
    L.startTime = 0; L.inPoint = o.t0; L.outPoint = o.t1;
    var r = L.sourceRectAtTime(o.t1 - 0.01, false);
    var tr = L.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
    tr.property("ADBE Position").setValue([o.x, o.y]);
    tr.property("ADBE Rotate Z").setValue(o.rot);
    addDropShadow(L);
    animate(L, o);
    return L;
}

function opacityIn(L, t0, frames) {
    var op = L.property("ADBE Transform Group").property("ADBE Opacity");
    op.setValuesAtTimes([t0, t0 + frames / FPS], [0, 100]);
}

function addAnimator(L, name) {
    var anims = textProps(L).property("ADBE Text Animators");
    var a = anims.addProperty("ADBE Text Animator");
    a.name = name;
    return anims.numProperties;  // index (references get invalidated after adds)
}
function animatorAt(L, idx) { return textProps(L).property("ADBE Text Animators").property(idx); }

function animate(L, o) {
    var tr = L.property("ADBE Transform Group");
    var t0 = o.t0, t1 = o.t0 + o.dur;
    if (o.anim === "fly") {
        L.motionBlur = true;
        var pos = tr.property("ADBE Position");
        pos.setValuesAtTimes([t0, t1], [[o.x + o.frm[0] * o.dist, o.y + o.frm[1] * o.dist], [o.x, o.y]]);
        expoOut(pos);
        opacityIn(L, t0, 2);
    } else if (o.anim === "blur") {
        var sc = tr.property("ADBE Scale");
        sc.setValuesAtTimes([t0, t1], [[118, 118, 100], [100, 100, 100]]); expoOut(sc);
        opacityIn(L, t0, 6);
        var gb = L.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        var bl = gb.property("ADBE Gaussian Blur 2-0001");
        bl.setValuesAtTimes([t0, t1], [60, 0]); expoOut(bl);
        // keep the blur under the drop shadow so the shadow stays soft
        gb.moveTo(1);
    } else if (o.anim === "pop") {
        var sc2 = tr.property("ADBE Scale");
        sc2.setValuesAtTimes([t0, t0 + o.dur * 0.6, t1], [[55, 55, 100], [108, 108, 100], [100, 100, 100]]);
        ease(sc2, 1, 33, 0.1); ease(sc2, 2, 50, 50); ease(sc2, 3, 80, 33);
        opacityIn(L, t0, 2);
    } else if (o.anim === "type") {
        var i = addAnimator(L, "Typewriter");
        animatorAt(L, i).property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
        animatorAt(L, i).property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);
        animatorAt(L, i).property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        var sel = animatorAt(L, i).property("ADBE Text Selectors").property(1);
        sel.property("ADBE Text Range Advanced").property("ADBE Text Selector Smoothness").setValue(0);
        sel = animatorAt(L, i).property("ADBE Text Selectors").property(1);
        sel.property("ADBE Text Percent Start").setValuesAtTimes([t0, t1], [0, 100]);
    } else if (o.anim === "cascade") {
        L.motionBlur = true;
        var j = addAnimator(L, "Cascade");
        var props = animatorAt(L, j).property("ADBE Text Animator Properties");
        props.addProperty("ADBE Text Position 3D");
        animatorAt(L, j).property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
        props = animatorAt(L, j).property("ADBE Text Animator Properties");
        props.property("ADBE Text Position 3D").setValue([0, -o.dist, 0]);
        props.property("ADBE Text Opacity").setValue(0);
        animatorAt(L, j).property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        var s2 = animatorAt(L, j).property("ADBE Text Selectors").property(1);
        var adv = s2.property("ADBE Text Range Advanced");
        adv.property("ADBE Text Range Shape").setValue(2);       // Ramp Up
        adv.property("ADBE Text Levels Max Ease").setValue(100); // Ease High
        s2 = animatorAt(L, j).property("ADBE Text Selectors").property(1);
        var off = s2.property("ADBE Text Percent Offset");
        var total = o.dur + o.stagger * o.text.length;
        off.setValuesAtTimes([t0, t0 + total], [-100, 100]);
        ease(off, 1, 33, 0.1); ease(off, 2, 75, 33);
    }
}

// ---------- shape helpers
function shapeLayer(comp, name) {
    var L = comp.layers.addShape(); L.name = name;
    L.property("ADBE Transform Group").property("ADBE Position").setValue([0, 0]);
    return L;
}
function addRect(L, cx, cy, w, h, color, opacity) {
    var root = L.property("ADBE Root Vectors Group");
    var g = root.addProperty("ADBE Vector Group");
    var gi = root.numProperties;
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    var c = root.property(gi).property("ADBE Vectors Group");
    c.property(1).property("ADBE Vector Rect Size").setValue([w, h]);
    c.property(2).property("ADBE Vector Fill Color").setValue(color);
    c.property(2).property("ADBE Vector Fill Opacity").setValue(opacity);
    root.property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([cx, cy]);
}
function addPolyline(L, pts, color, width) {
    var root = L.property("ADBE Root Vectors Group");
    root.addProperty("ADBE Vector Group");
    var gi = root.numProperties;
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
    root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
    var c = root.property(gi).property("ADBE Vectors Group");
    var s = new Shape(); s.vertices = pts; s.closed = false;
    c.property(1).property("ADBE Vector Shape").setValue(s);
    c.property(2).property("ADBE Vector Stroke Color").setValue(color);
    c.property(2).property("ADBE Vector Stroke Width").setValue(width);
}

function addCard(comp, c, cardIndex) {
    var dur = comp.duration;
    var base = c.style === "rust" ? DATA.colors.rust : DATA.colors.beige;
    var solid = comp.layers.addSolid(base, "CARD " + (cardIndex + 1) + " bg", W, H, 1, dur);
    solid.inPoint = c.t0; solid.outPoint = c.t1;
    if (c.style === "rust") {
        // window-blind light: wide soft bands drifting diagonally
        var st = shapeLayer(comp, "CARD " + (cardIndex + 1) + " light streaks");
        for (var k = -6; k <= 6; k++) addRect(st, 540, 960 + k * 300, 3200, 120, k % 2 ? [1, 1, 1] : [0, 0, 0], 14);
        var tr = st.property("ADBE Transform Group");
        tr.property("ADBE Anchor Point").setValue([540, 960]);
        tr.property("ADBE Rotate Z").setValue(-30);
        tr.property("ADBE Position").setValuesAtTimes([c.t0, c.t1], [[540, 960], [610, 1000]]);
        st.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2")
          .property("ADBE Gaussian Blur 2-0001").setValue(90);
        st.inPoint = c.t0; st.outPoint = c.t1;
    } else {
        var br = shapeLayer(comp, "CARD " + (cardIndex + 1) + " corner brackets");
        for (var b = 0; b < DATA.brackets.length; b++) {
            var p = DATA.brackets[b];
            addPolyline(br, [[p[0] + p[2] * 110, p[1]], [p[0], p[1]], [p[0], p[1] + p[3] * 110]], DATA.colors.ink, 9);
        }
        br.inPoint = c.t0; br.outPoint = c.t1;
        var small = comp.layers.addText("SOFT ICE CREAM  \u30fb  IKEA SWEDEN");
        var sd = small.property("ADBE Text Properties").property("ADBE Text Document");
        var td = sd.value;
        td.font = DATA.fonts.mincho; td.fontSize = 30; td.tracking = 50; td.applyFill = true;
        td.fillColor = DATA.colors.ink; td.applyStroke = false;
        td.justification = ParagraphJustification.CENTER_JUSTIFY; sd.setValue(td);
        var r = small.sourceRectAtTime(c.t0, false);
        var tr2 = small.property("ADBE Transform Group");
        tr2.property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
        tr2.property("ADBE Position").setValue([DATA.safe.left + 55, (DATA.safe.top + DATA.safe.bottom) / 2]);
        tr2.property("ADBE Rotate Z").setValue(-90);
        tr2.property("ADBE Opacity").setValue(80);
        small.inPoint = c.t0; small.outPoint = c.t1; small.name = "CARD " + (cardIndex + 1) + " small text";
    }
    for (var i = 0; i < c.telops.length; i++) addTelop(comp, c.telops[i]);
}

function addSafeGuide(comp) {
    var g = shapeLayer(comp, "GUIDE  Reels safe zone (not rendered)");
    var s = DATA.safe, red = [1, 0.15, 0.15];
    addRect(g, W / 2, s.top / 2, W, s.top, red, 25);
    addRect(g, W / 2, (s.bottom + H) / 2, W, H - s.bottom, red, 25);
    addRect(g, s.left / 2, (s.top + s.bottom) / 2, s.left, s.bottom - s.top, red, 25);
    addRect(g, (s.right + W) / 2, (s.top + s.bottom) / 2, W - s.right, s.bottom - s.top, red, 25);
    g.guideLayer = true;
    return g;
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
            L.property("ADBE Transform Group").property("ADBE Scale").setValue([s, s, 100]);
        }
        return L;
    }
    addFootage("FOOTAGE (base)");

    // texts that sit behind the person
    for (var i = 0; i < DATA.telops.length; i++) if (DATA.telops[i].behind) addTelop(comp, DATA.telops[i]);

    // person cut-out on top of the behind-texts (footage x luma matte)
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

    // front texts
    for (var j = 0; j < DATA.telops.length; j++) if (!DATA.telops[j].behind) addTelop(comp, DATA.telops[j]);
    // insert cards
    for (var c = 0; c < DATA.cards.length; c++) addCard(comp, DATA.cards[c], c);

    // SFX
    var sfx = importFile(root.fsName + "/sfx/sfx_mix.wav");
    if (sfx) { sfx.parentFolder = folder; var sl = comp.layers.add(sfx); sl.name = "SFX mix"; }

    addSafeGuide(comp);
    comp.openInViewer();
    alert(MSG.done);
} catch (err) {
    alert("Error: " + err.toString() + " (line " + err.line + ")");
}
app.endUndoGroup();
})();
"""

MSG = {
    "intro": "IKEAソフトクリーム 編集プロジェクトを作ります。\n"
             "先に fonts フォルダの2つのフォントをインストールしておいてください。\n"
             "次の画面で素材動画（編集前の高画質版）を選んでください。",
    "pick": "素材動画を選択",
    "done": "完成しました。赤い部分はリールのUIで隠れる範囲です（ガイドレイヤーなので書き出しには入りません）。",
}


def export_jsx(path, duration):
    data = dict(
        duration=round(duration, 3),
        telops=[jsx_telop(o) for o in TELOPS],
        cards=[dict(t0=c["t0"], t1=c["t1"], style=c["style"], telops=[jsx_telop(o) for o in c["telops"]]) for c in CARDS],
        behindSegments=[list(s) for s in BEHIND_SEGMENTS],
        brackets=[list(b) for b in card_brackets()],
        safe=SAFE,
        colors=dict(rust=[c / 255 for c in RUST], beige=[c / 255 for c in BEIGE], ink=[c / 255 for c in INK]),
        fonts={k: v[0] for k, v in FONTS.items()},
    )
    js = (JSX_TEMPLATE.replace("%(data)s", json.dumps(data, ensure_ascii=True, indent=1))
          .replace("%(msg)s", json.dumps(MSG, ensure_ascii=True)))
    with open(path, "w", encoding="ascii") as f:
        f.write(js)


def main():
    global FONT_DIR
    src, FONT_DIR, out = sys.argv[1], sys.argv[2], sys.argv[3]
    model = os.environ.get("SEG_MODEL", "selfie_multiclass_256x256.tflite")
    os.makedirs(out, exist_ok=True)
    bad = check_safe_zone()
    if bad:
        print("SAFE ZONE VIOLATIONS:"); [print("  ", b) for b in bad]; sys.exit(1)
    print("safe zone: all telops inside", SAFE)
    dur = probe_duration(src)
    export_jsx(os.path.join(out, "build_ikea_edit.jsx"), dur)
    os.makedirs(os.path.join(out, "fonts"), exist_ok=True)
    for _, fn in FONTS.values(): shutil.copy(os.path.join(FONT_DIR, fn), os.path.join(out, "fonts", fn))
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
