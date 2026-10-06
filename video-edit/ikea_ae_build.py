"""Build the After Effects package for the IKEA soft-ice vlog (full-telop version).

One timeline spec drives everything:
  - ae_project/build_ikea_edit.jsx     ExtendScript that builds the comp inside After Effects
  - ae_project/matte/person_matte.mp4  luma matte of the person (for text-behind-person)
  - ae_project/sfx/*.wav               subtle synthesized SFX (+ pre-mixed track)
  - ae_project/preview.mp4             low-res preview of the design
Telop timings come from Whisper character timestamps (see TELOPS); every telop is checked
against the Instagram Reels safe zone.

usage: python3 ikea_ae_build.py SRC.mp4 FONT_DIR OUT_DIR [--skip-matte] [--skip-preview]
"""
import os, sys, re, json, math, shutil, subprocess, functools
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

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
MAX_LINE_W = SAFE["right"] - SAFE["left"] - 20
BORDER = 0.045          # dark border width, as a fraction of the font size

# ---------------------------------------------------------------- timeline spec
# Markup: text in [brackets] is the accent colour. "/" starts a new line; a line may carry its own
# size as "size:text". Timings follow the speaker (Whisper character timestamps).
def P(t0, t1, text, kind="base", **kw):
    d = dict(t0=t0, t1=t1, text=text, kind=kind, x=CX, rot=0.0, behind=False, sfx=True,
             color=WHITE, accent=YELLOW, frm=(0, -1), dist=500, dur=0.22, stagger=0.06)
    if kind == "base": d.update(y=BASE_Y, size=BASE_SIZE, anim="settle", sfx=False)
    elif kind == "big": d.update(y=BIG_Y, size=BIG_SIZE, anim="pop")
    d.update(kw)
    return d

TELOPS = [
    # 0-2.1 exterior
    P(0.20, 2.10, "100:スウェーデンの/230:[イケア]を", "hook", x=CX, y=700, size=0, anim="fly", dist=650, dur=0.3),
    P(0.76, 1.18, "見つけたんで"),
    P(1.18, 2.10, "行ってみたいと思います"),
    # 2.1-8.7 intro talk
    P(2.38, 2.84, "日本だと"),
    P(2.84, 3.16, "イケアの"),
    P(3.16, 3.70, "ソフトクリームって"),
    P(3.70, 4.38, "1個[50円]", "big"),
    P(4.38, 5.20, "だと思うんですけど"),
    P(5.66, 6.02, "実際"),
    P(6.02, 7.22, "本場のイケアは"),
    P(7.75, 8.04, "買えるのかを"),
    P(8.04, 8.80, "見てみます"),
    # 8.7-14.2 kiosk
    P(8.98, 10.22, "アイスクリーム"),
    P(10.22, 11.74, "[9]なんで", "big", rot=-2),
    P(11.74, 12.96, "[150円]", "big", size=210, y=950, x=CX - 30),
    P(12.10, 12.96, "ぐらいで買えるわ"),
    P(12.96, 13.74, "これ普通に"),
    P(13.74, 14.38, "[安い]んじゃない？", "big", size=150, rot=-3),
    # 14.2-17.4 kiosk scroll
    P(14.38, 15.54, "このシナモンロールは"),
    P(15.54, 16.72, "1個[112円]", "big"),
    P(16.72, 17.50, "で買えますね"),
    # 17.4-24.4 machine
    P(17.76, 18.80, "セットして"),
    P(19.16, 20.08, "あとはここを"),
    P(20.08, 21.00, "[押すだけ]ですね", "big", size=150, rot=2),
    P(23.04, 24.00, "自動でやってくれる"),
    # 24.4- eating
    P(24.84, 26.04, "実際に"),
    P(26.04, 26.95, "90:アイスクリーム/190:[食べます]", "big"),
    P(29.48, 30.48, "口の中に入れた"),
    P(30.48, 31.30, "瞬間に"),
    P(31.90, 32.78, "[うわっ！]って", "big", size=200, rot=-4, x=CX + 20),
    P(32.78, 33.68, "色々うまい"),
    P(33.68, 34.16, "アイスクリーム"),
    P(34.16, 35.00, "あるじゃないですか"),
    P(35.14, 36.18, "まあハーゲンダッツの"),
    P(36.18, 37.40, "[5倍濃縮]", "behind", y=400, size=210, anim="cascade", behind=True, dist=260, dur=0.3,
      stagger=0.07),
    P(36.84, 37.28, "したみたいな"),
    P(37.28, 38.00, "感じの味がします"),
    P(38.00, 38.60, "これ"),
    P(39.24, 39.68, "意外とね"),
    P(39.68, 40.42, "[リーズナブル]なので", "big", size=120),
    P(40.42, 42.30, "ぜひ食べてみてください"),
]

