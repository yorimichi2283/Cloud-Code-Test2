"""IKEA soft-ice vlog edit — reference-style kinetic typography.

Style: M PLUS Rounded 1c Black (big), white + rust #A24125, Shippori Mincho accents,
motion-blur fly-ins, blur-ins, typewriter, pop; full-screen insert cards; punch-in zooms;
text-behind-person via MediaPipe segmentation; subtle synthesized SFX.
"""
import os, sys, math, subprocess, functools
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src.mp4")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out.mp4")
T_START = float(os.environ.get("T_START", 0))
T_END = float(os.environ.get("T_END", 1e9))
W, H, FPS = 1080, 1920, 30

GOTHIC = os.path.join(HERE, "fonts/m-plus-rounded-1c/MPLUSRounded1c_900Black.ttf")
MINCHO = os.path.join(HERE, "fonts/shippori-mincho-b1/ShipporiMinchoB1_800ExtraBold.ttf")
WHITE = (255, 255, 255)
RUST = (162, 65, 37)
BEIGE = (239, 233, 223)
INK = (40, 36, 34)

# ---------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_out_expo(x): x = clamp(x); return 1 - 2 ** (-10 * x) if x < 1 else 1.0
def ease_out_back(x, s=1.9):
    x = clamp(x) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def ease_in_out(x): x = clamp(x); return x * x * (3 - 2 * x)

# ---------------------------------------------------------------- text sprites
@functools.lru_cache(maxsize=512)
def text_sprite(text, font, size, color, italic=False, outline=0, shadow=True, tracking=-0.04):
    """Return premultiplied float32 RGBA sprite (H, W, 4) with soft drop shadow."""
    f = ImageFont.truetype(font, size)
    # measure with per-char tracking
    adv = []
    for ch in text:
        adv.append(f.getlength(ch))
    track = size * tracking
    tw = int(sum(adv) + track * (len(text) - 1)) + 1
    asc, desc = f.getmetrics()
    pad = int(size * 0.45)
    cw, ch_ = tw + pad * 2, asc + desc + pad * 2
    glyph = Image.new("L", (cw, ch_), 0)
    d = ImageDraw.Draw(glyph)
    x = pad
    for c, a in zip(text, adv):
        if outline:
            d.text((x, pad), c, font=f, fill=0, stroke_width=outline, stroke_fill=255)
        else:
            d.text((x, pad), c, font=f, fill=255)
        x += a + track
    if outline:  # hollow: stroke minus fill
        inner = Image.new("L", (cw, ch_), 0); di = ImageDraw.Draw(inner); x = pad
        for c, a in zip(text, adv):
            di.text((x, pad), c, font=f, fill=255); x += a + track
        g = np.asarray(glyph, np.float32) - np.asarray(inner, np.float32)
        glyph = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8))
    if italic:
        sh = 0.18
        glyph = glyph.transform(glyph.size, Image.AFFINE, (1, sh, -sh * ch_ * 0.5, 0, 1, 0), Image.BICUBIC)
    a = np.asarray(glyph, np.float32) / 255.0
    out = np.zeros((ch_, cw, 4), np.float32)
    if shadow:
        s = cv2.GaussianBlur(a, (0, 0), size * 0.09)
        M = np.float32([[1, 0, size * 0.02], [0, 1, size * 0.05]])
        s = np.clip(cv2.warpAffine(s, M, (cw, ch_)) * 0.62, 0, 0.75)
        out[..., 3] = s  # black shadow (premultiplied rgb = 0)
    col = np.array(color, np.float32) / 255.0
    # composite glyph over shadow (premultiplied)
    out[..., :3] = out[..., :3] * (1 - a[..., None]) + col * a[..., None]
    out[..., 3] = out[..., 3] * (1 - a) + a
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
    padded = cv2.copyMakeBorder(spr, L, L, L, L, cv2.BORDER_CONSTANT, value=0)
    return cv2.filter2D(padded, -1, k)


def composite(frame, spr, cx, cy, alpha=1.0, scale=1.0, blur=0.0, vel=(0, 0), rot=0.0):
    """Composite premultiplied sprite centered at (cx, cy) onto float frame (H,W,3) in-place."""
    s = spr
    if scale != 1.0 or rot:
        h, w = s.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), rot, scale)
        nw, nh = int(w * max(scale, 1) * (1.3 if rot else 1)), int(h * max(scale, 1) * (1.3 if rot else 1))
        M[0, 2] += (nw - w) / 2; M[1, 2] += (nh - h) / 2
        s = cv2.warpAffine(s, M, (nw, nh), flags=cv2.INTER_LINEAR)
    if blur > 0.3:
        s = cv2.GaussianBlur(s, (0, 0), blur)
    if vel != (0, 0):
        s = motion_blur(s, *vel)
    if alpha < 1: s = s * alpha
    h, w = s.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    fx0, fy0, fx1, fy1 = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if fx1 <= fx0 or fy1 <= fy0: return
    sub = s[fy0 - y0:fy1 - y0, fx0 - x0:fx1 - x0]
    reg = frame[fy0:fy1, fx0:fx1]
    reg *= (1 - sub[..., 3:4])
    reg += sub[..., :3]

