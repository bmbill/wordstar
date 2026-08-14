"""產生魔王戰音效（16-bit 44.1k 單聲道 WAV）。

執行： python tools/make_raid_sfx.py

為什麼不用 Tone.js 即時合成：合成的單發音只有 0.1~0.3 秒，聽起來是「一個音」
而不是「一段聲音」。這裡直接算出完整波形，所以可以做到真正的多段包絡、
層疊、以及卷積殘響尾巴 —— 那才是既有 mp3 素材聽起來有份量的原因。

打擊感的三個來源，每個音效都照這個配方組：
  ① 瞬態 (5~15ms 的高頻噪音) —— 「啪」，決定清脆度
  ② 本體 (音高急速下滑的正弦) —— 「咚」，決定重量
  ③ 尾巴 (卷積殘響)           —— 決定空間感與「一段」的長度
中低頻 (150~250Hz) 要有能量，因為手機喇叭放不出 60Hz。
"""
import numpy as np, wave, os, math

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'audio', 'sfx')


def t(dur):
    return np.linspace(0, dur, int(SR * dur), endpoint=False)


def env(n, attack, decay, curve=3.0):
    """打擊型包絡：極短起音 + 指數衰減。"""
    a = max(1, int(SR * attack))
    e = np.exp(-curve * np.linspace(0, 1, max(1, n - a)))
    return np.concatenate([np.linspace(0, 1, a), e])[:n]


def noise(dur, seed=0):
    rng = np.random.default_rng(seed)
    return rng.uniform(-1, 1, int(SR * dur))


def onepole_hp(x, fc):
    """單極高通，用來把噪音打亮（瞬態層）。"""
    a = math.exp(-2 * math.pi * fc / SR)
    y = np.zeros_like(x)
    prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = a * (prev_y + v - prev_x)
        prev_x = v
        y[i] = prev_y
    return y


def onepole_lp(x, fc):
    a = math.exp(-2 * math.pi * fc / SR)
    y = np.zeros_like(x)
    prev = 0.0
    for i, v in enumerate(x):
        prev = (1 - a) * v + a * prev
        y[i] = prev
    return y


def sweep(dur, f0, f1, curve=6.0):
    """音高下滑正弦 —— 打擊聲的「重量」來源。"""
    tt = t(dur)
    f = f1 + (f0 - f1) * np.exp(-curve * tt / max(dur, 1e-6))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase)


def reverb(x, decay=0.7, wet=0.3, seed=7):
    """卷積殘響：拿指數衰減的噪音當脈衝響應。尾巴是「一段聲音」的關鍵。"""
    ir_len = int(SR * decay)
    rng = np.random.default_rng(seed)
    ir = rng.uniform(-1, 1, ir_len) * np.exp(-5 * np.linspace(0, 1, ir_len))
    ir[:int(SR * 0.005)] = 0          # 留一點 pre-delay，直接音才清楚
    n = len(x) + ir_len - 1
    nfft = 1 << (n - 1).bit_length()
    wet_sig = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft))[:n]
    wet_sig /= (np.abs(wet_sig).max() + 1e-9)
    out = np.zeros(n)
    out[:len(x)] = x * (1 - wet)
    out += wet_sig * wet
    return out


def fit(x, dur):
    """裁切或補零到指定長度，並在結尾淡出避免爆音。"""
    n = int(SR * dur)
    y = np.zeros(n)
    m = min(n, len(x))
    y[:m] = x[:m]
    fade = int(SR * 0.03)
    if n > fade:
        y[-fade:] *= np.linspace(1, 0, fade)
    return y



def add(y, start, seg, gain=1.0):
    """把 seg 疊到 y 的 start 位置，超出長度就裁掉。"""
    start = max(0, int(start))
    n = min(len(seg), len(y) - start)
    if n > 0:
        y[start:start + n] += seg[:n] * gain
    return y

def impact(seed=0, sub=170.0, bright=1.0):
    """標準打擊：瞬態 + 本體 + 低頻，三層。"""
    crack = onepole_hp(noise(0.05, seed), 2200) * env(int(SR * 0.05), 0.0004, 0.05, 9) * 0.55 * bright
    body = sweep(0.30, sub * 3.4, sub, 9) * env(int(SR * 0.30), 0.0005, 0.30, 5) * 0.95
    low = sweep(0.35, 150, 62, 7) * env(int(SR * 0.35), 0.001, 0.35, 4) * 0.5
    n = max(len(crack), len(body), len(low))
    out = np.zeros(n)
    for layer in (crack, body, low):
        out[:len(layer)] += layer
    return out


def save(name, x, peak=0.89):
    x = x / (np.abs(x).max() + 1e-9) * peak
    data = (x * 32767).astype('<i2')
    path = os.path.abspath(os.path.join(OUT, name))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f'{name:22s} {len(x)/SR:.2f}s  {os.path.getsize(path)//1024}KB')