CARDS = [
    # covers "いくらぐらいで" — the question the video is about
    dict(t0=7.22, t1=7.75, bg=YELLOW, telop=P(7.22, 7.75, "いくら？", "card", x=CX, y=760, size=280, color=DARK,
                                              accent=DARK, anim="pop", dur=0.2)),
]


def parse_lines(p):
    """-> list of (size, [(text, is_accent), ...])"""
    lines = []
    for raw in p["text"].split("/"):
        size = p["size"]
        m = re.match(r"^(\d+):(.*)$", raw)
        if m: size, raw = int(m.group(1)), m.group(2)
        runs = [(s.strip("[]"), s.startswith("[")) for s in re.findall(r"\[[^\]]+\]|[^\[]+", raw)]
        lines.append([size, runs])
    return lines

# ---------------------------------------------------------------- glyph rendering (preview + safe check)
FONT_DIR = None

def ease_out_expo(x): x = min(max(x, 0), 1); return 1 - 2 ** (-10 * x) if x < 1 else 1.0
def ease_out_back(x, s=1.7): x = min(max(x, 0), 1) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))

@functools.lru_cache(maxsize=4096)
def run_mask(text, size):
    f = ImageFont.truetype(os.path.join(FONT_DIR, FONT[1]), size)
    track = size * TRACKING / 1000.0
    adv = [f.getlength(c) for c in text]
    tw = sum(adv) + track * len(text)
    asc, desc = f.getmetrics()
    img = Image.new("L", (int(tw) + 4, asc + desc), 0); d = ImageDraw.Draw(img)
    x, centers = 0, []
    for c, a in zip(text, adv):
        d.text((x, 0), c, font=f, fill=255); centers.append(x + a / 2); x += a + track
    return np.asarray(img, np.float32) / 255.0, asc, tw, tuple(centers)


def fit_sizes(p):
    """Shrink lines that would not fit the safe width."""
    for line in parse_lines(p):
        size, runs = line
        w = sum(run_mask(t, size)[2] for t, _ in runs)
        if w > MAX_LINE_W:
            new = int(size * MAX_LINE_W / w)
            p["text"] = p["text"].replace(f"{size}:", f"{new}:") if f"{size}:" in p["text"] else p["text"]
            if p["size"] == size: p["size"] = new