# ---------------------------------------------------------------- telop events
class Telop:
    """kind: fly (motion-blur slide), blur (blur+scale in), type (typewriter), pop."""
    def __init__(self, t0, t1, text, x, y, size, color=WHITE, font=GOTHIC, kind="fly",
                 frm=(0, -1), dist=500, dur=0.28, behind=False, italic=False, outline=0, rot=0.0, sfx=True):
        self.__dict__.update(locals()); del self.__dict__["self"]

    def draw(self, frame, t):
        if not (self.t0 <= t < self.t1): return
        lt = t - self.t0
        if self.kind == "type":
            n = clamp(lt / max(self.dur, 1e-3)) * len(self.text)
            n = max(1, int(math.ceil(n)))
            full = text_sprite(self.text, self.font, self.size, self.color, self.italic, self.outline)
            part = text_sprite(self.text[:n], self.font, self.size, self.color, self.italic, self.outline)
            # left-align partial with the full string
            dx = (part.shape[1] - full.shape[1]) / 2
            composite(frame, part, self.x + dx, self.y, rot=self.rot)
            return
        spr = text_sprite(self.text, self.font, self.size, self.color, self.italic, self.outline)
        p = lt / self.dur
        if self.kind == "fly":
            e = ease_out_expo(p); e2 = ease_out_expo(p + 1 / (FPS * self.dur))
            off = (1 - e) * self.dist; off2 = (1 - e2) * self.dist
            vx, vy = self.frm[0] * (off - off2) * 1.6, self.frm[1] * (off - off2) * 1.6
            composite(frame, spr, self.x + self.frm[0] * off, self.y + self.frm[1] * off,
                      alpha=clamp(p * 4), vel=(vx, vy), rot=self.rot)
        elif self.kind == "blur":
            e = ease_out_expo(p)
            composite(frame, spr, self.x, self.y, alpha=clamp(p * 2.2), scale=1.18 - 0.18 * e,
                      blur=(1 - e) * 22, rot=self.rot)
        elif self.kind == "pop":
            composite(frame, spr, self.x, self.y, alpha=clamp(p * 5), scale=0.55 + 0.45 * ease_out_back(p),
                      rot=self.rot)


class Card:
    """Full-screen insert card. style: rust (light streaks) or beige (corner brackets)."""
    def __init__(self, t0, t1, style, telops):
        self.t0, self.t1, self.style, self.telops = t0, t1, style, telops

    @functools.lru_cache(maxsize=4)
    def base(self):
        if self.style == "rust":
            img = np.ones((H, W, 3), np.float32) * np.array(RUST, np.float32) / 255
        else:
            img = np.ones((H, W, 3), np.float32) * np.array(BEIGE, np.float32) / 255
        return img

    def render(self, t):
        lt = t - self.t0
        img = self.base().copy()
        yy, xx = np.mgrid[0:H:4, 0:W:4].astype(np.float32)
        if self.style == "rust":
            # soft diagonal light streaks drifting slowly (window-blind light like the reference)
            ph = (xx * 0.8 + yy * 0.45) / 260.0 + lt * 0.6
            band = 0.5 + 0.5 * np.sin(ph * 2 * math.pi)
            band = cv2.GaussianBlur(band, (0, 0), 6)
            band = cv2.resize(band, (W, H))
            img *= (0.86 + 0.24 * band)[..., None]
            vig = 1 - 0.25 * (((np.mgrid[0:H, 0:W][1] - W / 2) / W) ** 2 + ((np.mgrid[0:H, 0:W][0] - H / 2) / H) ** 2) * 2
            img *= vig[..., None].astype(np.float32)
        else:
            ink = np.array(INK, np.float32) / 255
            L, th, m = 110, 9, 80
            for (x, y, sx, sy) in [(m, m, 1, 1), (W - m, m, -1, 1), (m, H - m, 1, -1), (W - m, H - m, -1, -1)]:
                cv2.line(img, (x, y), (x + sx * L, y), ink.tolist(), th)
                cv2.line(img, (x, y), (x, y + sy * L), ink.tolist(), th)
            small = text_sprite("SOFT ICE CREAM  ・  IKEA SWEDEN", MINCHO, 30, INK, shadow=False, tracking=0.05)
            small = cv2.rotate(small, cv2.ROTATE_90_COUNTERCLOCKWISE)
            composite(img, small, 125, H / 2, alpha=0.8)
        return img

    def draw(self, frame, t):
        if not (self.t0 <= t < self.t1): return False
        frame[:] = self.render(t)
        for tl in self.telops: tl.draw(frame, t)
        return True

