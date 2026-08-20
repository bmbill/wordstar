"""把 AI 產生的 sprite sheet 切格 + 去背。

用法：
    python tools/cutout_sheet.py art/mockexam-sheet.png art/boss 2 2
    python tools/cutout_sheet.py art/<id>-sheet.png art/<id> <欄> <列> [--paper]

去背為什麼不能直接「把白色變透明」：這些角色本身就是米白色的紙，
一律刪白會把角色挖空。所以改成**從邊界往內 flood fill**，只清掉
「與畫布邊緣相連」的背景白，角色內部的白（凹處、留白）會完整保留。

處理的三種毛病（跟既有繪卡同一套標準）：
  ① 死切白邊 —— 邊界做羽化，不是硬切
  ② 白暈     —— 半透明像素做 un-premultiply，把殘留的白拉掉
  ③ 內凹白   —— flood fill 只吃連通到邊界的區域，凹處不會被誤刪

--paper：紙質背景專用（米黃紙紋 + 墨紋、漸層紙）。預設那套「一個背景色 +
小容差」碰到花背景會卡住，留下大塊切不掉的背景。這個模式改成：

  * 背景色盤取整張圖的外圈 + 格線之間的縫（那些位置一定是背景），量化成一組
    代表色，每個像素跟「最接近的那個」比 —— 深墨紋才吃得到。
  * 容差放寬到吃得掉紙紋，改用角色那圈近白的 die-cut 外框當 flood fill 的牆。
  * 順便清掉紙上亮片留下的小碎點。

**只有每個角色都真的有一圈連續白框時才可以開** —— 沒有白框的圖（多數繪卡
就沒有）開了會從臉、皮膚一路吃進去。切完如果邊框還留著背景，程式會提示你
考慮這個旗標。預設模式的行為沒有變，舊 sheet 重切結果一樣。
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque


def quantize(band, k=20, cover=.995):
    """把取樣到的背景像素量化成一組代表色（花背景不能只用一個色代表）。"""
    q = band // 16                                        # 粗量化成 16 階的色格
    keys, counts = np.unique(q, axis=0, return_counts=True)
    pal, acc, total = [], 0, counts.sum()
    for i in np.argsort(-counts):
        pal.append(band[(q == keys[i]).all(axis=1)].mean(axis=0))
        acc += counts[i]
        if len(pal) >= k or acc / total >= cover:
            break
    return np.asarray(pal, dtype=np.float32)


def sheet_palette(im, cols, rows, ring=8):
    """整張圖的背景色盤：外圈 + 格線之間的縫（角色不重疊，那些位置一定是背景）。

    只取單格的邊框不夠 —— 紙上的深墨紋常常只出現在某幾格中間，那格的邊框
    取不到，flood fill 就會卡在墨紋前面留一片背景。
    """
    a = np.asarray(im.convert('RGB')).astype(np.int16)
    h, w = a.shape[:2]
    cw, ch = w // cols, h // rows
    band = [a[:ring].reshape(-1, 3), a[-ring:].reshape(-1, 3),
            a[:, :ring].reshape(-1, 3), a[:, -ring:].reshape(-1, 3)]
    for c in range(1, cols):
        band.append(a[:, c * cw - ring // 2:c * cw + ring // 2].reshape(-1, 3))
    for r in range(1, rows):
        band.append(a[r * ch - ring // 2:r * ch + ring // 2].reshape(-1, 3))
    return quantize(np.concatenate(band))


def cutout(im, tol=26, feather=1.2, pal=None, paper_tol=44):
    im = im.convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]
    rgb = a[:, :, :3]

    if pal is None:
        # 以四角的平均色當背景色（AI 出圖的背景通常很均勻）
        corners = np.concatenate([rgb[:6, :6].reshape(-1, 3), rgb[:6, -6:].reshape(-1, 3),
                                  rgb[-6:, :6].reshape(-1, 3), rgb[-6:, -6:].reshape(-1, 3)])
        bg = corners.mean(axis=0)
        similar = np.sqrt(((rgb - bg) ** 2).sum(axis=2)) < tol
        bgmap = np.broadcast_to(bg.astype(np.float32), rgb.shape)
    else:
        # --paper：比最接近的那個背景色，容差放寬吃紙紋，近白外框當牆擋住 flood fill
        d = np.sqrt(((rgb[:, :, None, :].astype(np.float32) - pal[None, None]) ** 2).sum(axis=3))
        bgmap = pal[d.argmin(axis=2)]                     # 每個像素各自的背景參考色
        wall = (rgb.min(axis=2) >= 225) & (rgb.ptp(axis=2) <= 22)
        wall = np.asarray(Image.fromarray((wall * 255).astype(np.uint8))
                          .filter(ImageFilter.MaxFilter(3))) > 127   # 補外框的針孔
        similar = (d.min(axis=2) < paper_tol) & ~wall

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
    if pal is not None:
        alpha = drop_specks(alpha)
    # 羽化邊界，避免死切白邊
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    # 半透明處把背景色拉掉，消白暈
    af = alpha.astype(np.float32) / 255.0
    out = rgb.astype(np.float32)
    partial = (af > 0.02) & (af < 0.98)
    for c in range(3):
        ch = out[:, :, c]
        ch[partial] = np.clip((ch[partial] - bgmap[:, :, c][partial] * (1 - af[partial]))
                              / np.maximum(af[partial], .05), 0, 255)
        out[:, :, c] = ch
    return Image.fromarray(np.dstack([out.astype(np.uint8), alpha]), 'RGBA')


def drop_specks(alpha, min_frac=.002):
    """清掉背景殘留的小碎點（紙上的亮片、雜訊）—— 它們會把 trim 的邊界撐大。

    只砍面積小於整格 min_frac 的連通塊，所以「浮在頭上的小皇冠」這種刻意
    分離的配件（比 min_frac 大得多）會留著。
    """
    m = alpha > 127
    h, w = m.shape
    limit = m.size * min_frac
    seen = np.zeros((h, w), bool)
    for sy in range(h):
        for sx in range(w):
            if not m[sy, sx] or seen[sy, sx]:
                continue
            seen[sy, sx] = True
            blob, q = [(sy, sx)], deque([(sy, sx)])
            while q:
                y, x = q.popleft()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        blob.append((ny, nx)); q.append((ny, nx))
            if len(blob) < limit:
                ys, xs = zip(*blob)
                alpha[np.asarray(ys), np.asarray(xs)] = 0
    return alpha


def trim(im, pad=6):
    """裁掉四周多餘的透明區，讓每格的角色盡量填滿。"""
    bbox = im.split()[3].getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def edge_left(im, ring=6):
    """切完後那格外圈還剩多少不透明 —— 外圈一定是背景，留著就是 flood fill 卡住。"""
    a = np.asarray(im.split()[3]) > 128
    return np.concatenate([a[:ring].ravel(), a[-ring:].ravel(),
                           a[:, :ring].ravel(), a[:, -ring:].ravel()]).mean()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    paper = '--paper' in sys.argv[1:]
    if len(args) < 4:
        print(__doc__); sys.exit(1)
    src, outdir, cols, rows = args[0], args[1], int(args[2]), int(args[3])
    im = Image.open(src)
    os.makedirs(outdir, exist_ok=True)
    pal = sheet_palette(im, cols, rows) if paper else None
    cw, ch = im.width // cols, im.height // rows
    i, stuck = 0, []
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            cut = cutout(cell, pal=pal)
            left = edge_left(cut)
            done = trim(cut)
            path = os.path.join(outdir, f'{i}.png')
            done.save(path)
            print(f'{path}  {done.size[0]}x{done.size[1]}  {os.path.getsize(path)//1024}KB'
                  + (f'  [!] edge bg left {left:.0%}' if left > .06 else ''))
            if left > .06:
                stuck.append(i)
            i += 1
    if stuck and not paper:
        print()
        print(f'[!] cells {stuck} still show background at the cell edge.'
              ' If every character has a solid white die-cut outline, re-run with --paper.')


if __name__ == '__main__':
    main()