@functools.lru_cache(maxsize=1024)
def _phrase_sprite(text, size, color, accent, border=True):
    p = dict(text=text, size=size)
    lines = parse_lines(p)
    rendered = []
    for size, runs in lines:
        masks = [(run_mask(t, size), acc) for t, acc in runs]
        lw = int(sum(m[2] for m, _ in masks)) + 4
        asc = max(m[1] for m, _ in masks); hh = max(m[0].shape[0] for m, _ in masks)
        rgb = np.zeros((hh, lw, 3), np.float32); a = np.zeros((hh, lw), np.float32); x = 0
        for (m, _asc, tw, _), acc in masks:
            col = np.array(accent if acc else color, np.float32) / 255
            h_, w_ = m.shape; w_ = min(w_, lw - int(x))
            a[:h_, int(x):int(x) + w_] = np.maximum(a[:h_, int(x):int(x) + w_], m[:, :w_])
            rgb[:h_, int(x):int(x) + w_] += col * m[:, :w_, None]
            x += tw
        rendered.append((rgb, a, size))
    gap = [int(s * 0.12) for _, _, s in rendered]
    tot_h = sum(r[1].shape[0] for r in rendered) + sum(gap[1:])
    tot_w = max(r[1].shape[1] for r in rendered)
    pad = int(max(s for *_, s in rendered) * 0.25)
    out = np.zeros((tot_h + pad * 2, tot_w + pad * 2, 4), np.float32)
    y = pad
    for k, (rgb, a, s) in enumerate(rendered):
        if k: y += gap[k]
        x = pad + (tot_w - a.shape[1]) // 2
        out[y:y + a.shape[0], x:x + a.shape[1], :3] += rgb
        out[y:y + a.shape[0], x:x + a.shape[1], 3] = np.maximum(out[y:y + a.shape[0], x:x + a.shape[1], 3], a)
        y += a.shape[0]
    # thin dark border + tight halo so white/yellow stays readable on bright shots
    a = out[..., 3]
    base = max(s for *_, s in rendered)
    if border:
        r = max(2, int(round(base * BORDER)))
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        ring = cv2.dilate(a, k)
        dark = np.array(DARK, np.float32) / 255
        out[..., :3] += dark * np.clip(ring - a, 0, 1)[..., None]
        a = np.maximum(a, ring)
        out[..., 3] = a
    sh = cv2.GaussianBlur(a, (0, 0), max(2.0, base * 0.05))
    sh = cv2.warpAffine(sh, np.float32([[1, 0, 0], [0, 1, base * 0.03]]), (a.shape[1], a.shape[0]))
    sh = np.clip(sh * 0.85, 0, 0.85)
    res = np.zeros_like(out)
    res[..., :3] = out[..., :3]
    res[..., 3] = sh * (1 - a) + a
    # recentre on ink box
    ys, xs = np.nonzero(a > 0.02)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    M = np.float32([[1, 0, res.shape[1] / 2 - cx], [0, 1, res.shape[0] / 2 - cy]])
    return cv2.warpAffine(res, M, (res.shape[1], res.shape[0])), (xs.max() - xs.min(), ys.max() - ys.min())


def phrase_sprite(p): return _phrase_sprite(p["text"], p["size"], p["color"], p["accent"], p["color"] != DARK)


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


def draw_phrase(frame, p, t):
    if not (p["t0"] <= t < p["t1"]): return
    lt, dur = t - p["t0"], p["dur"]
    q = lt / dur
    if p["anim"] == "cascade":  # single line, single colour
        size, runs = parse_lines(p)[0]
        text = "".join(r for r, _ in runs)
        _, _, tw, centers = run_mask(text, size)
        col = p["accent"] if runs[0][1] else p["color"]
        for k, ch in enumerate(text):
            qq = (lt - k * p["stagger"]) / dur
            if qq <= 0: continue
            spr, _ = _phrase_sprite(f"{size}:{ch}", size, col, col, col != DARK)
            composite(frame, spr, p["x"] - tw / 2 + centers[k], p["y"] - (1 - ease_out_back(qq, 1.3)) * p["dist"],
                      alpha=clamp(qq * 3), rot=p["rot"])
        return
    spr, _ = phrase_sprite(p)
    if p["anim"] == "settle":
        composite(frame, spr, p["x"], p["y"], scale=1.0 + 0.05 * (1 - ease_out_expo(lt / 0.15)), rot=p["rot"])
    elif p["anim"] == "pop":
        composite(frame, spr, p["x"], p["y"], scale=0.7 + 0.3 * ease_out_back(q), rot=p["rot"])
    elif p["anim"] == "fly":
        e, e2 = ease_out_expo(q), ease_out_expo(q + 1 / (FPS * dur))
        off, off2 = (1 - e) * p["dist"], (1 - e2) * p["dist"]
        fx, fy = p["frm"]
        composite(frame, spr, p["x"] + fx * off, p["y"] + fy * off,
                  vel=(fx * (off - off2) * 1.6, fy * (off - off2) * 1.6), rot=p["rot"])


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

