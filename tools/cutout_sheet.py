"""把 AI 產生的 sprite sheet 切格 + 去背。

用法：
    python tools/cutout_sheet.py art/mockexam-sheet.png art/boss 2 2
    python tools/cutout_sheet.py art/<id>-sheet.png art/<id> <欄> <列>

去背為什麼不能直接「把白色變透明」：這些角色本身就是米白色的紙，
一律刪白會把角色挖空。所以改成**從邊界往內 flood fill**，只清掉
「與畫布邊緣相連」的背景白，角色內部的白（凹處、留白）會完整保留。

處理的三種毛病（跟既有繪卡同一套標準）：
  ① 死切白邊 —— 邊界做羽化，不是硬切
  ② 白暈     —— 半透明像素做 un-premultiply，把殘留的白拉掉
  ③ 內凹白   —— flood fill 只吃連通到邊界的區域，凹處不會被誤刪
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque


def cutout(im, tol=26, feather=1.2):
    im = im.convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]
    rgb = a[:, :, :3]

    # 以四角的平均色當背景色（AI 出圖的背景通常很均勻）
    corners = np.concatenate([rgb[:6, :6].reshape(-1, 3), rgb[:6, -6:].reshape(-1, 3),
                              rgb[-6:, :6].reshape(-1, 3), rgb[-6:, -6:].reshape(-1, 3)])
    bg = corners.mean(axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    similar = dist < tol

    # 從邊界 flood fill，只清「連到邊界」的背景
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if similar[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if similar[y, x] and not seen[y, x]:
                seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and similar[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))

    alpha = np.where(seen, 0, 255).astype(np.uint8)
    # 羽化邊界，避免死切白邊
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    # 半透明處把背景色拉掉，消白暈
    af = alpha.astype(np.float32) / 255.0
    out = rgb.astype(np.float32)
    partial = (af > 0.02) & (af < 0.98)
    for c in range(3):
        ch = out[:, :, c]
        ch[partial] = np.clip((ch[partial] - bg[c] * (1 - af[partial])) / np.maximum(af[partial], .05), 0, 255)
        out[:, :, c] = ch
    return Image.fromarray(np.dstack([out.astype(np.uint8), alpha]), 'RGBA')


def trim(im, pad=6):
    """裁掉四周多餘的透明區，讓每格的角色盡量填滿。"""
    bbox = im.split()[3].getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def main():
    if len(sys.argv) < 5:
        print(__doc__); sys.exit(1)
    src, outdir, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    im = Image.open(src)
    os.makedirs(outdir, exist_ok=True)
    cw, ch = im.width // cols, im.height // rows
    i = 0
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            done = trim(cutout(cell))
            path = os.path.join(outdir, f'{i}.png')
            done.save(path)
            print(f'{path}  {done.size[0]}x{done.size[1]}  {os.path.getsize(path)//1024}KB')
            i += 1


if __name__ == '__main__':
    main()
