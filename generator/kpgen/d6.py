# «Heavy Label» style (the user's KP_NPL10720_D6_heavy_label.pptx): the design file is the template, texts and numbers
# of the kit are written into it by shape id. Two layouts from the one design:
#   npl_label   — НПЛ-10 + crane, the user's 10 pages as they are;
#   crane_label — crane in a kit (templates/KP_crane_label.pptx, made by tools/make_crane_label.py): 8 pages, the НПЛ-10
#                 pages dropped, page 02 tells the kit, the headlines, cut-outs and photos follow the crane model.
# Headlines in the design are pictures (Inter Display Black); the ones with the model's numbers are re-rendered.
import io, os, re
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation

from . import raster as R
from .cache import Cache
from .pptx_util import EMU, I, by_id, by_name, put, set_lines, set_image, remove, prune_images, fit, clone
from .profiles import PROFILES, DECAL_CONFIG, chart_for
from .styles import STYLES, pages, template_path
from .spec import SpecError

INK, OR, WHITE = (13, 14, 16), (242, 83, 10), (255, 255, 255)
OUTLINE = (43, 46, 52)
FONT_BLACK = next((f for f in (os.path.join(R.ASSETS, 'fonts', 'InterDisplay-Black.otf'),
                               '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf') if os.path.isfile(f)), R.FONT_B)
TEMPLATES = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'templates'))
CRANE_CUT = os.path.join(TEMPLATES, 'KP_2_v3.pptx')   # crane cut-out of its configuration page (slide 5, id 14)
SLIDE_W = I(8.26)

# crane_label photos per crane profile (path, focus x, focus y); None = the template's own photo (BMF 720).
# Page 02 (kit) and 03 (crane) heroes; the price page shows the kit's mounting base, the terms page another kit part.
KIT_PHOTO = {'bmf720': ('bmf/720_workshop.jpg', 0.5, 0.62)}
CRANE_PHOTO = {'bmf720': None}
CHIPS = (46, 48, 50, 52)   # page 02: crane chips (text ids; the box is id - 1), the kit's crane is the orange one
PART_PHOTOS = {'base_outriggers': 'prod/base_outriggers.jpg', 'tank': 'prod/tank.jpg'}


def _font(pt, dpi=300): return ImageFont.truetype(FONT_BLACK, int(pt / 72 * dpi))


def display(text, pt=46, color=INK, dpi=300):
    f = _font(pt, dpi); tr = -0.02 * f.size
    w = int(sum(f.getlength(c) for c in text) + tr * len(text) + f.size * 0.2); h = int(f.size * 1.3)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im); x = 0
    for c in text:
        d.text((x, 0), c, font=f, fill=color + (255,)); x += f.getlength(c) + tr
    return im.crop(im.getbbox())