def check_safe_zone():
    bad = []
    for p in all_phrases():
        spr, _ = phrase_sprite(p)
        a = spr[..., 3]
        ink = _phrase_sprite(p["text"], p["size"], p["color"], p["accent"])[0][..., :3].max(-1)
        ys, xs = np.nonzero(ink > 0.02)
        h, w = a.shape
        pts = np.stack([xs - w / 2, ys - h / 2], 1)
        r = math.radians(p["rot"])
        rx = pts[:, 0] * math.cos(r) - pts[:, 1] * math.sin(r) + p["x"]
        ry = pts[:, 0] * math.sin(r) + pts[:, 1] * math.cos(r) + p["y"]
        box = (rx.min(), ry.min(), rx.max(), ry.max())
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
    for p in all_phrases():
        if not p["sfx"]: continue
        if p["anim"] in ("fly", "cascade"): ev.append(("whoosh", p["t0"] - 0.06))
        elif p["anim"] == "pop": ev.append(("pop", p["t0"]))
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
    lines = [dict(size=s, runs=[dict(text=t, accent=a) for t, a in runs]) for s, runs in parse_lines(p)]
    plain = re.sub(r"[\[\]]|\d+:", "", p["text"]).replace("/", " ")
    return dict(name=f'{p["t0"]:05.2f} {plain}',
                t0=p["t0"], t1=p["t1"], x=p["x"], y=p["y"], rot=p["rot"], lines=lines, anim=p["anim"],
                color=[c / 255 for c in p["color"]], accent=[c / 255 for c in p["accent"]],
                frm=list(p["frm"]), dist=p["dist"], dur=p["dur"], stagger=p["stagger"], behind=p["behind"])

