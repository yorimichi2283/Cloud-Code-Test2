"""水ダウ風テロップ用の効果音をゼロから合成して WAV に書き出す。

すべてノイズと正弦波から計算で作っているオリジナル音源なので、著作権を気にせず使える。
    python3 se/make_se.py        → se/単体/ と se/テンプレ同期/ に WAV（48kHz / 16bit / ステレオ）
"""
import os

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
FPS = 29.97
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(20261005)


# ---------------------------------------------------------------------
# 部品
# ---------------------------------------------------------------------
def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def filt(x, kind, freq, order=2):
    sos = butter(order, freq, btype=kind, fs=SR, output="sos")
    return sosfilt(sos, x)


def sine_glide(t, f_start, f_end, tau):
    """f_start から f_end へ指数的に近づく周波数で鳴る正弦波"""
    f = f_end + (f_start - f_end) * np.exp(-t / tau)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def fades(x, fade_in=0.002, fade_out=0.03):
    n_in, n_out = int(fade_in * SR), int(fade_out * SR)
    x = x.copy()
    if n_in:
        x[:n_in] *= np.linspace(0, 1, n_in)
    if n_out:
        x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def taper(x, frac=0.3):
    """末尾 frac の区間を cos カーブで 0 まで下げる（打ち切りのプチノイズ防止）"""
    n = int(len(x) * frac)
    w = 0.5 * (1 + np.cos(np.linspace(0, np.pi, n)))
    x = x.copy()
    if x.ndim == 1:
        x[-n:] *= w
    else:
        x[-n:] *= w[:, None]
    return x


def pan(mono, position):
    """position: -1(左)〜+1(右)。配列なら時間とともに移動"""
    p = np.broadcast_to(np.asarray(position, dtype=float), mono.shape)
    ang = (p + 1) * np.pi / 4
    return np.stack([mono * np.cos(ang), mono * np.sin(ang)], axis=1)


def reverb(stereo, wet=0.2, decay=0.6, predelay=0.012):
    """減衰ノイズのインパルス応答による簡易リバーブ（左右で別のIR）"""
    n = int(decay * 1.6 * SR)
    t = np.arange(n) / SR
    out = stereo.copy()
    tail = np.zeros((len(stereo) + n + int(predelay * SR), 2))
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / (decay / 6.9))
        ir = filt(ir, "lowpass", 7000)
        ir /= np.sqrt(np.sum(ir ** 2))
        wet_sig = fftconvolve(stereo[:, ch], ir)
        start = int(predelay * SR)
        tail[start:start + len(wet_sig), ch] += wet_sig
    out = np.vstack([out, np.zeros((len(tail) - len(out), 2))])
    return (1 - wet) * out + wet * tail


def trim_tail(stereo, threshold_db=-70):
    mag = np.max(np.abs(stereo), axis=1)
    thr = 10 ** (threshold_db / 20) * mag.max()
    idx = np.nonzero(mag > thr)[0]
    end = min(len(stereo), (idx[-1] if len(idx) else len(stereo)) + int(0.05 * SR))
    return stereo[:end]


def finish(stereo, peak_db):
    stereo = trim_tail(stereo)
    stereo = stereo - stereo.mean(axis=0)
    for ch in range(2):
        stereo[:, ch] = fades(stereo[:, ch])
    return stereo * (10 ** (peak_db / 20) / np.max(np.abs(stereo)))


def bell(t, f0, ratios, decays, amps):
    out = np.zeros_like(t)
    for r, d, a in zip(ratios, decays, amps):
        out += a * np.sin(2 * np.pi * f0 * r * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / d)
    return out


# ---------------------------------------------------------------------
# 効果音
# ---------------------------------------------------------------------
def se_whoosh():
    """シュッ: 横ブラーで文字が飛び込む音。左から右へ抜ける"""
    dur = 0.55
    t = t_axis(dur)
    x = noise(dur)
    # 帯域の中心を 350Hz → 2600Hz → 900Hz と動かす状態変数フィルタ
    fc = np.interp(t, [0, 0.13, 0.32, dur], [350, 2600, 1400, 900])
    q = 1.4
    low = band = 0.0
    y = np.zeros_like(x)
    for i in range(len(x)):
        f = 2 * np.sin(np.pi * fc[i] / SR)
        low += f * band
        high = x[i] - low - band / q
        band += f * high
        y[i] = band
    env = np.interp(t, [0, 0.11, 0.16, dur], [0, 1, 0.85, 0]) ** 1.6
    air = filt(noise(dur), "highpass", 5000) * np.interp(t, [0, 0.12, 0.25, dur], [0, 0.25, 0.05, 0])
    mono = y * env + air
    stereo = pan(mono, np.interp(t, [0, 0.3], [-0.7, 0.6]))
    return finish(reverb(taper(stereo), wet=0.12, decay=0.4), -5)