def headline(lines, pt=60, pitch=1.23, outline=0):
    """Headline picture like the design's: lines of (text, colour) segments, Inter Display Black, tight tracking,
    line pitch = 1.23 cap heights; outline > 0 draws only the letters' contour (stroke in px)."""
    f = _font(pt); tr = -0.02 * f.size
    cap = f.getbbox('H')[3] - f.getbbox('H')[1]
    width = int(max(sum(f.getlength(c) + tr for t, _ in ln for c in t) for ln in lines) + f.size)
    im = Image.new('RGBA', (width, int(cap * pitch * (len(lines) - 1) + f.size * 2)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(lines):
        x, y = f.size * 0.1 + outline, f.size * 1.2 + i * cap * pitch
        for text, col in ln:
            for c in text:
                if outline:
                    d.text((x, y), c, font=f, anchor='ls', fill=(0, 0, 0, 0), stroke_width=outline, stroke_fill=col + (255,))
                else:
                    d.text((x, y), c, font=f, anchor='ls', fill=col + (255,))
                x += f.getlength(c) + tr
    l, t, r, b = im.getbbox()
    return im.crop((max(0, l - 2), max(0, t - 2), r + 2, b + 2))


def png(im):
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()


def _headline_png(lines, outline=0): return png(headline([[tuple(s) for s in ln] for ln in lines], outline=outline))


def hero_photo(path, w, h, fx=0.5, fy=0.5):
    """Top-of-page photo as the design treats it: muted, darker, fading into the page colour at the bottom."""
    im = R.grade(R.cover(path, w, h, fx, fy), sat=0.55, bright=0.72, contrast=1.1, warm=0.0).convert('RGB')
    ov = Image.new('RGBA', im.size, INK + (0,))
    a = Image.new('L', (1, im.height))
    for y in range(im.height):
        t = max(0.0, (y / im.height - 0.5) / 0.5); a.putpixel((0, y), int(255 * t * t * (3 - 2 * t)))
    ov.putalpha(a.resize(im.size))
    return R.jpg(Image.alpha_composite(im.convert('RGBA'), ov))


def crane_cutout(blob, model_no):
    """The crane cut-out of KP_2_v3 without its orange glow, cropped, with the model number on the boom."""
    im = Image.open(io.BytesIO(blob)).convert('RGBA')
    if model_no != '720': im = R.redecal(im, DECAL_CONFIG, model_no)
    a = im.getchannel('A').point(lambda v: 0 if v < 90 else v)
    im.putalpha(a)
    return png(im.crop(im.getbbox()))


def white_lines(chart, box, erase=()):
    """The manufacturer's side-view drawing as the design draws it: thin light lines on the dark page."""
    im = R.chart_crop(chart, box, erase)
    a = im.getchannel('A'); im = Image.new('RGBA', im.size, (232, 233, 235, 0)); im.putalpha(a)
    return png(im.crop(a.getbbox()))


def photo_part(path, w, h, fx=0.5, fy=0.5):
    return R.jpg(R.grade(R.cover(path, w, h, fx, fy), sat=0.8, bright=0.95, contrast=1.05, warm=0.0))


def set_headline(cache, pic, lines, ref, maxw=None, outline=0):
    """Re-render a headline picture: the template's text (ref) gives the scale, so the new one keeps the font size."""
    if lines == ref: return
    data = cache.get('d6-hl', _headline_png, (lines, outline))
    refd = cache.get('d6-hl', _headline_png, (ref, outline))
    im, rim = Image.open(io.BytesIO(data)), Image.open(io.BytesIO(refd))
    k = pic.height / rim.height
    w, h = int(im.width * k), int(im.height * k)
    maxw = maxw or (SLIDE_W - I(0.48) - pic.left)
    if w > maxw: w, h = maxw, int(h * maxw / w)
    set_image(pic, data); pic.width, pic.height = w, h


def set_cutout(cache, pic, model_no, box):
    """Crane cut-out fitted into box (x, y, w, h in inches), bottom-centred."""
    blob = by_id(list(Presentation(CRANE_CUT).slides)[4], 14).image.blob
    data = cache.get('d6-crane', crane_cutout, (blob, model_no))
    im = Image.open(io.BytesIO(data)); x, y, w, h = box
    ar = im.height / im.width; nw, nh = (w, w * ar) if w * ar <= h else (h / ar, h)
    set_image(pic, data)
    pic.left, pic.top, pic.width, pic.height = I(x + (w - nw) / 2), I(y + h - nh), I(nw), I(nh)


class D6:
    def __init__(self, spec, build_dir):
        self.style = spec.get('style') or 'npl_label'
        if STYLES[self.style].get('engine') != 'd6': self.style = 'npl_label'
        kits = STYLES[self.style].get('kits') or ()
        if spec['kit_type'] not in kits:
            what = 'НПЛ-10 + кран' if 'npl_crane' in kits else 'кран у комплекті'
            raise SpecError(f"Стиль «{STYLES[self.style]['title']}» є лише для комплектів «{what}». Оберіть інший стиль.")
        self.kit = self.style == 'crane_label'
        self.spec = spec; self.c = spec['crane']; self.cs = self.c['specs']
        self.prof = PROFILES[self.c['profile']]; self.no = str(self.prof.get('model_no') or '')
        self.cache = Cache(build_dir)
        R.set_theme('dark')

    # ---------------------------------------------------------------- helpers
    def headline(self, pic, lines, ref, maxw=None, outline=0): set_headline(self.cache, pic, lines, ref, maxw, outline)
    def cutout(self, pic, box): set_cutout(self.cache, pic, self.no, box)

    def photo(self, pic, d, fn=hero_photo):
        if not d or not R.asset_ok(d[0]): return
        w, h = pic.width / EMU, pic.height / EMU
        set_image(pic, self.cache.get('d6-photo-' + fn.__name__, fn, (d[0], w, h, d[1], d[2]), (d[0],)))

    # ---------------------------------------------------------------- build
    def build(self):
        sp, cs, m = self.spec, self.cs, self.c['model']
        prs = Presentation(template_path(self.style)); S = list(prs.slides)
        P = self.pages = dict(zip([k for k, _, _ in pages(self.style)], S))
        g = lambda k, d='—': cs.get(k) or d
        old = 'BMF 720'
        # every page: header "НПЛ-10 × BMF 720" and other mentions of the template's crane
        for s in S:
            for sh in s.shapes:
                if s is S[1] and sh.shape_id in CHIPS: continue   # the crane chips of page 02 name all models
                if sh.has_text_frame and old in sh.text_frame.text and m != old:
                    for p in sh.text_frame.paragraphs:
                        for r in p.runs:
                            if old in r.text: r.text = r.text.replace(old, m)
        npl = sp.get('npl') or {}
        # 01 cover
        s = P['cover']
        put(by_id(s, 6), f"КОМЕРЦІЙНА ПРОПОЗИЦІЯ № {sp['number']}")
        client = sp['client']['name']
        put(by_id(s, 7), f"{sp['date']}  ·  ДЛЯ: {client.upper()}" if client else f"ВЕРСІЯ {sp['date']}  ·  САРНИ, UA")
        put(by_id(s, 20), [cs['reach_m'], None])
        if self.kit: self.cover_kit(s)
        else: put(by_id(s, 26), [npl.get('stakes') or '4', None])
        self.contacts(s, (31, 33, 35, 37))
        put(by_id(s, 47), sp['maker']['line'].upper())
        if not self.kit:   # 04 НПЛ-10 specs
            s = P['npl_spec']
            put(by_id(s, 32), f"{npl.get('stakes') or '4'} шт"); put(by_id(s, 50), f"{npl.get('wheels') or '500/45-22,5'} · 4 шт")
            put(by_name(s, 'fld_npl_11')[0], npl.get('brakes') or 'гідравлічна')
            lab = [sh for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('Колесо ходове з диском')]
            if lab: put(lab[0], f"Колесо ходове з диском {npl.get('wheels') or '500/45-22,5'}")
        else:
            self.kit_page(P['kit'])
        self.chips(S[1])
        # crane
        s = P['crane']
        native = self.prof.get('native')   # the template's own crane (BMF 720): its texts and drawing stay
        lead = self.c.get('lead') or (None if native else self.prof.get('lead'))
        lead2 = self.c.get('lead2') or (None if native else self.prof.get('lead2'))
        if lead: put(by_id(s, 28), lead)
        if lead2: put(by_id(s, 29), lead2)
        if not native and self.prof.get('draw'):
            D = self.prof['draw']; ch = chart_for(self.c['profile'], self.c)
            pic = by_name(s, 'dwg_crane')[0]
            data = self.cache.get('d6-dwg', white_lines, (ch, D['side'], tuple(D.get('side_erase', ()))), (ch,))
            box = (pic.left, pic.top, pic.width, pic.height)
            set_image(pic, data); fit(pic, Image.open(io.BytesIO(data)), box)
        put(by_id(s, 49), cs['reach_m']); put(by_id(s, 51), f"{cs['turn_deg']}°")
        self.headline(by_name(s, 'hdr_p5_hdr')[0], [[('СИЛА BMF.', WHITE)], [(f"ВИЛІТ {cs['reach_m']} м.", OR)]],
                      [[('СИЛА BMF.', WHITE)], [('ВИЛІТ 7,2 м.', OR)]])
        if self.kit:
            d = CRANE_PHOTO.get(self.c['profile'], self.prof['end'].get('crane_kit'))
            self.photo(by_id(s, 3), d)
        # crane specs
        s = P['crane_spec']
        self.headline(by_name(s, 'hdr_p6_hdr')[0], [[('ПІДЙОМНИЙ МОМЕНТ', INK)], [(f"{cs['torque_knm']} кНм.", OR)]],
                      [[('ПІДЙОМНИЙ МОМЕНТ', INK)], [('60 кНм.', OR)]])
        put(by_id(s, 27), [cs['reach_m'], None]); put(by_id(s, 30), [cs['torque_knm'], None])
        put(by_id(s, 33), [cs['turn_deg'], None]); put(by_id(s, 36), [g('pressure_bar'), None])
        put(by_id(s, 58), cs['lift_4m_kg']); put(by_id(s, 61), cs['lift_full_kg'])
        self.load_chart(s)
        put(by_id(s, 66), f"РОТАТОР {cs['rotator_t']} т   +   ГРЕЙФЕР {cs['grapple_m2']} м²")
        flow = g('valve_flow_l'); flow = flow if flow.endswith('л') or flow == '—' else flow + 'l'
        vals = [cs['reach_m'], cs['torque_knm'], cs['lift_4m_kg'], cs['lift_full_kg'], cs['grapple_m2'], cs['rotator_t'] + 'т',
                f"{g('valve')} ({flow})", g('slew_knm'), g('slew_cyl'), cs['turn_deg'], g('pressure_bar'), g('pump_lpm'),
                '+' if g('wide_angle', '+') in ('так', '+') else '—', '+' if g('telescope', '+') in ('так', '+') else '—', g('weight_kg')]
        for i, v in enumerate(vals):
            f = by_name(s, f'fld_bmf_{i}')
            if f: put(f[0], v)
        # price
        self.price(P['price'])
        # terms
        s = P['terms']
        for (tid, xid), t in zip(((29, 30), (33, 34), (37, 38), (41, 42), (45, 46)), sp['terms']):
            put(by_id(s, tid), t['title'].upper()); put(by_id(s, xid), t['text'])
        if self.kit: self.terms_kit(s)
        # contacts
        s = P['end']
        self.contacts(s, (34, 37, 40, 43))
        put(by_id(s, 57), sp['maker']['line'].upper())
        if self.kit:
            self.headline(by_name(s, 'hdr_p10_hdr')[0], [[('ЗАМОВТЕ', INK)], [(f'СВІЙ {m}.', WHITE)]],
                          [[('ЗАМОВТЕ', INK)], [('СВІЙ BMF 720.', WHITE)]])
            self.cutout(by_name(s, 'cta_cutout')[0], (4.0, 5.3, 3.86, 3.4))
        self.overrides()
        prune_images(prs)
        return prs

    def load_chart(self, s):
        """Load-by-reach chart of the specs page: metre axis, bars at 4 m and at full reach, kg labels and dashed lines.
        The template is drawn for the BMF 720 (axis 0-7 m = 0.9..7.233 in, 1100 kg = 1.25 in)."""
        cs = self.cs
        try:
            reach = float(cs['reach_m'].replace(',', '.')); l4, lf = int(cs['lift_4m_kg']), int(cs['lift_full_kg'])
        except ValueError: return
        if (cs['reach_m'], l4, lf) == ('7,2', 1100, 580): return
        x0, y0 = 0.9, 5.17
        kx = 6.514 / max(7.2, reach)              # inches per metre: full reach at the right end of the axis line
        ky = min(1.25 / 1100, 1.25 / max(l4, lf))  # inches per kg, the tallest bar stays under the chart title
        ticks = [(by_id(s, i), by_id(s, i + 1)) for i in range(41, 57, 2)]
        for m in range(len(ticks), int(reach) + 1):   # longer cranes: more metre ticks, cloned from the last
            ticks.append((clone(s, ticks[-1][0]), clone(s, ticks[-1][1])))
        for m, (tk, lab) in enumerate(ticks):
            if m > reach: remove(tk); remove(lab); continue
            tk.left = I(x0 + m * kx); lab.left = I(x0 + m * kx - 0.2); put(lab, f'{m} м')
        for bar, lab, dash, m, kg in ((by_id(s, 57), by_id(s, 58), by_id(s, 59), 4, l4), (by_id(s, 60), by_id(s, 61), by_id(s, 62), reach, lf)):
            h = kg * ky; cx = x0 + m * kx
            bar.left, bar.top, bar.height = I(cx - 0.28), I(y0 - h), I(h)
            lab.left, lab.top = I(cx - 0.8), I(y0 - h - 0.36)
            dash.top = I(y0 - h); dash.width = I(cx - 0.28 - x0)

    # ---------------------------------------------------------------- crane in a kit
    def cover_kit(self, s):
        cs, m = self.cs, self.c['model']
        self.headline(by_name(s, 'hdr_cover_title')[0], [[('BMF ', INK), (self.no or m, OR)]], [[('BMF ', INK), ('720', OR)]],
                      maxw=I(7.34))
        self.headline(by_name(s, 'hdr_cover_10t')[0], [[(self.no, OUTLINE)]], [[('720', OUTLINE)]], outline=4)
        self.headline(by_name(s, 'hdr_cover_slogan')[0], [[(f"{cs['reach_m']} м ВИЛЬОТУ.", WHITE)], [('ЖОДНИХ КОМПРОМІСІВ.', OR)]],
                      [[('7,2 м ВИЛЬОТУ.', WHITE)], [('ЖОДНИХ КОМПРОМІСІВ.', OR)]])
        put(by_id(s, 14), f"З РОТАТОРОМ {cs['rotator_t']} т І ГРЕЙФЕРОМ {cs['grapple_m2']} м²")
        put(by_id(s, 17), [cs['torque_knm'], None]); put(by_id(s, 23), [cs['lift_4m_kg'], None])
        put(by_id(s, 26), [cs['turn_deg'], None])
        self.cutout(by_name(s, 'hero_cutout')[0], (-0.1, 4.75, 5.75, 4.3))

    def kit_page(self, s):
        sp, cs, m = self.spec, self.cs, self.c['model']
        d = KIT_PHOTO.get(self.c['profile'], self.prof['cover'].get('crane_kit'))
        self.photo(by_id(s, 3), d)
        rows = sp['rows']
        put(by_id(s, 28), [str(len(rows)), None]); put(by_id(s, 31), [cs['rotator_t'], None])
        put(by_id(s, 34), [cs['grapple_m2'], None]); put(by_id(s, 37), [cs.get('weight_kg') or '—', None])
        parts = [r['title'] for r in rows]
        parts = parts[:1] + [p[:1].lower() + p[1:] for p in parts[1:]]
        put(by_id(s, 40), f"{sp['title']} у комплекті: {', '.join(parts)}. Ротатор {cs['rotator_t']} т і грейфер "
                          f"{cs['grapple_m2']} м² уже входять у ціну крана.")
        set_lines(by_id(s, 42), [f"{i:02d}  {r['title']}" + (f" — {r['desc']}" if r['desc'] else '') for i, r in enumerate(rows[:7], 1)])
        accs = sp.get('accessories') or []
        if accs:
            set_lines(by_id(s, 44), [f"{a['title']} — {a['price_text']}" for a in accs[:6]])

    def chips(self, s):
        chips = {by_id(s, t).text_frame.text: (by_id(s, t - 1), by_id(s, t)) for t in CHIPS}
        on = next((v for v in chips.values() if 'F2530A' in v[0]._element.spPr.xml), None)
        new = chips.get(self.c['model'])
        if on and new and new is not on: self.swap_chip(on, new)

    @staticmethod
    def swap_chip(a, b):
        (ra, ta), (rb, tb) = a, b
        pa, pb = ra._element.spPr, rb._element.spPr
        ka = [c for c in pa if not c.tag.endswith('}xfrm') and not c.tag.endswith('}prstGeom')]
        kb = [c for c in pb if not c.tag.endswith('}xfrm') and not c.tag.endswith('}prstGeom')]
        for c in ka: pa.remove(c)
        for c in kb: pb.remove(c)
        for c in kb: pa.append(c)
        for c in ka: pb.append(c)
        ca = ta.text_frame.paragraphs[0].runs[0].font.color.rgb; cb = tb.text_frame.paragraphs[0].runs[0].font.color.rgb
        ta.text_frame.paragraphs[0].runs[0].font.color.rgb = cb; tb.text_frame.paragraphs[0].runs[0].font.color.rgb = ca

    def part_rows(self):
        """Kit parts with a photo for the price and terms pages (cut-out tiles swapped for their photos)."""
        out = []
        for r in self.spec['rows']:
            if r.get('kind') == 'crane': continue
            p = next((v for k, v in PART_PHOTOS.items() if (r.get('item_id') or '').startswith(k)), None) or r.get('photo')
            if p and R.asset_ok(p) and not p.lower().endswith('.png'): out.append(dict(r, photo=p))
        return out

    def terms_kit(self, s):
        parts = self.part_rows()
        r = parts[1] if len(parts) > 1 else None
        if r:
            self.photo(by_id(s, 50), (r['photo'], 0.5, 0.5), photo_part); put(by_id(s, 59), r['title'].upper())
        else:
            d = self.prof['end'].get('crane_kit') or ('bmf/720_b.jpg', 0.5, 0.5)
            self.photo(by_id(s, 50), d, photo_part); put(by_id(s, 59), f"КРАН-МАНІПУЛЯТОР · {self.c['model']}")

    # ---------------------------------------------------------------- shared pages
    def contacts(self, s, ids):
        ct = self.spec['contacts']
        ph, site, mail, addr = (by_id(s, i) for i in ids)
        if ct['phones']: set_lines(ph, ct['phones'][:2])
        if ct['sites']: set_lines(site, ct['sites'][:2])
        if ct['email']: set_lines(mail, [ct['email']])
        if ct['address']: set_lines(addr, ct['address'].split('\n'))

    def price(self, s):
        sp = self.spec; rows = sp['rows']
        slots = [(31, 32, 33, 34), (35, 36, 37, 38), (39, 40, 41, 42), (43, 44, 45, 46)]
        shown = rows[:4]
        if len(rows) > 4:   # the receipt has four lines: the rest go into the last one
            rest = rows[3:]
            shown = rows[:3] + [dict(no=4, title='Також: ' + ', '.join(r['title'] for r in rest), desc='', price_text='')]
        for k, (no, title, desc, price) in enumerate(slots):
            if k >= len(shown):
                for i in (no, title, desc, price): remove(by_id(s, i))
                continue
            r = shown[k]
            put(by_id(s, no), f'{k + 1:02d}'); put(by_id(s, title), r['title']); put(by_id(s, desc), r['desc'] or ' ')
            pt = r['price_text'] or ''
            put(by_id(s, price), '✓ В КОМПЛЕКТІ' if not pt or 'комплект' in pt.lower() else pt)
        put(by_id(s, 29), f"КП № {sp['number']} · {sp['date']}")
        total = re.sub(r'\s*₴\s*$', '', sp['total_text']).strip()
        cur = by_id(s, 50)
        if not re.search(r'\d', total):   # "ціна за запитом"
            cur.text_frame.paragraphs[0].runs[0].text = ''
        pic = by_name(s, 'fld_price')[0]
        im = self.cache.get('d6-price', lambda t: png(display(t)), (total,))
        img = Image.open(io.BytesIO(im)); h = pic.height; w = int(h * img.width / img.height)
        set_image(pic, im); pic.width = w
        cur.left = pic.left + w + int(0.1 * 914400)
        note = [f"Ціна вказана із урахуванням ПДВ. Станом на {sp.get('price_date') or sp['date']}."]
        if sp.get('valid_until'): note.append(f"Пропозиція дійсна до {sp['valid_until']}.")
        if sp.get('price_note'): note.append(sp['price_note'])
        set_lines(by_name(s, 'fld_price_note')[0], [' '.join(note)])
        put(by_id(s, 53), (f"{sp['title']} у комплекті" if self.kit else sp['title']).upper())
        if self.kit:
            parts = self.part_rows()
            d = (parts[0]['photo'], 0.5, 0.55) if parts else self.prof['cover'].get('crane_kit') or ('bmf/720_b.jpg', 0.5, 0.5)
            self.photo(by_id(s, 3), d)

    def overrides(self):
        ov = self.spec.get('overrides') or {}
        for key, o in (ov.get('bg') or {}).items():
            s = self.pages.get(key); path = (o or {}).get('path')
            if s is None or not path or not R.asset_ok(path): continue
            bgs = by_name(s, 'bg_grid')
            if not bgs: continue
            dark = sum(Image.open(io.BytesIO(bgs[0].image.blob)).convert('L').resize((8, 8)).getdata()) / 64 < 128
            R.set_theme('dark' if dark else 'light')
            data = self.cache.get(f"d6-underlay-{'dark' if dark else 'light'}", R.underlay_on,
                                  (bgs[0].image.blob, path, float(o.get('opacity', 0.18)), float(o.get('fx', 0.5)), float(o.get('fy', 0.5))), (path,))
            set_image(bgs[0], data)
        R.set_theme('dark')
        for key, texts in (ov.get('texts') or {}).items():
            s = self.pages.get(key)
            if s is None: continue
            for sid, text in (texts or {}).items():
                try: sh = by_id(s, int(sid))
                except (KeyError, ValueError): continue
                if sh.has_text_frame and text is not None: set_lines(sh, str(text).split('\n'))
