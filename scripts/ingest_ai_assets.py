#!/usr/bin/env python3
"""Biến ảnh AI thô (artgen/raw) thành asset dùng được cho render server.

- Mảnh artwork: cắt viền trong suốt, thu nhỏ, tách tất thành thân (tint được) + cổ lông.
- Ảnh mockup: tự dò vùng sản phẩm trống -> mask, light map (lấy từ chính độ sáng
  của ảnh nên giữ được nếp vải và bóng thật), và 4 góc của mặt in.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage

RAW = '/home/claude/artgen/raw'
ART = '/home/claude/mockup-server/assets/art'
MOCK = '/home/claude/mockup-server/assets/mockups'
REPORT = {}


# ---------------------------------------------------------------- helpers
def load(name, cut=True):
    """Ưu tiên bản đã tách nền (-cut.png) do dekey.py tạo."""
    p = os.path.join(RAW, name + '-cut.png')
    if cut and os.path.exists(p):
        return Image.open(p)
    return Image.open(os.path.join(RAW, name + '.png'))


def shave(im, px):
    """Gọt bớt viền trắng kiểu sticker mà model tự vẽ quanh vật thể."""
    a = np.array(im.convert('RGBA'))
    m = ndimage.binary_erosion(a[:, :, 3] > 128, np.ones((3, 3)), iterations=px, border_value=1)
    al = np.minimum(a[:, :, 3], (m * 255).astype(np.uint8))
    al = np.array(Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.6)))
    a[:, :, 3] = al
    return Image.fromarray(a, 'RGBA')


def alpha_bbox(im, thr=10):
    a = np.array(im.convert('RGBA'))[:, :, 3]
    ys, xs = np.where(a > thr)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def trim(im, pad=2, thr=10):
    bb = alpha_bbox(im, thr)
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    x0 = max(0, x0 - pad); y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad); y1 = min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def fit(im, maxside):
    if max(im.size) <= maxside:
        return im
    s = maxside / max(im.size)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def clean_alpha(im, floor=6):
    """Bỏ rìa alpha lờ mờ do model sinh ra (viền xám quanh vật thể)."""
    a = np.array(im.convert('RGBA'))
    al = a[:, :, 3].astype(np.float32)
    al = np.clip((al - floor) * (255.0 / (255 - floor)), 0, 255)
    a[:, :, 3] = al.astype(np.uint8)
    return Image.fromarray(a, 'RGBA')


def save_part(im, name, maxside=820):
    im = clean_alpha(fit(trim(im), maxside))
    p = os.path.join(ART, name + '.png')
    im.save(p, optimize=True)
    REPORT[name] = {'size': im.size, 'bytes': os.path.getsize(p)}
    return im


def drop_white(im, lum=228, chroma_max=22, feather=0.8):
    """Xoá mảng trắng/xám nhạt còn sót (viền sticker model tự vẽ) khỏi mảnh
    vốn không có chi tiết trắng nào — lá thông, quả mọng, chuông vàng."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    g = a[:, :, :3].mean(2)
    chroma = a[:, :, :3].max(2) - a[:, :, :3].min(2)
    kill = (g > lum) & (chroma < chroma_max)
    kill = ndimage.binary_opening(kill, np.ones((3, 3)))
    kill = ndimage.binary_dilation(kill, np.ones((3, 3)))
    al = np.where(kill, 0, a[:, :, 3])
    al = np.array(Image.fromarray(al.astype(np.uint8)).filter(ImageFilter.GaussianBlur(feather)))
    a[:, :, 3] = al
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def fade_bottom(im, frac=0.10):
    """Làm mờ dần mép dưới: ảnh sinh ra bị cắt phẳng ở đáy, đặt lên nền sẽ
    lộ một đường thẳng. Mờ dần thì chân tuyết tan vào nền."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    hgt = a.shape[0]
    n = max(2, int(hgt * frac))
    ramp = np.linspace(1.0, 0.0, n)[:, None]
    a[hgt - n:, :, 3] *= ramp
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def to_grey(im):
    """Giữ alpha, chuyển màu về xám -> tint nhân màu cho ra đúng sắc độ."""
    a = np.array(im.convert('RGBA')).astype(np.float32)
    l = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    a[:, :, 0] = a[:, :, 1] = a[:, :, 2] = l
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


# ------------------------------------------------------- stocking split
def split_stocking(name, out_body, out_cuff):
    """Tách cổ lông trắng khỏi thân tất, giữ nguyên khung ảnh để xếp chồng khớp."""
    im = clean_alpha(fit(trim(load(name)), 900))
    a = np.array(im).astype(np.float32)
    al = a[:, :, 3]
    lum = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    h = im.height
    rows = []
    for y in range(h):
        m = al[y] > 120
        rows.append(lum[y][m].mean() if m.sum() > 6 else 0.0)
    rows = np.array(rows)
    top = next((y for y in range(h) if rows[y] > 0), 0)
    # cổ lông = dải sáng ngay dưới móc treo; tìm chỗ sáng tụt xuống dưới ngưỡng
    bright = rows[top:int(h * 0.55)]
    if len(bright) == 0:
        split = int(h * 0.2)
    else:
        hi = np.percentile(bright[bright > 0], 85) if (bright > 0).any() else 240
        thr = hi * 0.93
        split = None
        run = 0
        for i, v in enumerate(bright):
            if v and v < thr:
                run += 1
                if run >= max(4, int(h * 0.012)):
                    split = top + i - run + 1
                    break
            else:
                run = 0
        if split is None:
            split = top + int(h * 0.22)
    feather = max(2, int(h * 0.006))
    yy = np.arange(h)[:, None]
    ramp = np.clip((yy - (split - feather)) / (2.0 * feather + 1e-6), 0, 1)  # 0 trên, 1 dưới
    body = a.copy(); body[:, :, 3] = al * ramp[:, 0][:, None]
    cuff = a.copy(); cuff[:, :, 3] = al * (1 - ramp[:, 0][:, None])
    bi = to_grey(Image.fromarray(body.astype(np.uint8), 'RGBA'))
    ci = Image.fromarray(cuff.astype(np.uint8), 'RGBA')
    bi.save(os.path.join(ART, out_body + '.png'), optimize=True)
    ci.save(os.path.join(ART, out_cuff + '.png'), optimize=True)
    REPORT[out_body] = {'size': bi.size, 'split_row': int(split), 'of': h}
    REPORT[out_cuff] = {'size': ci.size}
    return split, h


# ------------------------------------------------------------ quad fit
def hull(points):
    pts = sorted(map(tuple, points))
    if len(pts) < 3:
        return np.array(pts)
    def half(ps):
        out = []
        for p in ps:
            while len(out) >= 2:
                (x1, y1), (x2, y2) = out[-2], out[-1]
                if (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1) <= 0:
                    out.pop()
                else:
                    break
            out.append(p)
        return out
    return np.array(half(pts)[:-1] + half(pts[::-1])[:-1], dtype=float)


def biggest_quad(mask):
    ys, xs = np.where(mask)
    pts = np.stack([xs, ys], 1).astype(float)
    if len(pts) > 4000:
        pts = pts[np.random.default_rng(7).choice(len(pts), 4000, replace=False)]
    H = hull(pts)
    if len(H) > 40:  # thưa bớt cho nhanh
        H = H[np.linspace(0, len(H) - 1, 40).astype(int)]
    n = len(H)
    best, quad = -1, None
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                for l in range(k + 1, n):
                    p = H[[i, j, k, l]]
                    a = 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))
                    if a > best:
                        best, quad = a, p
    # xếp theo thứ tự TL, TR, BR, BL
    c = quad.mean(0)
    ang = np.arctan2(quad[:, 1] - c[1], quad[:, 0] - c[0])
    quad = quad[np.argsort(ang)]
    start = np.argmin([(q[0] - 0) ** 2 + (q[1] - 0) ** 2 for q in quad])
    quad = np.roll(quad, -start, axis=0)
    return [[int(round(x)), int(round(y))] for x, y in quad]


# ------------------------------------------------------------- scenes
def segment_flat(img, sat_max=0.22, v_lo=0.30, v_hi=0.97, border_margin=0.0):
    hsv = np.array(img.convert('HSV')).astype(np.float32) / 255.0
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    m = (s < sat_max) & (v > v_lo) & (v < v_hi)
    if border_margin:
        h, w = m.shape
        b = int(min(h, w) * border_margin)
        m[:b] = m[-b:] = False
        m[:, :b] = m[:, -b:] = False
    m = ndimage.binary_opening(m, np.ones((7, 7)))
    lab, n = ndimage.label(m)
    if n == 0:
        return m
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = (np.argmax(sizes) + 1)
    m = lab == keep
    m = ndimage.binary_closing(m, np.ones((15, 15)))
    m = ndimage.binary_fill_holes(m)
    return m


def write_scene(name, img, mask, quad, out, size, light_gamma=1.0, light_range=(55, 205), round_face=False):
    os.makedirs(out, exist_ok=True)
    img = img.convert('RGB').resize(size, Image.LANCZOS)
    mk = Image.fromarray((mask * 255).astype(np.uint8)).resize(size, Image.LANCZOS)
    # mặt in luôn thuộc vùng sản phẩm: lấp mọi lỗ do dò nền bỏ sót.
    # Mặt tròn thì bỏ qua, nếu không góc vuông của quad sẽ ăn ra ngoài đĩa.
    if not round_face:
        ImageDraw.Draw(mk).polygon([tuple(p) for p in quad], fill=255)
    mk = mk.filter(ImageFilter.GaussianBlur(1.2))
    img.save(os.path.join(out, 'base.jpg'), quality=88, optimize=True, progressive=True)
    mk.save(os.path.join(out, 'mask.png'), optimize=True)
    # light map: độ sáng thật của vùng sản phẩm, chuẩn hoá quanh 128
    g = np.array(img.convert('L')).astype(np.float32)
    mm = np.array(mk).astype(np.float32) / 255.0
    inside = g[mm > 0.5]
    mean = inside.mean() if inside.size else 128.0
    l = 128.0 * (g / max(mean, 1e-3)) ** light_gamma
    l = np.clip(l, *light_range)
    l = np.where(mm > 0.02, l, 128.0)
    Image.fromarray(l.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)) \
        .save(os.path.join(out, 'light.png'), optimize=True)
    REPORT[name] = {'size': size, 'quad': quad}
    return quad


def scale_quad(quad, src, dst):
    sx, sy = dst[0] / src[0], dst[1] / src[1]
    return [[int(round(x * sx)), int(round(y * sy))] for x, y in quad]


def do_rug(raw_name, out_name, size, sat_max=0.25, v_lo=0.33, v_hi=0.98):
    img = load(raw_name).convert('RGB')
    m = segment_flat(img, sat_max=sat_max, v_lo=v_lo, v_hi=v_hi)
    q = biggest_quad(m)
    q = scale_quad(q, img.size, size)
    return write_scene(out_name, img, m, q, os.path.join(MOCK, out_name), size, light_gamma=1.0)


def do_mug(raw_name, out_name, size):
    img = load(raw_name).convert('RGB')
    m = segment_flat(img, sat_max=0.16, v_lo=0.62, v_hi=1.01)
    cols = m.sum(0)
    hmax = cols.max()
    body = np.where(cols > hmax * 0.72)[0]           # thân cốc cao gần tối đa, quai thì không
    x0, x1 = int(body.min()), int(body.max())
    mb = np.zeros_like(m); mb[:, x0:x1 + 1] = m[:, x0:x1 + 1]
    ys = np.where(mb.any(1))[0]
    y0, y1 = int(ys.min()), int(ys.max())
    inset_x = (x1 - x0) * 0.055
    inset_y = (y1 - y0) * 0.14
    q = [[x0 + inset_x, y0 + inset_y], [x1 - inset_x, y0 + inset_y],
         [x1 - inset_x, y1 - inset_y], [x0 + inset_x, y1 - inset_y]]
    q = scale_quad(q, img.size, size)
    return write_scene(out_name, img, mb, q, os.path.join(MOCK, out_name), size, light_gamma=1.0)


def do_ornament(raw_name, out_name, size, sat_max=0.38, v_lo=0.55):
    """Mặt in tròn: mask là chính cái đĩa, 4 góc lấy theo khung bao của đĩa —
    hoạ tiết vuông đổ vào khung đó rồi bị mask cắt thành hình tròn."""
    img = load(raw_name).convert('RGB')
    m = segment_flat(img, sat_max=sat_max, v_lo=v_lo, v_hi=1.01)
    m = ndimage.binary_opening(m, np.ones((21, 21)))     # rụng mẩu ruy-băng/ánh sáng dính vào đĩa
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        m = lab == (np.argmax(sizes) + 1)
    m = ndimage.binary_fill_holes(m)
    # tâm = trọng tâm, bán kính suy từ diện tích -> không lệch vì vài mẩu thừa ở rìa
    ys, xs = np.where(m)
    cx, cy = float(xs.mean()), float(ys.mean())
    r = float(np.sqrt(m.sum() / np.pi)) * 0.985
    q = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]]
    q = scale_quad(q, img.size, size)
    return write_scene(out_name, img, m, q, os.path.join(MOCK, out_name), size, light_gamma=1.0, round_face=True)


def do_tee(raw_name, out_name, size):
    img = load(raw_name).convert('RGB')
    m = segment_flat(img, sat_max=0.17, v_lo=0.60, v_hi=1.01)
    ys, xs = np.where(m)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    w, h = x1 - x0, y1 - y0
    cx = (x0 + x1) / 2
    q = [[cx - w * 0.215, y0 + h * 0.30], [cx + w * 0.215, y0 + h * 0.30],
         [cx + w * 0.215, y0 + h * 0.70], [cx - w * 0.215, y0 + h * 0.70]]
    q = scale_quad(q, img.size, size)
    quad = write_scene(out_name, img, m, q, os.path.join(MOCK, out_name), size, light_gamma=1.0)
    # displace map = nếp vải (high-pass của độ sáng)
    base = Image.open(os.path.join(MOCK, out_name, 'base.jpg')).convert('L')
    g = np.array(base).astype(np.float32)
    lo = np.array(base.filter(ImageFilter.GaussianBlur(9))).astype(np.float32)
    d = np.clip(128 + (g - lo) * 1.6, 0, 255)
    Image.fromarray(d.astype(np.uint8)).save(os.path.join(MOCK, out_name, 'displace.png'), optimize=True)
    return quad


if __name__ == '__main__':
    os.makedirs(ART, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'parts'):
        split_stocking('stocking-classic', 'stocking2-body', 'stocking2-cuff')
        split_stocking('stocking-cable', 'stocking3-body', 'stocking3-cuff')
        save_part(drop_white(load('garland-swag')), 'garland', 1400)
        save_part(load('garland-wide'), 'garland-top', 1600)
        save_part(drop_white(shave(load('sprig-corner'), 4)), 'sprig', 760)
        save_part(shave(load('pet-dog'), 7), 'pet-dog2', 620)
        save_part(shave(load('pet-cat'), 7), 'pet-cat2', 620)

    if which in ('all', 'scenes'):
        do_rug('scene-rug-hallway', 'rug-hallway2', (1800, 1200))
        do_rug('scene-rug-flatlay', 'rug-flatlay2', (1800, 1200), sat_max=0.11)
        do_mug('scene-mug-desk', 'mug-desk2', (1600, 1280))
        do_tee('scene-tee-flatlay', 'tee-flatlay2', (1400, 1400))
    print(json.dumps(REPORT, indent=1))
