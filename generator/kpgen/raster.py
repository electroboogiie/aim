# Raster helpers of the KP_2_v3 engine: photo grading, page backgrounds, manufacturer drawings,
# cut-outs. Ported from the user's d5.py / kp_v3_set.py / decal.py; pixel loops are vectorised with
# numpy but give the same pixels.
import io, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageEnhance, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', 'assets'))
W, H = 8.27, 11.69          # A4 portrait, inches
DPI = 200
FONT_B = os.environ.get('KPGEN_FONT_BOLD', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')

INK = '0B0D10'
WHITE = 'F4F4F2'
OR = 'F2530A'
CARD = (23, 27, 33)         # #171B21, the template's tile fill


def asset(path):
    return os.path.join(ASSETS, path)


def asset_ok(path):
    """True for an existing image file inside assets/ (spec paths must not leave it)."""
    if not path or not isinstance(path, str) or os.path.isabs(path): return False
    full = os.path.realpath(asset(path))
    return full.startswith(os.path.realpath(ASSETS) + os.sep) and os.path.isfile(full)


def px(v): return int(round(v * DPI))
def hexrgb(h): return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def png(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True); return b.getvalue()


def jpg(im):
    b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=86); return b.getvalue()


# ---------------------------------------------------------------- photo grading (d5.py)
def cover(path, w, h, fx=0.5, fy=0.5):
    """Crop the photo to fill a w x h inch box (focus point fx, fy) at DPI."""
    im = Image.open(asset(path)).convert('RGB')
    tw, th = px(w), px(h)
    r = max(tw / im.width, th / im.height)
    cw, ch = round(tw / r), round(th / r)
    x = int((im.width - cw) * fx); y = int((im.height - ch) * fy)
    return im.crop((x, y, x + cw, y + ch)).resize((tw, th), Image.LANCZOS)


def grade(im, sat=0.55, bright=0.78, contrast=1.18, warm=0.10):
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    im = ImageEnhance.Brightness(im).enhance(bright)
    g = ImageOps.grayscale(im)   # split-tone: shadows toward ink-blue, highlights toward orange
    tone = ImageOps.colorize(g, black=(8, 12, 18), white=(255, 196, 150), mid=(120, 100, 90))
    return Image.blend(im, tone, warm + 0.15)


def scan(im, step=4, a=18):
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for y in range(0, im.height, step): d.line([(0, y), (im.width, y)], fill=(0, 0, 0, a))
    return Image.alpha_composite(im.convert('RGBA'), ov)


def fade(im, edges):
    """edges: dict side -> fraction; fades to transparent toward that side."""
    im = im.convert('RGBA'); w, h = im.size
    m = Image.new('L', im.size, 255); d = ImageDraw.Draw(m)
    for side, f in edges.items():
        n = int((w if side in 'lr' else h) * f)
        for i in range(n):
            a = int(255 * (i / n) ** 1.6)
            if side == 'b': d.line([(0, h - 1 - i), (w, h - 1 - i)], fill=a)
            if side == 't': d.line([(0, i), (w, i)], fill=a)
            if side == 'l': d.line([(i, 0), (i, h)], fill=a)
            if side == 'r': d.line([(w - 1 - i, 0), (w - 1 - i, h)], fill=a)
    im.putalpha(ImageChops.multiply(im.getchannel('A'), m)); return im


def glow(w, h, cx, cy, r, color=OR, a=150):
    im = Image.new('RGBA', (px(w), px(h)), hexrgb(color) + (0,))
    m = Image.new('L', im.size, 0); d = ImageDraw.Draw(m)
    R = px(r); d.ellipse([px(cx) - R, px(cy) - R, px(cx) + R, px(cy) + R], fill=a)
    m = m.filter(ImageFilter.GaussianBlur(R * 0.45)); im.putalpha(m); return im


def bg_page(layers=(), grid=True, gy0=0.0):
    """Full-page background: ink, HUD grid from gy0 down, then the layers. Returns JPEG bytes."""
    im = Image.new('RGBA', (px(W), px(H)), hexrgb(INK) + (255,))
    if grid:
        g = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(g)
        s = px(0.25)
        for x in range(0, im.width, s): d.line([(x, px(gy0)), (x, im.height)], fill=(255, 255, 255, 9))
        for y in range(px(gy0), im.height, s): d.line([(0, y), (im.width, y)], fill=(255, 255, 255, 9))
        for x in range(0, im.width, s * 4):
            for y in range(px(gy0), im.height, s * 4):
                d.line([(x - 6, y), (x + 6, y)], fill=(255, 255, 255, 40)); d.line([(x, y - 6), (x, y + 6)], fill=(255, 255, 255, 40))
        im = Image.alpha_composite(im, g)
    for lay, (x, y) in layers:
        lay = lay.convert('RGBA')
        tmp = Image.new('RGBA', im.size, (0, 0, 0, 0)); tmp.paste(lay, (px(x), px(y))); im = Image.alpha_composite(im, tmp)
    return jpg(im)


