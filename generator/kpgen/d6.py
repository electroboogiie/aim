# «НПЛ-10 Heavy Label» style (the user's KP_NPL10720_D6_heavy_label.pptx, 10 pages): the design file is the template,
# texts and numbers of the kit are written into it by shape id. Only НПЛ-10 + crane kits.
import io, os, re
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation

from . import raster as R
from .cache import Cache
from .pptx_util import by_id, by_name, put, set_lines, set_image, remove, prune_images
from .styles import template_path
from .spec import SpecError

INK, OR = (13, 14, 16), (242, 83, 10)
FONT_BLACK = next((f for f in (os.path.join(R.ASSETS, 'fonts', 'InterDisplay-Black.otf'),
                               '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf') if os.path.isfile(f)), R.FONT_B)
PAGES = ['cover', 'npl_info', 'npl_dims', 'npl_spec', 'crane', 'crane_spec', 'price', 'terms', 'advantages', 'end']


def display(text, pt=46, color=INK, dpi=300):
    f = ImageFont.truetype(FONT_BLACK, int(pt / 72 * dpi)); tr = -0.02 * f.size
    w = int(sum(f.getlength(c) for c in text) + tr * len(text) + f.size * 0.2); h = int(f.size * 1.3)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im); x = 0
    for c in text:
        d.text((x, 0), c, font=f, fill=color + (255,)); x += f.getlength(c) + tr
    return im.crop(im.getbbox())


def png(im):
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()


class D6:
    def __init__(self, spec, build_dir):
        if spec['kit_type'] != 'npl_crane':
            raise SpecError('Стиль «НПЛ-10 Heavy Label» є лише для комплектів НПЛ-10 + кран. Оберіть інший стиль.')
        self.spec = spec; self.c = spec['crane']; self.cs = self.c['specs']
        self.cache = Cache(build_dir)
        R.set_theme('dark')

    def build(self):
        sp, cs, m = self.spec, self.cs, self.c['model']
        prs = Presentation(template_path('npl_label')); S = list(prs.slides); self.pages = dict(zip(PAGES, S))
        g = lambda k, d='—': cs.get(k) or d
        old = 'BMF 720'
        # every page: header "НПЛ-10 × BMF 720" and other mentions of the template's crane
        for s in S:
            for sh in s.shapes:
                if sh.has_text_frame and old in sh.text_frame.text and m != old:
                    for p in sh.text_frame.paragraphs:
                        for r in p.runs:
                            if old in r.text: r.text = r.text.replace(old, m)
        ct = sp['contacts']; npl = sp.get('npl') or {}
        # 01 cover
        s = S[0]
        put(by_id(s, 6), f"КОМЕРЦІЙНА ПРОПОЗИЦІЯ № {sp['number']}")
        client = sp['client']['name']
        put(by_id(s, 7), f"{sp['date']}  ·  ДЛЯ: {client.upper()}" if client else f"ВЕРСІЯ {sp['date']}  ·  САРНИ, UA")
        put(by_id(s, 20), [cs['reach_m'], None]); put(by_id(s, 26), [npl.get('stakes') or '4', None])
        self.contacts(s, (31, 33, 35, 37))
        put(by_id(s, 47), sp['maker']['line'].upper())
        # 04 НПЛ-10 specs
        s = S[3]
        put(by_id(s, 32), f"{npl.get('stakes') or '4'} шт"); put(by_id(s, 50), f"{npl.get('wheels') or '500/45-22,5'} · 4 шт")
        put(by_name(s, 'fld_npl_11')[0], npl.get('brakes') or 'гідравлічна')
        lab = [sh for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('Колесо ходове з диском')]
        if lab: put(lab[0], f"Колесо ходове з диском {npl.get('wheels') or '500/45-22,5'}")
        # 05 crane
        s = S[4]
        if self.c.get('lead'): put(by_id(s, 28), self.c['lead'])
        if self.c.get('lead2'): put(by_id(s, 29), self.c['lead2'])
        put(by_id(s, 49), cs['reach_m']); put(by_id(s, 51), f"{cs['turn_deg']}°")
        # 06 crane specs
        s = S[5]
        put(by_id(s, 27), [cs['reach_m'], None]); put(by_id(s, 30), [cs['torque_knm'], None])
        put(by_id(s, 33), [cs['turn_deg'], None]); put(by_id(s, 36), [g('pressure_bar'), None])
        put(by_id(s, 58), cs['lift_4m_kg']); put(by_id(s, 61), cs['lift_full_kg'])
        put(by_id(s, 66), f"РОТАТОР {cs['rotator_t']} т   +   ГРЕЙФЕР {cs['grapple_m2']} м²")
        flow = g('valve_flow_l'); flow = flow if flow.endswith('л') or flow == '—' else flow + 'l'
        vals = [cs['reach_m'], cs['torque_knm'], cs['lift_4m_kg'], cs['lift_full_kg'], cs['grapple_m2'], cs['rotator_t'] + 'т',
                f"{g('valve')} ({flow})", g('slew_knm'), g('slew_cyl'), cs['turn_deg'], g('pressure_bar'), g('pump_lpm'),
                '+' if g('wide_angle', '+') in ('так', '+') else '—', '+' if g('telescope', '+') in ('так', '+') else '—', g('weight_kg')]
        for i, v in enumerate(vals):
            f = by_name(s, f'fld_bmf_{i}')
            if f: put(f[0], v)
        # 07 price
        self.price(S[6])
        # 08 terms
        s = S[7]
        for (tid, xid), t in zip(((29, 30), (33, 34), (37, 38), (41, 42), (45, 46)), sp['terms']):
            put(by_id(s, tid), t['title'].upper()); put(by_id(s, xid), t['text'])
        # 10 contacts
        s = S[9]
        self.contacts(s, (34, 37, 40, 43))
        put(by_id(s, 57), sp['maker']['line'].upper())
        self.overrides()
        prune_images(prs)
        return prs

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
        put(by_id(s, 53), sp['title'].upper())

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