# ---------------------------------------------------------------- camera (punch-in zooms)
# (t0, t1, z0, z1, cx, cy)  — z interpolates linearly within the shot (slow push), hard cut between.
SHOTS = [
    (0.0, 2.1, 1.00, 1.08, 540, 960),
    (2.1, 4.6, 1.00, 1.03, 540, 900),
    (4.6, 6.6, 1.22, 1.25, 540, 760),     # punch-in on face
    (6.6, 8.7, 1.06, 1.08, 540, 900),
    (8.7, 11.0, 1.00, 1.05, 540, 960),
    (11.0, 14.23, 1.45, 1.52, 470, 1150), # punch-in on the 9 SEK price
    (14.23, 17.37, 1.00, 1.06, 560, 900),
    (17.37, 18.83, 1.00, 1.04, 540, 960),
    (18.83, 21.1, 1.12, 1.16, 600, 1150),
    (21.1, 24.4, 1.00, 1.10, 540, 1000),  # dispensing, slow push
    (24.4, 27.0, 1.00, 1.03, 540, 1000),
    (27.0, 28.77, 1.24, 1.28, 560, 650),  # reaction (looking up)
    (28.77, 31.5, 1.00, 1.03, 540, 1000),
    (31.5, 34.0, 1.18, 1.20, 540, 850),
    (34.0, 36.5, 1.00, 1.03, 540, 1000),
    (36.5, 38.83, 1.15, 1.18, 540, 900),
    (38.83, 42.3, 1.00, 1.07, 540, 900),
]

def camera(frame, t):
    for (a, b, z0, z1, cx, cy) in SHOTS:
        if a <= t < b:
            z = z0 + (z1 - z0) * (t - a) / (b - a); break
    else:
        z, cx, cy = 1.0, 540, 960
    if abs(z - 1) < 1e-3: return frame
    cw, ch = W / z, H / z
    x0 = clamp(cx - cw / 2, 0, W - cw); y0 = clamp(cy - ch / 2, 0, H - ch)
    M = np.float32([[z, 0, -x0 * z], [0, z, -y0 * z]])
    return cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_CUBIC)

# ---------------------------------------------------------------- timeline
G, M_ = GOTHIC, MINCHO
TELOPS = [
    # 0–2.1 exterior: title hook
    Telop(0.15, 2.1, "スウェーデンの", 540, 640, 140, WHITE, M_, "type", dur=0.5),
    Telop(0.45, 2.1, "IKEA", 540, 860, 400, WHITE, G, "fly", frm=(0, -1), dist=700),
    # 2.1–4.6 intro talk (lower third, over chest)
    Telop(2.3, 4.6, "本場の", 320, 1080, 150, WHITE, M_, "blur"),
    Telop(2.55, 4.6, "ソフト", 540, 1290, 310, RUST, G, "fly", frm=(-1, 0), dist=900),
    Telop(2.85, 4.6, "クリーム", 540, 1530, 260, WHITE, G, "fly", frm=(1, 0), dist=900),
    # 8.7–14.2 kiosk → price punch-in
    Telop(11.1, 14.23, "たったの", 540, 600, 150, WHITE, M_, "type", dur=0.4),
    Telop(11.4, 14.23, "9 SEK", 540, 830, 340, RUST, G, "pop", dur=0.32),
    # 14.2–17.4 kiosk scroll
    Telop(14.5, 17.37, "ちなみに", 320, 1080, 140, WHITE, M_, "type", dur=0.4),
    Telop(14.8, 17.37, "シナモンロール", 540, 1280, 150, WHITE, G, "fly", frm=(1, 0), dist=900),
    Telop(15.1, 17.37, "7 SEK", 540, 1480, 240, RUST, G, "pop", dur=0.3),
    # 18.8–21.1 button
    Telop(19.0, 21.1, "ボタンを", 540, 540, 160, WHITE, M_, "blur"),
    Telop(19.25, 21.1, "押すだけ", 540, 760, 280, WHITE, G, "fly", frm=(0, 1), dist=700),
    # 21.1–24.4 dispensing
    Telop(21.4, 23.2, "自動で", 540, 500, 160, WHITE, M_, "type", dur=0.35),
    Telop(21.7, 23.2, "出てくる", 540, 720, 280, WHITE, G, "fly", frm=(-1, 0), dist=900),
    Telop(23.3, 24.4, "完成", 540, 680, 420, RUST, G, "pop", dur=0.3),
    # 38.8–42.2 outro: IKEA behind the person, ソフトクリーム in front
    Telop(38.95, 42.3, "IKEA", 540, 300, 360, WHITE, G, "blur", behind=True),
    Telop(39.3, 42.3, "ソフトクリーム", 540, 1540, 150, RUST, G, "fly", frm=(0, 1), dist=500),
]
CARDS = [
    Card(6.6, 7.35, "rust", [Telop(6.6, 7.35, "食べてみた", 540, 960, 200, WHITE, G, "fly", frm=(0, 1), dist=800)]),
    Card(17.37, 18.1, "beige", [Telop(17.37, 18.1, "セルフ式", 540, 960, 250, RUST, G, "blur", dur=0.3)]),
    Card(24.4, 25.15, "rust", [Telop(24.4, 25.15, "実食", 540, 960, 420, WHITE, G, "fly", frm=(-1, 0), dist=1000)]),
]