def outline_text(text, cap_in, stroke=3, color=WHITE, alpha=255):
    f = ImageFont.truetype(FONT_B, int(px(cap_in) / 0.72))
    l, t, r, b = f.getbbox(text, stroke_width=stroke)
    im = Image.new('RGBA', (r - l + 4, b - t + 4), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.text((-l + 2, -t + 2), text, font=f, fill=(0, 0, 0, 0), stroke_width=stroke, stroke_fill=hexrgb(color) + (alpha,))
    return im


# ---------------------------------------------------------------- page backgrounds (kp_v3_set.py)
def cover_bg(path, fx, fy):
    hero = grade(cover(path, W, 7.9, fx=fx, fy=fy), sat=0.7, bright=0.85, warm=0.05)
    hero = fade(scan(hero), {'b': 0.42, 't': 0.12})
    return bg_page([(hero, (0, 0)), (glow(W, H, 6.6, 7.4, 2.6, a=120), (0, 0))], gy0=7.2)


def side_bg(path, fx, fy=0.5):
    pw, ph_, py = 4.25, 5.6, 0.8
    ph = grade(cover(path, pw, ph_, fx=fx, fy=fy), sat=0.75, bright=0.9)
    ph = fade(scan(ph), {'l': 0.62}); ph = fade(ph, {'b': 0.10})
    return bg_page([(ph, (W - pw, py)), (glow(W, H, 7.5, 6.2, 1.8, a=80), (0, 0))])


def end_bg(path, fx, fy):
    hero = grade(cover(path, W, 6.4, fx=fx, fy=fy), sat=0.75, bright=0.9)
    hero = fade(scan(hero), {'b': 0.42, 't': 0.12})
    return bg_page([(hero, (0, 0.6)), (glow(W, H, 4.1, 5.6, 2.8, a=90), (0, 0))], gy0=6.5)


def graded_photo(path, w, h, fx=0.5, fy=0.5):
    return jpg(grade(cover(path, w, h, fx=fx, fy=fy), sat=0.8, bright=0.92, warm=0.0))


# ---------------------------------------------------------------- manufacturer drawings
def split(im, n):
    """Mask of the drawn body: opening of size n removes thin CAD lines and text."""
    a = im.getchannel('A').point(lambda v: 255 if v > 90 else 0)
    opened = a.filter(ImageFilter.MinFilter(n)).filter(ImageFilter.MaxFilter(n))
    return opened.filter(ImageFilter.MaxFilter(9))


def steel(im, keep):
    """Body pixels -> light steel, everything outside the body mask -> transparent."""
    a = np.array(im.convert('RGBA'))
    k = np.array(keep) > 0
    R, G, B, A = (a[..., i].astype(np.int32) for i in range(4))
    vis = A != 0
    mx = np.maximum(np.maximum(R, G), B); mn = np.minimum(np.minimum(R, G), B)
    tone = vis & k & (mx - mn < 18) & (mx < 120)
    v = (40 + (R + G + B).astype(np.float64) / 3 * 1.55).astype(np.int32)
    out = a.copy()
    out[tone, 0] = v[tone]; out[tone, 1] = v[tone] + 3; out[tone, 2] = v[tone] + 7
    out[vis & ~k] = 0
    return Image.fromarray(out, 'RGBA')


def chart_rgba(path, box):
    """Manufacturer drawing on white -> RGBA with the paper keyed out."""
    im = Image.open(asset(path)).convert('RGB').crop(box)
    a = im.convert('L').point(lambda v: max(0, min(255, (250 - v) * 4)))
    im = im.convert('RGBA'); im.putalpha(a); return im


def chart_crop(path, box, erase=()):
    im = chart_rgba(path, box)
    for e in erase: im.paste((0, 0, 0, 0), e)  # other views' dimension lines inside the crop
    return im


def drawing(im, labels, n=5, k=None):
    """Steel body + orange dimension lines, CAD text under the native labels cut out."""
    keep = split(im, n); body = steel(im, keep)
    dm = Image.composite(im.getchannel('A'), Image.new('L', im.size, 0), keep.point(lambda v: 0 if v else 255))
    dd = ImageDraw.Draw(dm)
    for cx, cy, t in labels:
        hw = len(t) * 15 + 8; hh = 24 if n == 5 else 32
        dd.rectangle([cx - hw, cy - hh, cx + hw, cy + hh], fill=0)
    dm = dm.filter(ImageFilter.MaxFilter(k or (5 if max(im.size) > 1000 else 3)))
    dl = Image.new('RGBA', im.size, (255, 138, 61, 0)); dl.putalpha(dm)
    return Image.alpha_composite(body, dl)


def side_glow(clean, padg=60):
    gl = Image.new('RGBA', (clean.width + 2 * padg, clean.height + 2 * padg), (242, 83, 10, 0))
    mm = Image.new('L', gl.size, 0); mm.paste(clean.getchannel('A'), (padg, padg))
    mm = mm.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(22)).point(lambda v: int(v * 0.45))
    gl.putalpha(mm); gl.alpha_composite(clean, (padg, padg))
    return gl


