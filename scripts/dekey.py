#!/usr/bin/env python3
"""Tách nền cho ảnh do model ảnh sinh ra.

Model không xuất alpha thật — nó *vẽ* hoạ tiết ca-rô giả-trong-suốt, cạnh ô
thường lẻ nên không dò được theo pha. Ở đây nền được nhận bằng dấu hiệu cục bộ:
trong một cửa sổ nhỏ, vùng ca-rô luôn có đủ cả hai sắc xám đặc trưng, còn mảng
phẳng của vật thể (lông kem, cổ tất trắng) thì không. Vùng nào mang dấu hiệu đó
và nối được ra mép ảnh mới bị coi là nền; phần còn lại lấp lỗ, làm mịn rìa.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def guess_tile(g):
    """Cạnh ô ca-rô (xấp xỉ) từ khoảng cách giữa các chỗ đổi sắc."""
    h, w = g.shape
    lines = [g[2, :], g[6, :], g[h - 3, :], g[h - 7, :], g[:, 2], g[:, 6], g[:, w - 3], g[:, w - 7]]
    runs = []
    for line in lines:
        idx = np.flatnonzero(np.abs(np.diff(line.astype(np.float32))) > 2.5)
        if len(idx) < 3:
            continue
        r = np.diff(idx)
        runs.append(r[(r > 3) & (r < 200)])
    if not runs:
        return None
    runs = np.concatenate(runs)
    if len(runs) < 6:
        return None
    return int(np.median(runs))


def two_levels(g, chroma, tile):
    """Hai sắc xám của ca-rô: hai đỉnh lớn nhất trong histogram vùng ít màu."""
    v = g[(chroma < 14)]
    if v.size < 1000:
        return None
    hist, edges = np.histogram(v, bins=128, range=(0, 256))
    hist = ndimage.uniform_filter1d(hist.astype(np.float32), 3)
    order = np.argsort(hist)[::-1]
    peaks = []
    for i in order:
        c = (edges[i] + edges[i + 1]) / 2
        if all(abs(c - p) > 8 for p in peaks):
            peaks.append(float(c))
        if len(peaks) == 2:
            break
    if len(peaks) < 2 or hist[order[0]] < v.size * 0.02:
        return None
    lo, hi = sorted(peaks)
    return (lo, hi) if hi - lo > 8 else None


def chroma_key(im, tol=90):
    """Nền một màu rực (magenta): khoá theo màu, có khử ám màu ở rìa."""
    a = np.array(im.convert('RGB')).astype(np.float32)
    ring = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3),
                           a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    bg = np.median(ring, 0)
    if bg.max() - bg.min() < 60:
        return None
    d = np.sqrt(((a - bg) ** 2).sum(2))
    alpha = np.clip((d - tol * 0.45) / (tol * 0.9), 0, 1)
    solid = alpha > 0.85
    solid = ndimage.binary_opening(solid, np.ones((3, 3)))
    lab, n = ndimage.label(solid)
    if n:
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        solid = np.isin(lab, np.flatnonzero(sizes > max(40.0, sizes.max() * 0.0008)) + 1)
    near = ndimage.binary_dilation(solid, np.ones((3, 3)), iterations=3)
    alpha = np.where(near, alpha, 0.0)
    # khử ám ở rìa bán trong suốt
    rgb = a.copy()
    m = (alpha > 0.05) & (alpha < 0.98)
    if m.any():
        k = alpha[m][:, None]
        rgb[m] = np.clip((a[m] - bg * (1 - k)) / np.maximum(k, 0.25), 0, 255)
    # khử ám màu phông bám vào vật thể (đầu lá thông ánh tím): chỉ động vào
    # pixel có sắc màu gần sắc của phông, nên quả mọng đỏ không bị ảnh hưởng
    order = np.argsort(bg)
    lowc, hi1, hi2 = int(order[0]), int(order[1]), int(order[2])
    import colorsys
    key_h = colorsys.rgb_to_hsv(*(bg / 255.0))[0] * 360.0
    mx = rgb.max(2); mn = rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-3), 0)
    hsv_h = np.zeros_like(mx)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    delta = np.maximum(mx - mn, 1e-6)
    hsv_h = np.where(mx == r, ((g - b) / delta) % 6,
            np.where(mx == g, ((b - r) / delta) + 2, ((r - g) / delta) + 4)) * 60.0
    dh = np.abs((hsv_h - key_h + 180) % 360 - 180)
    near = (dh < 50) & (sat > 0.10)
    clamp = np.minimum(rgb[:, :, hi1], rgb[:, :, lowc])
    rgb[:, :, hi1] = np.where(near, clamp, rgb[:, :, hi1])
    clamp2 = np.minimum(rgb[:, :, hi2], rgb[:, :, lowc])
    rgb[:, :, hi2] = np.where(near, clamp2, rgb[:, :, hi2])
    return np.dstack([rgb, alpha * 255]).astype(np.uint8)


def background_mask(im):
    a = np.array(im.convert('RGB')).astype(np.float32)
    g = a.mean(2)
    chroma = a.max(2) - a.min(2)
    h, w = g.shape
    cand = np.zeros((h, w), bool)

    tile = guess_tile(g) or 16
    lv = two_levels(g, chroma, tile)
    if lv:
        dark, light = lv
        win = int(max(5, round(tile * 2.2)) | 1)
        lmin = ndimage.minimum_filter(g, win)
        lmax = ndimage.maximum_filter(g, win)
        tol = max(9.0, (light - dark) * 0.35)
        cand |= (np.abs(lmax - light) < tol) & (np.abs(lmin - dark) < tol) & (chroma < 26)

    # viền khung đặc màu: chỉ xét sát mép ảnh
    ring = np.concatenate([a[:2].reshape(-1, 3), a[-2:].reshape(-1, 3),
                           a[:, :2].reshape(-1, 3), a[:, -2:].reshape(-1, 3)])
    rc = np.median(ring, 0)
    band = np.zeros((h, w), bool)
    b = max(4, int(min(h, w) * 0.04))
    band[:b] = band[-b:] = True
    band[:, :b] = band[:, -b:] = True
    cand |= band & (np.sqrt(((a - rc) ** 2).sum(2)) < 20)

    cand = ndimage.binary_closing(cand, np.ones((3, 3)), border_value=1)
    seed = np.zeros((h, w), bool)
    seed[0] = seed[-1] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= cand
    if not seed.any():
        return None
    lab, _ = ndimage.label(cand)
    keep = np.unique(lab[seed & (lab > 0)])
    bg = np.isin(lab, keep[keep > 0])
    # cửa sổ min/max ăn lẹm vào vật thể khoảng nửa cửa sổ -> nhả lại
    bg = ndimage.binary_erosion(bg, np.ones((3, 3)), iterations=max(1, tile // 3), border_value=1)
    return bg


def fill_small_holes(mask, max_frac=0.0015):
    """Lấp lỗ nhỏ (ô ca-rô lọt vào trong vật thể) nhưng GIỮ khoảng hở lớn
    giữa các nhánh lá — nếu lấp hết thì cành thông sẽ dính một mảng trắng."""
    filled = ndimage.binary_fill_holes(mask)
    holes = filled & ~mask
    lab, n = ndimage.label(holes)
    if not n:
        return filled
    sizes = ndimage.sum(holes, lab, range(1, n + 1))
    lim = mask.size * max_frac
    keep = np.flatnonzero(sizes <= lim) + 1
    return mask | np.isin(lab, keep)


def subject_mask(im):
    bg = background_mask(im)
    if bg is None:
        return None
    subj = fill_small_holes(~bg)
    subj = ndimage.binary_opening(subj, np.ones((3, 3)))
    subj = fill_small_holes(subj)
    lab, n = ndimage.label(subj)
    if n:
        sizes = ndimage.sum(subj, lab, range(1, n + 1))
        subj = np.isin(lab, np.flatnonzero(sizes > max(60.0, sizes.max() * 0.0015)) + 1)
    # bỏ mẩu nền xám còn sót lại giữa các nhánh: nhỏ, xám nhạt, không có màu
    a = np.array(im.convert('RGB')).astype(np.float32)
    chroma = a.max(2) - a.min(2)
    lab, n = ndimage.label(subj)
    if n > 1:
        sizes = ndimage.sum(subj, lab, range(1, n + 1))
        big = sizes.max()
        meanchroma = ndimage.mean(chroma, lab, range(1, n + 1))
        drop = [i + 1 for i in range(n) if sizes[i] < big * 0.06 and meanchroma[i] < 22]
        if drop:
            subj = subj & ~np.isin(lab, drop)
    f = subj.mean()
    return None if (f < 0.004 or f > 0.95) else subj


def refine(im, subj, tile):
    """Gọt vành trắng còn sót quanh vật thể: trong vành biên, pixel nào vẫn mang
    đúng sắc của ô ca-rô *và* nằm cạnh vùng có đủ hai sắc thì cắt bỏ."""
    a = np.array(im.convert('RGB')).astype(np.float32)
    g = a.mean(2)
    chroma = a.max(2) - a.min(2)
    lv = two_levels(g, chroma, tile)
    if not lv:
        return subj
    dark, light = lv
    win = int(max(5, tile + 3) | 1)
    lmin = ndimage.minimum_filter(g, win)
    lmax = ndimage.maximum_filter(g, win)
    tol = max(9.0, (light - dark) * 0.35)
    bimodal = (np.abs(lmax - light) < tol) & (np.abs(lmin - dark) < tol)
    ring = subj & ~ndimage.binary_erosion(
        subj, np.ones((3, 3)), iterations=max(2, int(tile * 1.2)), border_value=1)
    bgish = (chroma < 24) & ((np.abs(g - light) < 10) | (np.abs(g - dark) < 10))
    return subj & ~(ring & bgish & bimodal)


def cut(path, out, feather=0.8):
    im = Image.open(path).convert('RGB')
    ck = chroma_key(im)
    if ck is not None:
        Image.fromarray(ck, 'RGBA').save(out, optimize=True)
        return float((ck[:, :, 3] > 128).mean())
    subj = subject_mask(im)
    if subj is None:
        print(f'  ! {path}: không nhận ra nền', file=sys.stderr)
        return None
    g = np.array(im).astype(np.float32).mean(2)
    subj = refine(im, subj, guess_tile(g) or 16)
    subj = fill_small_holes(subj)
    alpha = np.array(Image.fromarray((subj * 255).astype(np.uint8))
                     .filter(ImageFilter.GaussianBlur(feather))).astype(np.float32)
    alpha = np.clip((alpha - 70) * (255.0 / 140.0), 0, 255)
    Image.fromarray(np.dstack([np.array(im), alpha.astype(np.uint8)]), 'RGBA').save(out, optimize=True)
    return float((alpha > 128).mean())


if __name__ == '__main__':
    for p in sys.argv[1:]:
        r = cut(p, p.replace('.png', '-cut.png'))
        print(f'{p}: subject={r if r is None else round(r, 3)}')