JSX_TEMPLATE = r"""// IKEA soft-ice vlog - After Effects builder (generated by ikea_ae_build.py)
// Run in After Effects: File > Scripts > Run Script File...
(function () {
var DATA = %(data)s;
var MSG = %(msg)s;
var W = 1080, H = 1920, FPS = 30;
var root = File($.fileName).parent;

function ease(prop, k, inInf, outInf) {
    var n = (prop.value instanceof Array && !prop.isSpatial) ? prop.value.length : 1;
    var ins = [], outs = [];
    for (var i = 0; i < n; i++) { ins.push(new KeyframeEase(0, inInf)); outs.push(new KeyframeEase(0, outInf)); }
    prop.setTemporalEaseAtKey(k, ins, outs);
}
function expoOut(prop) { ease(prop, 1, 33, 0.1); ease(prop, 2, 92, 33); }
function setMax(prop, frac) { prop.setValue(prop.hasMax ? prop.maxValue * frac : frac * 100); }
function xf(L) { return L.property("ADBE Transform Group"); }

// tight dark halo: keeps white / yellow readable on bright shots
function addHalo(L, size) {
    var ds = L.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
    ds.property("ADBE Drop Shadow-0001").setValue([0, 0, 0, 1]);
    setMax(ds.property("ADBE Drop Shadow-0002"), 0.8);
    ds.property("ADBE Drop Shadow-0003").setValue(180);
    ds.property("ADBE Drop Shadow-0004").setValue(Math.max(2, size * 0.03));
    ds.property("ADBE Drop Shadow-0005").setValue(Math.max(6, size * 0.14));
}

function addRun(comp, text, size, color, halo) {
    // halo == true: dark border (stroke behind fill) + soft shadow
    var L = comp.layers.addText(text);
    var src = L.property("ADBE Text Properties").property("ADBE Text Document");
    var td = src.value;
    try { td.resetCharStyle(); td.resetParagraphStyle(); } catch (e) {}
    td.font = DATA.font; td.fontSize = size; td.tracking = DATA.tracking;
    td.applyFill = true; td.fillColor = color;
    if (halo) {
        td.applyStroke = true; td.strokeColor = DATA.dark; td.strokeOverFill = false;
        td.strokeWidth = Math.max(4, Math.round(size * DATA.border * 2));
    } else td.applyStroke = false;
    td.justification = ParagraphJustification.LEFT_JUSTIFY;
    src.setValue(td);
    if (halo) addHalo(L, size);
    return L;
}

// One telop = a null (position / rotation / scale animation) + one text layer per colour run.
function addPhrase(comp, p, halo) {
    var nul = comp.layers.addNull(comp.duration);
    nul.name = "TELOP " + p.name;
    nul.startTime = 0; nul.inPoint = p.t0; nul.outPoint = p.t1;
    xf(nul).property("ADBE Anchor Point").setValue([0, 0, 0]);
    xf(nul).property("ADBE Position").setValue([p.x, p.y]);
    xf(nul).property("ADBE Rotate Z").setValue(p.rot);
    var runs = [], lineBoxes = [], totalH = 0;
    for (var li = 0; li < p.lines.length; li++) {
        var line = p.lines[li], lw = 0, top = 1e9, bot = -1e9, items = [];
        for (var ri = 0; ri < line.runs.length; ri++) {
            var run = line.runs[ri];
            var L = addRun(comp, run.text, line.size, run.accent ? p.accent : p.color, halo);
            L.startTime = 0; L.inPoint = p.t0; L.outPoint = p.t1;
            var r = L.sourceRectAtTime(p.t0, false);
            items.push({ layer: L, rect: r, x: lw });
            lw += r.width + line.size * DATA.tracking / 1000;
            top = Math.min(top, r.top); bot = Math.max(bot, r.top + r.height);
        }
        lineBoxes.push({ items: items, width: lw - line.size * DATA.tracking / 1000, top: top, bot: bot, size: line.size });
        totalH += (bot - top) + (li ? line.size * 0.12 : 0);
    }
    var y = -totalH / 2;
    for (var lj = 0; lj < lineBoxes.length; lj++) {
        var lb = lineBoxes[lj];
        if (lj) y += lb.size * 0.12;
        var baseline = y - lb.top;
        for (var k = 0; k < lb.items.length; k++) {
            var it = lb.items[k];
            it.layer.parent = nul;
            xf(it.layer).property("ADBE Position").setValue([-lb.width / 2 + it.x - it.rect.left, baseline]);
            it.layer.name = "  " + p.name + " / " + (lj + 1) + "-" + (k + 1);
            runs.push(it.layer);
        }
        y += lb.bot - lb.top;
    }
    animate(comp, p, nul, runs);
    return nul;
}

function animate(comp, p, nul, runs) {
    var t0 = p.t0, t1 = p.t0 + p.dur, i;
    var sc = xf(nul).property("ADBE Scale");
    if (p.anim === "settle") {
        sc.setValuesAtTimes([t0, t0 + 0.15], [[105, 105, 100], [100, 100, 100]]); expoOut(sc);
    } else if (p.anim === "pop") {
        sc.setValuesAtTimes([t0, t0 + p.dur * 0.6, t1], [[70, 70, 100], [106, 106, 100], [100, 100, 100]]);
        ease(sc, 1, 33, 0.1); ease(sc, 2, 50, 50); ease(sc, 3, 80, 33);
    } else if (p.anim === "fly") {
        var pos = xf(nul).property("ADBE Position");
        pos.setValuesAtTimes([t0, t1], [[p.x + p.frm[0] * p.dist, p.y + p.frm[1] * p.dist], [p.x, p.y]]);
        expoOut(pos);
        for (i = 0; i < runs.length; i++) runs[i].motionBlur = true;
    } else if (p.anim === "cascade") {
        for (i = 0; i < runs.length; i++) {
            var L = runs[i];
            L.motionBlur = true;
            var anims = L.property("ADBE Text Properties").property("ADBE Text Animators");
            anims.addProperty("ADBE Text Animator");
            var A = function () { return L.property("ADBE Text Properties").property("ADBE Text Animators").property(1); };
            A().name = "Cascade";
            A().property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
            A().property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
            A().property("ADBE Text Animator Properties").property("ADBE Text Position 3D").setValue([0, -p.dist, 0]);
            A().property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);
            A().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
            var adv = A().property("ADBE Text Selectors").property(1).property("ADBE Text Range Advanced");
            adv.property("ADBE Text Range Shape").setValue(2);       // Ramp Up
            adv.property("ADBE Text Levels Max Ease").setValue(100); // Ease High
            var off = A().property("ADBE Text Selectors").property(1).property("ADBE Text Percent Offset");
            off.setValuesAtTimes([t0, t0 + p.dur + p.stagger * 4], [-100, 100]);
            ease(off, 1, 33, 0.1); ease(off, 2, 75, 33);
        }
    }
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
    addPhrase(comp, c.telop, false);
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
    for (i = 0; i < DATA.telops.length; i++) if (DATA.telops[i].behind) addPhrase(comp, DATA.telops[i], true);

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

    for (i = 0; i < DATA.telops.length; i++) if (!DATA.telops[i].behind) addPhrase(comp, DATA.telops[i], true);
    for (i = 0; i < DATA.cards.length; i++) addCard(comp, DATA.cards[i], i + 1);

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
        safe=SAFE, font=FONT[0], tracking=TRACKING, border=BORDER, dark=[c / 255 for c in DARK],
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
    for p in all_phrases(): fit_sizes(p)
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