# ---------- 擋下大招：金屬撞擊 + 明亮泛音尾巴 ----------
def make_block():
    x = impact(1, sub=220, bright=1.3)
    ring = np.zeros(int(SR * 1.2))
    for f, amp in ((880, .5), (1320, .34), (1760, .22), (2640, .13)):
        s = np.sin(2 * np.pi * f * t(1.2)) * np.exp(-3.2 * np.linspace(0, 1, len(ring)))
        ring += s * amp
    y = np.zeros(int(SR * 1.5))
    add(y, 0, x)
    add(y, 0, ring, 0.42)
    return fit(reverb(y, 0.85, 0.34), 1.5)


# ---------- 被當掉：低沉下墜 + 紙張皺褶 ----------
def make_down():
    y = np.zeros(int(SR * 2.0))
    add(y, 0, impact(2, sub=95), 1.1)
    fall = sweep(1.5, 320, 55, 2.6) * env(int(SR * 1.5), 0.01, 1.5, 2.4) * 0.55
    add(y, 0, fall)
    crumple = onepole_hp(noise(1.1, 3), 1400)
    crumple *= (np.abs(noise(1.1, 4)) ** 3) * np.exp(-2.4 * np.linspace(0, 1, len(crumple)))
    add(y, int(SR * .12), crumple, 0.5)
    return fit(reverb(y, 1.1, 0.32), 2.0)


# ---------- 補考成功：上行琶音 + 長殘響 ----------
def make_revive():
    y = np.zeros(int(SR * 2.0))
    for i, f in enumerate((392, 523, 659, 784, 1047)):
        st = int(SR * 0.08 * i)
        d = 1.5
        tone = (np.sin(2 * np.pi * f * t(d)) * .6 + np.sin(4 * np.pi * f * t(d)) * .22)
        tone *= np.exp(-3.0 * np.linspace(0, 1, len(tone)))
        add(y, st, tone, 0.5 + i * 0.07)
    spark = onepole_hp(noise(0.4, 5), 3800) * env(int(SR * 0.4), 0.002, 0.4, 6) * 0.3
    add(y, 0, spark)
    return fit(reverb(y, 1.3, 0.42), 2.0)


# ---------- 收卷狂暴：警報上行 + 重擊 ----------
def make_enrage():
    y = np.zeros(int(SR * 2.0))
    tt = t(1.25)
    siren = np.sin(2 * np.pi * (180 + 340 * (tt / 1.25) ** 1.7) * tt)
    siren *= (0.25 + 0.75 * (tt / 1.25)) * np.concatenate(
        [np.linspace(0, 1, int(SR * .1)), np.ones(len(tt) - int(SR * .1))])
    trem = 1 + 0.35 * np.sin(2 * np.pi * 11 * tt)   # 顫音，像警報器
    add(y, 0, siren * trem, 0.5)
    add(y, int(SR * 1.2), impact(6, sub=110), 1.25)
    return fit(reverb(y, 1.0, 0.3), 2.0)


# ---------- 通關：四音上行號角 ----------
def make_win():
    y = np.zeros(int(SR * 2.5))
    chords = [(392, 494, 587), (440, 554, 659), (494, 622, 740), (523, 659, 784, 1047)]
    for i, ch in enumerate(chords):
        st = int(SR * 0.17 * i)
        d = 2.2
        seg = np.zeros(int(SR * d))
        for f in ch:
            saw = sum(np.sin(2 * np.pi * f * k * t(d)) / k for k in (1, 2, 3))
            seg += saw
        seg *= np.exp(-2.0 * np.linspace(0, 1, len(seg))) / len(ch)
        add(y, st, seg, 0.55 + i * 0.13)
        add(y, st, impact(10 + i, sub=200), 0.4)
    return fit(reverb(y, 1.4, 0.36), 2.5)


# ---------- 全滅：下行 + 悶鼓 ----------
def make_wipe():
    y = np.zeros(int(SR * 2.5))
    for i, ch in enumerate([(523, 622), (466, 554), (415, 494), (349, 415)]):
        st = int(SR * 0.28 * i)
        d = 2.0
        seg = np.zeros(int(SR * d))
        for f in ch:
            seg += np.sin(2 * np.pi * f * t(d)) + 0.3 * np.sin(4 * np.pi * f * t(d))
        seg *= np.exp(-2.2 * np.linspace(0, 1, len(seg))) / len(ch)
        add(y, st, seg, 0.6)
        thud = sweep(0.5, 160, 45, 6) * env(int(SR * .5), .001, .5, 4)
        add(y, st, thud, 0.55)
    y = onepole_lp(y, 2600)      # 悶掉高頻，做出「沉下去」的感覺
    return fit(reverb(y, 1.5, 0.4), 2.5)


# ---------- 命中：短促但仍有尾巴（每題都會響，不能太長） ----------
def make_hit(idx, sub):
    y = np.zeros(int(SR * 0.75))
    add(y, 0, impact(20 + idx, sub=sub))
    return fit(reverb(y, 0.5, 0.24), 0.75)


if __name__ == '__main__':
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    save('raid-block.wav', make_block())
    save('raid-down.wav', make_down())
    save('raid-revive.wav', make_revive())
    save('raid-enrage.wav', make_enrage())
    save('raid-win.wav', make_win())
    save('raid-wipe.wav', make_wipe())
    for i, sub in enumerate((150, 175, 205, 240)):
        save(f'raid-hit-{i+1}.wav', make_hit(i, sub))