def se_shine():
    """キラーン: 文字が光ってグローが広がる音"""
    dur = 2.6
    t = t_axis(dur)
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    # 駆け上がるきらめき（ペンタトニック）
    notes = [2093.0, 2349.3, 2637.0, 3136.0, 3520.0, 4186.0]
    for k, f in enumerate(notes):
        start = int(k * 0.022 * SR)
        tt = t[: len(t) - start]
        ping = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.18) * (1 - np.exp(-tt / 0.0015)) * (0.55 + 0.08 * k)
        if k % 2:
            right[start:] += ping
        else:
            left[start:] += ping
    # 本体のベル（E6 + B6、上の倍音ほど早く減衰）
    ratios, decays, amps = [1, 2.0, 3.01, 4.17, 5.43], [0.9, 0.6, 0.4, 0.25, 0.15], [1, 0.5, 0.35, 0.2, 0.12]
    start = int(0.11 * SR)
    tt = t[: len(t) - start]
    attack = 1 - np.exp(-tt / 0.0015)
    b1 = bell(tt, 1318.5, ratios, decays, amps) * attack
    b2 = bell(tt, 1975.5, ratios, decays, amps) * attack * 0.7
    shimmer = 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * 11 * tt)) * (1 - np.exp(-tt / 0.25))
    left[start:] += (b1 * 0.9 + b2 * 0.6) * shimmer
    right[start:] += (b1 * 0.6 + b2 * 0.9) * shimmer
    sparkle = filt(noise(dur), "highpass", 7000) * np.exp(-np.maximum(t - 0.1, 0) / 0.3) * (t > 0.1) * 0.15
    stereo = np.stack([left + sparkle, right + sparkle], axis=1)
    return finish(reverb(taper(stereo), wet=0.3, decay=1.4), -6)


def se_don():
    """ドン: 下の箱がドンと出る音"""
    dur = 1.4
    t = t_axis(dur)
    sub = sine_glide(t, 115, 42, 0.07) * np.exp(-t / 0.22)
    body = sine_glide(t, 220, 95, 0.03) * np.exp(-t / 0.09) * 0.6
    thump = filt(noise(dur), "lowpass", 900) * np.exp(-t / 0.035) * 0.9
    click = filt(noise(dur), "highpass", 3000) * np.exp(-t / 0.004) * 0.5
    mono = np.tanh(1.6 * (sub + body + thump + click)) / np.tanh(1.6)
    stereo = pan(mono, 0)
    return finish(reverb(taper(stereo), wet=0.1, decay=0.5), -2)


def se_jan():
    """ジャン: 決めの一撃（オーケストラヒット風）"""
    dur = 2.2
    t = t_axis(dur)
    chord = [130.81, 196.0, 261.63, 329.63, 392.0, 523.25]
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    for n, f0 in enumerate(chord):
        for side, cents in ((0, -5), (1, 5)):
            f = f0 * 2 ** (cents / 1200)
            voice = np.zeros_like(t)
            h = 1
            while f * h < 9000:
                voice += np.sin(2 * np.pi * f * h * t + rng.uniform(0, 2 * np.pi)) / h * np.exp(-t / (0.55 / (1 + 0.18 * h)))
                h += 1
            (left if side == 0 else right)[:] += voice / len(chord)
    swell = 1 - np.exp(-t / 0.006)
    hit = sine_glide(t, 140, 70, 0.05) * np.exp(-t / 0.25) * 0.8
    crash = filt(noise(dur), "bandpass", [2500, 9000]) * np.exp(-t / 0.18) * 0.18
    stereo = np.stack([(left + hit) * swell + crash, (right + hit) * swell + crash], axis=1)
    return finish(reverb(taper(stereo), wet=0.28, decay=1.5), -3)