def line_art(path, rotate=0):
    """CAD line drawing (black lines + coloured dims on transparent) -> light steel lines, orange dims."""
    im = Image.open(asset(path)).convert('RGBA')
    if rotate: im = im.rotate(rotate, expand=True)
    a = np.array(im)
    R, G, B, A = (a[..., i].astype(np.int32) for i in range(4))
    vis = A != 0
    col = (np.maximum(np.maximum(R, G), B) - np.minimum(np.minimum(R, G), B)) > 60
    a[vis & col, :3] = (255, 138, 61)
    a[vis & ~col, :3] = (196, 202, 210)
    im = Image.fromarray(a, 'RGBA')
    big = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    big.putalpha(big.getchannel('A').filter(ImageFilter.MaxFilter(3)))
    return big


# ---------------------------------------------------------------- cut-outs and cards
def cutout_glow(im, a=70, pad=0.08):
    p = int(max(im.size) * pad); big = Image.new('RGBA', (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    sh = Image.new('RGBA', big.size, (242, 83, 10, 0))
    m = Image.new('L', big.size, 0); m.paste(im.getchannel('A'), (p, p))
    m = m.filter(ImageFilter.GaussianBlur(p * 0.35)).point(lambda v: int(v * a / 255))
    sh.putalpha(m); big = Image.alpha_composite(big, sh); big.alpha_composite(im, (p, p)); return big


def alpha_crop(im):
    im = im.convert('RGBA'); return im.crop(im.getchannel('A').getbbox())


def on_card(im, w, h, k=0.92):
    """Product cut-out (alpha) centred on the tile colour."""
    im = alpha_crop(im); tw, th = px(w), px(h)
    r = min(tw * k / im.width, th * k / im.height); im = im.resize((int(im.width * r), int(im.height * r)), Image.LANCZOS)
    out = Image.new('RGBA', (tw, th), CARD + (255,)); out.alpha_composite(im, ((tw - im.width) // 2, (th - im.height) // 2))
    return out.convert('RGB')


KEY_T = 28  # floodfill tolerance (sum over RGB) for the white studio paper


def card_photo(path, w, h, fx=0.5, fy=0.5, key_t=KEY_T):
    """Accessory photo for a w x h card: cut-outs and studio shots go on the tile colour, others are cropped."""
    im = Image.open(asset(path))
    if im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getchannel('A').getextrema()[0] < 250:
        return on_card(im.convert('RGBA'), w, h)
    rgb = im.convert('RGB'); p = rgb.load()
    if min(p[2, 2]) > 235 and min(p[rgb.width - 3, 2]) > 235:  # studio shot on white: key the paper out
        key = rgb.copy()
        for xy in ((0, 0), (rgb.width - 1, 0), (0, rgb.height - 1), (rgb.width - 1, rgb.height - 1)):
            ImageDraw.floodfill(key, xy, (255, 0, 255), thresh=key_t)
        km = np.array(key)
        paper = (km[..., 0] == 255) & (km[..., 1] == 0) & (km[..., 2] == 255)
        mask = Image.fromarray(np.where(paper, 0, 255).astype(np.uint8), 'L')
        cut = rgb.convert('RGBA'); cut.putalpha(mask.filter(ImageFilter.GaussianBlur(1.2)))
        return on_card(cut, w, h, 0.9)
    return grade(cover(path, w, h, fx=fx, fy=fy), sat=0.85, bright=0.92, warm=0.0)


# ---------------------------------------------------------------- model number decal (decal.py)
def redecal(im, box, text, theta=-16, beam=-20.5, shift=95, center=(60, 44), cap=30, width=62, color=(205, 205, 207)):
    """Swap the model number painted on the boom: cover it with a clean piece of the same beam taken
    further along the beam axis, then paint the new number at the same angle."""
    im = im.convert('RGBA'); out = im.copy()
    x0, y0, x1, y1 = box
    dx, dy = shift * math.cos(math.radians(beam)), shift * math.sin(math.radians(beam))
    patch = im.crop((int(x0 + dx), int(y0 + dy), int(x1 + dx), int(y1 + dy)))
    m = Image.new('L', patch.size, 0); d = ImageDraw.Draw(m)
    cx, cy = center
    hw, hh = width / 2 + 6, cap / 2 + 5
    c, s = math.cos(math.radians(theta)), math.sin(math.radians(theta))
    pts = [(cx + u * c - v * s, cy + u * s + v * c) for u, v in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
    d.polygon(pts, fill=255); m = m.filter(ImageFilter.GaussianBlur(3))
    out.paste(patch, (x0, y0), m)
    f = ImageFont.truetype(FONT_B, 100); l, t, r, b = f.getbbox(text)
    k = min(cap / (b - t), width / (r - l)); f = ImageFont.truetype(FONT_B, max(8, int(100 * k)))
    l, t, r, b = f.getbbox(text)
    layer = Image.new('RGBA', (r - l + 20, b - t + 20), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((10 - l, 10 - t), text, font=f, fill=color + (255,))
    layer = layer.rotate(-theta, resample=Image.BICUBIC, expand=True)
    out.alpha_composite(layer, (int(x0 + cx - layer.width / 2), int(y0 + cy - layer.height / 2)))
    return out