# ---------------------------------------------------------------- segmentation
_seg = None
_mask_prev = None
def person_mask(rgb_u8):
    global _seg, _mask_prev
    if _seg is None:
        import mediapipe as mp
        from mediapipe.tasks import python as mpp
        from mediapipe.tasks.python import vision
        opts = vision.ImageSegmenterOptions(
            base_options=mpp.BaseOptions(model_asset_path=os.path.join(HERE, "selfie_multiclass_256x256.tflite")),
            output_confidence_masks=True, running_mode=vision.RunningMode.IMAGE)
        _seg = (vision.ImageSegmenter.create_from_options(opts), mp)
    seg, mp = _seg
    r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb_u8)))
    m = 1 - r.confidence_masks[0].numpy_view()[..., 0].astype(np.float32)
    m = cv2.GaussianBlur(np.clip((m - 0.5) * 2.5 + 0.5, 0, 1), (0, 0), 2.0)
    if _mask_prev is not None: m = 0.6 * m + 0.4 * _mask_prev
    _mask_prev = m
    return m

# ---------------------------------------------------------------- SFX (synthesized, subtle)
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

def build_sfx(dur):
    track = np.zeros(int(SR * (dur + 1)))
    def add(snd, t, g):
        i = int(t * SR); j = min(len(track), i + len(snd)); track[i:j] += snd[:j - i] * g
    for tl in TELOPS + [c for card in CARDS for c in card.telops]:
        if not tl.sfx: continue
        if tl.kind == "fly": add(sfx_whoosh(), tl.t0 - 0.06, 0.16)
        elif tl.kind == "pop": add(sfx_pop(), tl.t0, 0.22)
        elif tl.kind == "blur": add(sfx_whoosh(0.4)[::-1].copy(), tl.t0 - 0.05, 0.08)
        elif tl.kind == "type":
            nch = len(tl.text)
            for k in range(nch): add(sfx_tick(), tl.t0 + tl.dur * k / nch, 0.05)
    for card in CARDS: add(sfx_thump(), card.t0, 0.35)
    return track

# ---------------------------------------------------------------- main render
def main():
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC],
                           capture_output=True, text=True)
    dur = float(probe.stdout.strip())
    t_end = min(dur, T_END)
    # audio: original + sfx
    a = subprocess.run(["ffmpeg", "-v", "error", "-i", SRC, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                       capture_output=True).stdout
    orig = np.frombuffer(a, np.float32).reshape(-1, 2)
    sfx = build_sfx(dur)[:len(orig)]
    mix = orig + sfx[:, None] * np.array([1.0, 1.0])
    mix = np.clip(mix, -0.98, 0.98).astype(np.float32)
    s0, s1 = int(T_START * SR), int(t_end * SR)
    wav = os.path.join(HERE, "mix.f32")
    mix[s0:s1].tofile(wav)

    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", str(T_START), "-i", SRC, "-t", str(t_end - T_START),
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", wav,
                            "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
                            "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", OUT],
                           stdin=subprocess.PIPE)
    fsize = W * H * 3
    i = 0
    while True:
        buf = dec.stdout.read(fsize)
        if len(buf) < fsize: break
        t = T_START + i / FPS
        raw = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        cam = camera(raw, t)
        frame = cam.astype(np.float32) / 255.0
        card = next((c for c in CARDS if c.t0 <= t < c.t1), None)
        if card:
            card.draw(frame, t)
        else:
            behind = [tl for tl in TELOPS if tl.behind and tl.t0 <= t < tl.t1]
            if behind:
                m = person_mask(cam)
                orig_f = frame.copy()
                for tl in behind: tl.draw(frame, t)
                frame = frame * (1 - m[..., None]) + orig_f * m[..., None]
            for tl in TELOPS:
                if not tl.behind: tl.draw(frame, t)
        enc.stdin.write((np.clip(frame, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
        i += 1
        if i % 60 == 0: print(f"{t:.1f}s", flush=True)
    enc.stdin.close(); enc.wait(); dec.wait()
    print("done", OUT, i, "frames")

if __name__ == "__main__":
    main()