def se_doon():
    """ドーン: 大きな文字がドーンと出る音（重い一撃＋長い余韻）"""
    dur = 3.4
    t = t_axis(dur)
    sub = sine_glide(t, 90, 36, 0.12) * np.exp(-t / 0.9)
    body = sine_glide(t, 180, 70, 0.05) * np.exp(-t / 0.2) * 0.7
    thump = filt(noise(dur), "lowpass", 700) * np.exp(-t / 0.06)
    rumble = filt(noise(dur), "lowpass", 160) * np.exp(-t / 0.7) * 2.5
    power = np.zeros_like(t)
    for f in (65.41, 98.0, 130.81):
        power += np.sign(np.sin(2 * np.pi * f * t)) * 0.12
    power = filt(power, "lowpass", 1200) * np.exp(-t / 0.6)
    mono = np.tanh(1.4 * (sub + body + thump + rumble + power)) / np.tanh(1.4)
    stereo = pan(mono, 0)
    return finish(reverb(taper(stereo), wet=0.25, decay=2.0), -2)


def se_pikon():
    """ピコン: テロップが出るときの軽い音"""
    dur = 0.7
    t = t_axis(dur)
    mono = np.zeros_like(t)
    for start, f, length in ((0.0, 1046.5, 0.09), (0.075, 1568.0, 0.35)):
        s = int(start * SR)
        tt = t[: len(t) - s]
        tone = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 3 * f * tt)
        env = np.exp(-tt / (length / 3)) * (1 - np.exp(-tt / 0.002))
        mono[s:] += tone * env
    stereo = pan(mono, 0)
    return finish(reverb(taper(stereo), wet=0.15, decay=0.5), -6)


def se_shakin():
    """シャキーン: 刃物が光るような金属音"""
    dur = 2.2
    t = t_axis(dur)
    swish = filt(noise(dur), "highpass", 4000) * np.interp(t, [0, 0.06, 0.1, 0.4], [0.2, 1, 0.3, 0]) * 0.6
    ratios = [1, 1.47, 2.09, 2.56, 3.12, 3.9]
    decays = [0.8, 0.6, 0.45, 0.35, 0.25, 0.18]
    amps = [1, 0.7, 0.55, 0.4, 0.3, 0.2]
    start = int(0.05 * SR)
    tt = t[: len(t) - start]
    glide = 1 + 0.03 * (1 - np.exp(-tt / 0.1))
    ring = np.zeros_like(tt)
    for r, d, a in zip(ratios, decays, amps):
        ring += a * np.sin(2 * np.pi * 2400 * r * np.cumsum(glide) / SR) * np.exp(-tt / d)
    left = swish.copy()
    right = swish.copy()
    left[start:] += ring * 0.5
    right[start:] += np.roll(ring, int(0.004 * SR)) * 0.5
    stereo = np.stack([left, right], axis=1)
    return finish(reverb(taper(stereo), wet=0.25, decay=1.2), -5)


SINGLES = {
    "シュッ_横ブラー": se_whoosh,
    "キラーン_光る": se_shine,
    "ドン_箱が出る": se_don,
    "ジャン_決め": se_jan,
    "ドーン_デカ文字": se_doon,
    "ピコン_テロップ": se_pikon,
    "シャキーン": se_shakin,
}

# テンプレートの初期設定どおりのタイミングで並べた音（.mogrt と同じ位置に置くだけで合う）
#   (効果音, 開始フレーム @29.97fps)
SYNCED = {
    "1_地名＋日数_同期": [("ピコン_テロップ", 0)],
    "2_黄色デカ文字ズーム_同期": [("ドーン_デカ文字", 0)],
    "3_青グロー2段_同期": [("シュッ_横ブラー", 30), ("キラーン_光る", 30 + 11)],
    "4_ランキングボード_同期": [("ドン_箱が出る", 30)],
}


def write(path, stereo):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = np.clip(stereo, -1, 1)
    wavfile.write(path, SR, (data * 32767).astype(np.int16))


def main():
    rendered = {}
    for name, fn in SINGLES.items():
        rendered[name] = fn()
        write(os.path.join(HERE, "単体", "SE_" + name + ".wav"), rendered[name])
    for name, events in SYNCED.items():
        length = max(int(round(f / FPS * SR)) + len(rendered[se]) for se, f in events)
        mix = np.zeros((length, 2))
        for se, frame in events:
            s = int(round(frame / FPS * SR))
            mix[s:s + len(rendered[se])] += rendered[se]
        peak = np.max(np.abs(mix))
        if peak > 0.89:
            mix *= 0.89 / peak
        write(os.path.join(HERE, "テンプレ同期", name + ".wav"), mix)
    print("ok")


if __name__ == "__main__":
    main()
