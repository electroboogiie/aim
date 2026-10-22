# KP_2_v3 engine: the user's approved KP (templates/KP_2_v3.pptx, BMF 720 kit, 8 pages) is the
# template. Layout, fonts, colours and HUD labels stay; content comes from a KpSpec.
# НПЛ-10 kits get two trailer pages (duplicated from the crane pages) and the own-production page; BMF trailer kits
# get the two trailer pages too (bmf.ee drawings and photos) and keep the BMF maker page;
# accessories add an options page after the configuration page.
import copy, io, os, re
from PIL import Image
from pptx import Presentation
from pptx.enum.text import PP_ALIGN
from pptx.util import Pt

from . import raster as R
from .cache import Cache
from .profiles import (PROFILES, TEMPLATE_720, PHOTO_FOCUS, CARD_TWEAKS, TEMPLATE_TILES, NPL10, OWN_PRODUCTION, TRAILERS, TRUCK,
                       DECAL_ANATOMY, DECAL_CONFIG, chart_for)
from .pptx_util import (EMU, I, by_id, by_name, one, remove, put, set_lines, set_image, fit, geom, clone, dup_slide,
                        dim_box, set_size, prune_images)
from .styles import STYLES, HERO_PAGES, template_path

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.normpath(os.path.join(HERE, '..', 'templates', 'KP_2_v3.pptx'))
CM = 1 / 2.54

GROUPS = {'crane': 'ДЛЯ КРАНА', 'trailer': 'ДЛЯ ПРИЧЕПА'}
NPL_CHIPS = ['Гальма на вибір', 'Колеса 400/60-15.5', 'Колеса 500/50-17', 'Колеса 550/45-22.5',
             'Кількість коників', 'Колір на замовлення', 'Опції для крана: с. {opt}', 'Опції для причепа: с. {opt}']
OPT_TITLE_CHARS = 22
TRL_CHIPS = ['Гальма на вибір', 'Колеса на вибір', 'Коники {bolsters}', 'Подовжувач рами {frame_ext_mm} мм',
             'Опції для крана: с. {opt}', 'Опції для причепа: с. {opt}']
NOTE_TRL = ('Аксесуари з каталогів BMF (bmf.rv.ua, bmf.ee) для кранів і причепів, сумісні з комплектом. Ціни — за запитом: '
            'обрані опції додаємо в КП окремими рядками.')
NOTE_CRANE = ('Аксесуари з каталогів BMF (bmf.rv.ua, bmf.ee), сумісні з краном комплекту. Ціни — за запитом: '
              'обрані опції додаємо в КП окремими рядками.')
NOTE_NPL = ('Аксесуари з каталогів BMF (bmf.rv.ua, bmf.ee) для кранів і причепів, сумісні з краном комплекту. Ціни — за запитом: '
            'обрані опції додаємо в КП окремими рядками. Сумісність опцій для причепа з НПЛ-10 підтверджуємо під замовлення.')

# Admin «Написи й елементи» (spec.overrides.layout = {show, text, sight, contacts}): labels the engine writes or the
# template carries, switches for cover/footer elements, the cover sight frame per cover photo. Empty text = as now.
LAYOUT_TEXTS = dict(
    kp_title='КОМЕРЦІЙНА ПРОПОЗИЦІЯ', cover_kicker='FORESTRY CRANE SYSTEM', cover_kicker_trailer='TIMBER TRAILER SYSTEM',
    sight_title='TARGET LOCKED', client_label='ПІДГОТОВЛЕНО ДЛЯ',
    footer='{сайт}  ·  {телефон}', footer_label='СИСТЕМА ЛІСОВОГО КРАНА', footer_label_price='ВАРТІСТЬ КОМПЛЕКТУ',
    sec_manifest='МАНІФЕСТ', sec_crane_in_kit='КРАН-МАНІПУЛЯТОР', sec_anatomy='КОНСТРУКЦІЯ', sec_passport='ТЕХНІЧНИЙ ПАСПОРТ',
    sec_passport_in_kit='ТЕХНІЧНИЙ ПАСПОРТ КРАНА', sec_trailer_npl='НАПІВПРИЧІП', sec_trailer='ПРИЧІП',
    sec_trailer_spec='ГАБАРИТИ ТА ХАРАКТЕРИСТИКИ', sec_config='КОНФІГУРАЦІЯ', sec_options='ДОДАТКОВІ ОПЦІЇ', sec_price='ВАРТІСТЬ',
    sec_maker='ВИРОБНИК', sec_own='ВЛАСНЕ ВИРОБНИЦТВО',
    module='МОДУЛЬ', term='T-',
    passport_note='* без захвату і ротатора. Дані виробника, bmf.ee. Вага {вага} кг — без опори, захвату і ротатора.',
    anatomy_note='* без захвату і ротатора · bmf.ee',
    maker_badge='ROBOT WELDING · LIVE', own_badge=OWN_PRODUCTION['badge'],
    maker_gallery='// В ПОЛІ · КЛІЄНТИ BMF', own_gallery='// НАШІ ВИРОБИ',
    lbl_phone='ТЕЛЕФОН', lbl_email='E-MAIL', lbl_site='САЙТ', lbl_address='АДРЕСА', lbl_socials='СОЦМЕРЕЖІ',
    lbl_production='ВИРОБНИЦТВО', production='Напівпричепи НПЛ-10\n100+ виготовлено в Сарнах')
LAYOUT_SHOW = dict(kp_no=True, kp_date=True, frames=True, sight=True, client=True, footer=True, footer_label=True,
                   module=False, term=False)   # «МОДУЛЬ 01» and «T-01» off since the KPs of 22.10.2026
SIGHT_BOX = (4.05, 1.3, 1.75, 1.75)
SIGHTS = {'prod/truck_conversion.png': dict(x=6.1, y=1.7, w=1.55, h=1.9)}   # default sight per cover photo (on the crane)   # template: frame corners 5-12, centre ring 13, leader 14, label 15+16
PAGE_W, PAGE_H = 8.27, 11.69


def is_mounting(row):
    return (row.get('item_id') or '').lower().startswith('mount') or 'монтаж' in (row.get('title') or '').lower()


def plural(n, one_, few, many):
    nums = re.findall(r'\d+', str(n))   # "2/4" agrees with the last number
    if not nums: return many
    n = int(nums[-1])
    if n % 10 == 1 and n % 100 != 11: return one_
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14: return few
    return many


def frame_photo(im, pos):
    """Crop an image to the admin framing {zoom, fx, fy}: zoom 2 keeps half the width and height around the focus."""
    if not pos or im is None: return im
    z = pos.get('zoom', 1); W, H = im.size
    w, h = max(1, round(W / z)), max(1, round(H / z))
    x = round((W - w) * pos.get('fx', 0.5)); y = round((H - h) * pos.get('fy', 0.5))
    return im.crop((x, y, x + w, y + h))


def frame_tile(row, img):
    """tile_image() result with the row's photo_pos applied (the picture is then always re-encoded)."""
    pos = row.get('photo_pos'); keep, im, data = img
    if not pos or im is None: return img
    return None, frame_photo(im, pos), None


class Engine:
    def __init__(self, spec, build_dir):
        self.spec = spec
        self.c = spec['crane']; self.cs = self.c['specs']
        self.P = PROFILES[self.c['profile']]
        self.npl = spec['npl'] is not None
        self.trl = spec.get('trailer') if not self.npl else None
        self.T = TRAILERS[self.trl['profile']] if self.trl else None
        self.kit = 'npl_crane' if self.npl else 'crane_kit'
        self.truck = spec['kit_type'] == 'truck_crane'   # truck converted to a timber carrier, crane on a pyramid
        self.cache = Cache(build_dir)
        self.style = spec.get('style') or 'dark'
        self.S = STYLES[self.style]
        R.set_theme(self.S['theme'])
        self.panel = self.S.get('cover') == 'panel'   # light design whose cover is an orange panel with a crane cut-out
        lay = (spec.get('overrides') or {}).get('layout') or {}
        self.Lset = {k: v for k, v in (lay.get('text') or {}).items() if k in LAYOUT_TEXTS and isinstance(v, str) and v.strip()}
        self.L = dict(LAYOUT_TEXTS, **self.Lset)
        self.show = dict(LAYOUT_SHOW, **{k: bool(v) for k, v in (lay.get('show') or {}).items() if k in LAYOUT_SHOW})
        self.sights = lay.get('sight') or {}
        self.cover_key = 'template'
        ct = dict(spec['contacts'])
        for k, v in (lay.get('contacts') or {}).items():
            if k not in ('phones', 'email', 'sites', 'address', 'socials') or not v: continue
            if isinstance(v, str) and k in ('phones', 'sites', 'socials'): v = [x.strip() for x in v.split('\n') if x.strip()]
            if v: ct[k] = v
        spec['contacts'] = ct

    # ------------------------------------------------------------ helpers
    def sp(self, k, default='—'):
        return self.cs.get(k) or default

    def m(self): return self.c['model']

    def kit_line(self):
        return f"у комплекті з ротатором {self.cs['rotator_t']} т і захватом {self.cs['grapple_m2']} м²"

    def raster(self, kind, fn, *args, assets=()):
        return self.cache.get(f"{self.S['theme']}-{kind}", fn, args, assets)

    def photo_override(self, key):
        o = ((self.spec.get('overrides') or {}).get('bg') or {}).get(key) or {}
        p = o.get('path')
        if p and R.asset_ok(p): return p, float(o.get('fx', 0.5)), float(o.get('fy', 0.45))
        return None

    def hero(self, which, maker):
        """Photo for the cover / end page: spec.photos, else the profile default; None keeps the template's."""
        path = self.spec['photos'].get(which)
        if path:
            fx, fy = self.spec['photos'].get(which + '_focus') or PHOTO_FOCUS.get(path) or ((0.5, 0.42) if which == 'cover' else (0.5, 0.5))
        else:
            d = self.T[which] if self.T else TRUCK[which] if self.truck and TRUCK.get(which) else self.P[which][self.kit]
            if d is None: return None
            path, fx, fy = d
        if which == 'cover': self.cover_key = path
        return self.raster(which + '_bg', maker, path, fx, fy, assets=(path,))

    # ------------------------------------------------------------ build
    def build(self):
        prs = Presentation(template_path(self.style))
        self.prs = prs
        cover, manifest, anatomy, passport, config, price, maker, end = list(prs.slides)
        self.pages = dict(cover=cover, manifest=manifest, anatomy=anatomy, passport=passport, config=config,
                          price=price, maker=maker, end=end)
        self.crane_pages()
        seat_blob = by_id(config, 37).image.blob
        crane_blob = by_id(config, 14).image.blob
        if self.npl or self.trl: self.trailer_pages()
        self.options = None
        if self.spec['accessories']:
            idx = list(prs.slides).index(config) + 1
            self.options = self.options_page(dup_slide(prs, config, idx))
        self.opt_no = list(prs.slides).index(self.options) + 1 if self.options else None
        self.config_page(crane_blob)
        self.price_page()
        if self.npl: self.own_production(seat_blob)
        # truck kits: the conversion page and the conversion maker's page unless the spec says otherwise (КП ЗІЛ 22.10.2026)
        extra = self.spec['pages'] if isinstance(self.spec.get('pages'), dict) else dict(conversion=True, own_production=True)
        if self.truck and extra.get('own_production'):   # the conversion maker's page right after the BMF one
            own = dup_slide(prs, maker, list(prs.slides).index(maker) + 1)
            self.own_production(seat_blob, own); self.pages['own_production'] = own
        if self.truck and extra.get('conversion'):   # what the conversion includes, right after the cover
            self.pages['conversion'] = self.conversion_page(dup_slide(prs, manifest, 1))
        self.crane_blob = crane_blob
        self.cover_page()
        self.end_page()
        self.chrome()
        if self.options: self.pages['options'] = self.options
        self.layout()
        self.overrides()
        prune_images(prs)
        return prs

    # ------------------------------------------------------------ admin overrides: page underlays and page texts
    def overrides(self):
        if self.npl: self.pages['own_production'] = self.pages.pop('maker')
        ov = self.spec.get('overrides') or {}
        for key, o in (ov.get('bg') or {}).items():
            s = self.pages.get(key); path = (o or {}).get('path')
            if s is None or not path or not R.asset_ok(path): continue
            if key in HERO_PAGES and not (key == 'cover' and self.panel): continue   # handled as spec.photos by the page
            bgs = by_name(s, 'bg')
            if not bgs: continue
            op = float(o.get('opacity', 0.18))
            set_image(bgs[0], self.raster('underlay', R.underlay_on, bgs[0].image.blob, path, op,
                                          float(o.get('fx', 0.5)), float(o.get('fy', 0.5)), assets=(path,)))
        for key, texts in (ov.get('texts') or {}).items():
            s = self.pages.get(key)
            if s is None: continue
            for sid, text in (texts or {}).items():
                try: sh = by_id(s, int(sid))
                except (KeyError, ValueError): continue
                if sh.has_text_frame and text is not None: set_lines(sh, str(text).split('\n'))

    # ------------------------------------------------------------ crane pages (template slides 1-5)
    def crane_pages(self):
        pg, c, cs, P, m = self.pages, self.c, self.cs, self.P, self.m()
        native = P.get('native')
        # 01 cover tag
        tag = self.tdata()['cover_tag'] if self.npl or self.trl else f"{m} · {cs['reach_m']} M · {cs['torque_knm']} KNM"
        if by_name(pg['cover'], 'TextBox 15'): put(by_id(pg['cover'], 16), None, tag)
        # 02 crane manifest
        s = pg['manifest']
        if self.photo_override('manifest'):
            path, fx, fy = self.photo_override('manifest')
            set_image(one(s, 'bg'), self.raster('side_bg', R.side_bg, path, fx, fy, assets=(path,)))
        put(by_id(s, 13), c.get('lead') or P['lead'])
        put(by_id(s, 14), c.get('lead2') or P['lead2'])
        put(by_id(s, 16), [cs['lift_4m_kg'], None], None)
        put(by_id(s, 41), f"Поворот {cs['turn_deg']}°")
        # 03 anatomy
        s = pg['anatomy']
        put(by_id(s, 13), f'Кожен вузол {m} розрахований на щоденне навантаження. Розбираємо кран по деталях — від стріли до щелеп захвату.')
        cyl = cs.get('slew_cyl')
        cyl = f"{cyl} {plural(cyl, 'циліндр', 'циліндри', 'циліндрів')} · " if cyl else ''
        put(by_id(s, 28), None, f"{cyl}{cs['turn_deg']}° · {self.sp('slew_knm')} кНм")
        put(by_id(s, 42), f"РОТАТОР {cs['rotator_t']} Т + ЗАХВАТ", f"у комплекті · Hardox® {cs['grapple_m2']} м²")
        put(by_id(s, 49), None, f"виліт до {cs['reach_m']} м")
        put(by_id(s, 35), f"КЛАПАН {self.sp('valve')}", f"{self.flow()} · {self.sp('pressure_bar')} бар")
        put(by_id(s, 68), [cs['reach_m'], None]); put(by_id(s, 71), [cs['lift_4m_kg'], None])
        put(by_id(s, 74), [cs['lift_full_kg'], None]); put(by_id(s, 77), [cs['turn_deg'], None])
        if native:
            for k, sh in (('lift_4m_kg', 'dim_1100 кг'), ('lift_full_kg', 'dim_580 кг'), ('reach_m', 'dim_7,2 м')):
                if cs[k] != TEMPLATE_720[k]:
                    for d in by_name(s, sh): put(d, f"{cs[k]} {'м' if k == 'reach_m' else 'кг'}")
        else:
            self.anatomy_drawings(s)
        # 04 crane passport
        self.passport(pg['passport'])
        # 05 configuration: crane cut-out number, "already in the crane price" box
        s = pg['config']
        put(by_id(s, 46), [None, None, f" {cs['rotator_t']} т", None, None, f" {cs['grapple_m2']} м² ", None, None])
        if not native:
            pic = by_id(s, 14)
            set_image(pic, self.raster('decal', lambda b, box, no: R.png(R.redecal(Image.open(io.BytesIO(b)), box, no)),
                                       pic.image.blob, DECAL_CONFIG, P['model_no']))

    def flow(self):
        f = self.sp('valve_flow_l')
        return f if f == '—' or f.endswith('л') else f + ' л'

    def anatomy_drawings(self, s):
        """Manufacturer drawing of this crane, same treatment as the user's 720 drawing crops."""
        P, cs = self.P, self.cs; D = P['draw']; chart = chart_for(self.c['profile'], self.c); n = D['open']
        fill = lambda labels: [(x, y, t.format(**cs)) for x, y, t in labels]
        dims = by_name(s, 'dim_7205')[0]; proto = copy.deepcopy(dims._element)
        for sh in [sh for sh in s.shapes if sh.name.startswith('dim_')]: remove(sh)
        s.shapes._spTree.append(proto); proto_sh = list(s.shapes)[-1]
        for sid, box, labels, erase in ((85, D['side'], fill(D['side_labels']), D.get('side_erase', ())), (88, D['fold'], fill(D['fold_labels']), D.get('fold_erase', ()))):
            pic = by_id(s, sid)
            im = R.chart_crop(chart, box, erase)
            data = self.raster('drawing', lambda ch, b, e, l, n_: R.png(R.drawing(R.chart_crop(ch, b, e), l, n_)),
                               chart, box, tuple(erase), tuple(labels), n, assets=(chart,))
            set_image(pic, data)
            x, y = pic.left / EMU, pic.top / EMU
            if sid == 85: w = pic.width / EMU; h = w * im.height / im.width
            else: h = pic.height / EMU; w = h * im.width / im.height
            pic.width, pic.height = I(w), I(h)
            for cx, cy, t in labels:
                dim_box(s, proto_sh, x + cx / im.width * w, y + cy / im.height * h, t)
        remove(proto_sh)
        if D.get('plate'):  # mounting plate differs from the 720/650 one: drawing with its dimensions baked in
            pic = by_id(s, 82)
            data = self.raster('drawing', lambda ch, b, n_: R.png(R.drawing(R.chart_crop(ch, b), [], n_)), chart, D['plate'], n, assets=(chart,))
            set_image(pic, data); fit(pic, Image.open(io.BytesIO(data)), (I(0.5), I(9.05), I(2.75), I(1.35)))
        crane = by_id(s, 14)
        set_image(crane, self.raster('decal', lambda b, box, no: R.png(R.redecal(Image.open(io.BytesIO(b)), box, no)),
                                     crane.image.blob, DECAL_ANATOMY, P['model_no']))

    def reach_axis(self, s, gx, gw, span):
        """Cranes reaching past 7,5 m: the template's 0–7 m grid (tick, grid line, label per metre) re-spaced to span."""
        groups = [[by_id(s, i), by_id(s, i + 1), by_id(s, i + 2)] for i in range(15, 39, 3)]
        while len(groups) <= int(span):
            groups.append([clone(s, sh) for sh in groups[-1]])
        for m, (tick, line, lab) in enumerate(groups):
            x = I(gx + gw * m / span)
            for sh in (tick, line): sh.left = x
            lab.left = x - lab.width // 2
            put(lab, f'{m} м')
        for sh in (by_id(s, 14), by_id(s, 39), by_id(s, 40), by_id(s, 41), by_id(s, 42), by_id(s, 43), by_id(s, 44)):
            s.shapes._spTree.remove(sh._element); s.shapes._spTree.append(sh._element)   # bars stay above the new grid lines

    def passport(self, s):
        P, cs = self.P, self.cs; native = P.get('native')
        b4, c4, l4 = by_id(s, 39), by_id(s, 40), by_id(s, 41)
        bf, cf, lf = by_id(s, 42), by_id(s, 43), by_id(s, 44)
        same = all(cs[k] == TEMPLATE_720[k] for k in TEMPLATE_720)
        gx, gw = 0.75, 6.9
        reach = float(cs['reach_m'].replace(',', '.'))
        span = self.span = 7.5 if reach <= 7.5 else reach + 0.45   # metres across the chart grid
        if span != 7.5: self.reach_axis(s, gx, gw, span)
        if not same:
            # load-by-reach bars: 4 m and full reach, heights proportional to the user's 1100 kg bar
            k = b4.height / 1100
            bottom = b4.top + b4.height
            for bar, cap, lab, kg in ((b4, c4, l4, int(cs['lift_4m_kg'])), (bf, cf, lf, int(cs['lift_full_kg']))):
                dy = bottom - int(k * kg) - bar.top
                bar.top += dy; bar.height = int(k * kg); cap.top += dy; lab.top += dy
                put(lab, [str(kg), None, None])
            for (bar, cap, lab), m in (((b4, c4, l4), 4), ((bf, cf, lf), reach)):
                dx = I(gx + gw * m / span) - (bar.left + bar.width // 2)
                for sh in (bar, cap, lab): sh.left += dx
        put(by_id(s, 47), f"ЗОНА РОБОТИ 0 — {cs['reach_m']} М")
        if not native:
            D = P['draw']; chart = chart_for(self.c['profile'], self.c); n = D['open']
            if D.get('caption_at'):  # the taller 750 boom crosses the caption line: caption goes under the boom
                cap = by_id(s, 13); cap.left, cap.top = I(D['caption_at'][0]), I(D['caption_at'][1])
            dr = by_name(s, 'crane_side_drawing')[0]
            def side_view(ch, box, erase, n_, padg):
                im = R.chart_crop(ch, box, erase)
                clean = R.steel(im, R.split(im, n_))
                bb = clean.getchannel('A').getbbox()
                gl = R.side_glow(clean.crop(bb), padg)
                return R.png(gl), [bb, gl.size]
            padg = 60
            data, (bb, gsize) = self.raster('passport', side_view, chart, D['side'], tuple(D.get('pass_erase', ())), n, padg, assets=(chart,))
            PIV, TIP, BASE_Y = D['piv'], D['tip'], D['base_y']
            axis_y = 2.95 + 1.5
            in_per_px = (gw * D['tip_m'] / span) / (TIP - PIV)
            set_image(dr, data)
            dr.width = I(gsize[0] * in_per_px); dr.height = I(gsize[1] * in_per_px)
            dr.left = I(gx - (PIV - bb[0] + padg) * in_per_px)
            dr.top = I(axis_y - (BASE_Y - bb[1] + padg) * in_per_px)
        vals = [cs['reach_m'], cs['torque_knm'], cs['lift_4m_kg'], cs['lift_full_kg'], cs['grapple_m2'], cs['rotator_t'],
                self.sp('valve'), self.sp('slew_knm'), self.sp('slew_cyl'), cs['turn_deg'], self.sp('pressure_bar'),
                self.sp('pump_lpm'), self.sp('telescope'), self.sp('legs'), self.sp('weight_kg')]
        for i, v in enumerate(vals, 1): put(one(s, f'fld_spec_{i:02d}'), v)
        put(by_id(s, 80), self.flow())   # unit of row 07
        put(by_id(s, 118), self.L['passport_note'].replace('{вага}', self.sp('weight_kg')))

    # ------------------------------------------------------------ НПЛ-10 trailer pages
    def tdata(self):
        """Texts and pictures of the trailer pages and the trailer cover: НПЛ-10 (own production) or a BMF trailer."""
        if hasattr(self, '_td'): return self._td
        m = self.m()
        if self.npl:
            npl = self.spec['npl']; stakes = npl['stakes']
            fmtv = dict(wheels=npl['wheels'], stakes=stakes, brakes=npl['brakes'],
                        stakes_text=f"{stakes} {plural(stakes, 'коник', 'коники', 'коників')}")
            td = dict(section='// 01 — НАПІВПРИЧІП', lead=npl['lead'] or NPL10['lead'], lead2=npl['lead2'] or NPL10['lead2'],
                      kpi=(['10 000', ' кг'], 'вантажопідйомність · об’єм 10 м³'),
                      tiles=[(t.format(**fmtv), d) for t, d in NPL10['tiles']], label='ЛІСОВОЗ НПЛ-10',
                      photo=NPL10['p2_photo'], spec_head=('МІЦНИЙ', 'НА 10 ТОНН.'), dims='ДОВЖИНА 6950 · ШИРИНА 2412 · ВИСОТА 2789',
                      side=(NPL10['side'], -90), front=(NPL10['front'], 0),
                      spec_rows=[(k.format(**fmtv), v.format(**fmtv), u) for k, v, u in NPL10['spec_rows']],
                      note=NPL10['drawing_note'], cover_text=f'Напівпричіп-лісовоз НПЛ-10 власного виробництва з краном-маніпулятором {m}, ротатором і захватом — комплект для навантаження й вивезення деревини.',
                      cover_kpi=NPL10['cover_kpi'], outline='НПЛ-10', cover_tag=f"НПЛ-10 · 10 Т · {m}",
                      chips=list(NPL_CHIPS))
        else:
            td = self.bmf_trailer_data()
        self._td = td
        return td

    def bmf_trailer_data(self):
        t, T, m = self.trl, self.T, self.m(); sp = t['specs']
        g = lambda k: (sp.get(k) or '').strip() if (sp.get(k) or '').strip() not in ('—', '-') else ''
        digits = re.sub(r'\D', '', g('payload_kg'))
        kg = f"{int(digits):,}".replace(',', ' ') if digits else ''
        tons = f"{int(digits) / 1000:g}".replace('.', ',') if digits else ''
        stakes = g('stakes')
        stakes_text = f"{stakes} {plural(stakes, 'коник', 'коники', 'коників')}" if stakes else ''
        wheels, wopt = g('wheels'), g('wheels_options')
        L, W, H = g('total_length_mm'), g('width_mm'), g('height_mm')
        dims = ', '.join(x for x in (f'довжина {L} мм' if L else '', f'ширина {W} мм' if W else '', f'висота {H} мм' if H else '') if x)
        lead2 = ' '.join(x for x in ((dims[0].upper() + dims[1:] + '.') if dims else '',
                                     f"Сумісні крани: {g('cranes')}." if g('cranes') else '') if x)
        tiles = [(f'{kg} кг', 'вантажопідйомність причепа') if kg else None,
                 (f"{g('load_length_mm')} мм", 'довжина площі навантаження') if g('load_length_mm') else None,
                 (f"{g('load_area_m2')} м²", 'площа перерізу вантажу між кониками') if g('load_area_m2') else None,
                 (f'Колеса {wheels}', f'на вибір також {wopt.replace(";", ",")}' if wopt else 'ходові колеса з дисками') if wheels else None,
                 (stakes_text, f"коники {g('bolsters')}" if g('bolsters') else 'коники зі стійками') if stakes else None,
                 ('Дві балки рами', f"шасі {g('chassis')}" + (f", вісь {g('axle')}" if g('axle') else '')) if g('chassis') else None,
                 (f"Дишло {g('drawbar_angle_deg')}°", 'кут повороту дишла в сторони') if g('drawbar_angle_deg') else None,
                 (f"Опори {g('legs')}", f"подовжувач рами {g('frame_ext_mm')} мм на замовлення" if g('frame_ext_mm') else 'опорні ноги причепа') if g('legs') else None,
                 (f"Кліренс {g('clearance_mm')} мм", 'дорожній просвіт') if g('clearance_mm') else None,
                 ('Гальма', g('brakes')) if g('brakes') else None]
        tiles = [x for x in tiles if x][:8]
        rows = [('Вантажопідйомність', kg, 'кг'), ('Довжина сортиментів', g('log_length_m'), 'м'),
                ('Загальна довжина', L, 'мм'), ('Довжина площі навантаження', g('load_length_mm'), 'мм'),
                ('Ширина', W, 'мм'), ('Висота', H, 'мм'), ('Площа навантаження', g('load_area_m2'), 'м²'),
                ('Шасі (рама)', g('chassis'), ''), ('Вісь', g('axle'), ''), (f"Колеса ({g('wheels_qty') or '4'} шт)", wheels, ''),
                ('Коники / стійки', stakes, 'шт'), ('Тип коників', g('bolsters'), ''), ('Кут повороту дишла', g('drawbar_angle_deg'), '°'),
                ('Кліренс', g('clearance_mm'), 'мм'), ('Опорні ноги', g('legs'), ''), ('Подовжувач рами', g('frame_ext_mm'), 'мм'),
                ('Гальмівна система', g('brakes'), ''),
                ('Решітка огорожі, освітлення, номерна рамка', 'так' if g('guard_grid') == 'так' and g('lights_plate') == 'так' else '', '')]
        rows = [r for r in rows if r[1]][:15]
        rows += [('', '', '')] * (15 - len(rows))
        return dict(section='// 01 — ПРИЧІП', lead=t.get('lead') or f"{t['title']}: {t['short']}.", lead2=t.get('lead2') or lead2,
                    kpi=([kg, ' кг'], 'вантажопідйомність' + (f" · площа {g('load_area_m2')} м²" if g('load_area_m2') else '')),
                    tiles=tiles, label=f"ЛІСОВОЗ {t['model']}", photo=T['work'], spec_head=('МІЦНИЙ', f'НА {tons} ТОНН.'),
                    dims=' · '.join(x for x in (f'ДОВЖИНА {L}' if L else '', f'ШИРИНА {W}' if W else '', f'ВИСОТА {H}' if H else '') if x),
                    side=(T['side'], 0), front=(T['rear'], 0), spec_rows=rows,
                    note='* Креслення виробника (bmf.ee) для стандартної комплектації. Ширина й висота залежать від коліс; розміри можуть змінюватися виробником.',
                    cover_text=f"{t['title']} з краном-маніпулятором {m}, ротатором і захватом — комплект для навантаження й вивезення деревини.",
                    cover_kpi=[('01 / ВАНТАЖ', tons, '  т'), ('02 / КОНИКИ', stakes or '—', '  шт')], outline=T['no'],
                    cover_tag=f"{t['model']} · {tons} Т · {m}",
                    chips=[c.replace('{bolsters}', g('bolsters')).replace('{frame_ext_mm}', g('frame_ext_mm')) for c in TRL_CHIPS
                           if ('{bolsters}' not in c or '/' in g('bolsters'))
                           and ('{frame_ext_mm}' not in c or g('frame_ext_mm'))])

    def trailer_pages(self):
        prs, pg = self.prs, self.pages
        D = self.tdata()
        t1 = dup_slide(prs, pg['manifest'], 1)
        t2 = dup_slide(prs, pg['passport'], 2)
        self.pages.update(trailer=t1, trailer_spec=t2)
        s = t1
        put(by_id(s, 11), D['section'])
        put(by_id(s, 12), 'ВЕЗЕ ЛІС ТАМ,', 'ДЕ ДОРОГИ', 'ЗАКІНЧУЮТЬСЯ.')
        put(by_id(s, 13), D['lead'])
        put(by_id(s, 14), D['lead2'])
        put(by_id(s, 16), *D['kpi'])
        for n, (t, d) in enumerate(D['tiles']):
            put(by_id(s, 21 + n * 5), t); put(by_id(s, 22 + n * 5), d)
        put(by_id(s, 10), D['label'])
        path, fx, fy = self.photo_override('trailer') or D['photo']
        set_image(one(s, 'bg'), self.raster('side_bg', R.side_bg, path, fx, fy, assets=(path,)))

        s = t2
        put(by_id(s, 11), '// 02 — ГАБАРИТИ ТА ХАРАКТЕРИСТИКИ')
        put(by_id(s, 12), *D['spec_head'])
        put(by_id(s, 13), 'ГАБАРИТНІ РОЗМІРИ, ММ*'); by_id(s, 13).left, by_id(s, 13).top = I(0.45), I(2.6)
        put(by_id(s, 47), D['dims'])
        for sid in range(14, 45): remove(by_id(s, sid))
        dr = by_name(s, 'crane_side_drawing')[0]
        art = lambda path, rot: self.raster('line_art', lambda p, r: R.png(R.line_art(p, r)), path, rot, assets=(path,))
        side_b, front_b = art(*D['side']), art(*D['front'])
        side, front = Image.open(io.BytesIO(side_b)), Image.open(io.BytesIO(front_b))
        y0, hh = I(2.85), I(1.95)
        set_image(dr, side_b); dr.name = 'npl_side_drawing'
        fit(dr, side, (I(0.45), y0, I(4.6), hh))
        fp = s.shapes.add_picture(io.BytesIO(front_b), 0, 0); fp.name = 'npl_front_drawing'
        fit(fp, front, (I(5.25), y0, I(2.57), hh))
        labels = [by_id(s, i) for i in (51, 55, 60, 64, 69, 73, 78, 82, 87, 91, 96, 100, 105, 109, 114)]
        units = [by_id(s, i) for i in (53, 57, 62, 66, 71, 75, 80, 84, 89, 93, 98, 102, 107, 111, 116)]
        unit_rpr = units[0].text_frame.paragraphs[0].runs[0]._r.get_or_add_rPr()
        for i, (lab, (k, v, u)) in enumerate(zip(labels, D['spec_rows']), 1):
            val = one(s, f'fld_spec_{i:02d}')
            put(lab, k); put(val, v)
            if self.trl and len(v) > 13:   # long values (frame profile, bolster types) take one line in a wider, smaller field
                val.left, val.width = val.left - I(1.3), val.width + I(1.3)
                for r in val.text_frame.paragraphs[0].runs: r.font.size = Pt(10)
            p0 = units[i - 1].text_frame.paragraphs[0]
            if p0.runs and p0.runs[0].font.size: put(units[i - 1], u)
            else:   # the template left some unit fields unstyled: take the first unit's run style
                p0.text = u
                if p0.runs: p0.runs[0]._r.replace(p0.runs[0]._r.get_or_add_rPr(), copy.deepcopy(unit_rpr))
        put(by_id(s, 118), D['note'])
        put(by_id(s, 10), D['label'])

    # ------------------------------------------------------------ configuration page
    def tile_image(self, row, crane_blob):
        """(template shape id or None, PIL image or None, encoded bytes or None) for the row's tile."""
        iid = (row.get('item_id') or '').lower(); kind = row.get('kind')
        if row.get('photo_force') and row.get('photo') and R.asset_ok(row['photo']):   # photo set in the admin
            im = Image.open(R.asset(row['photo']))
            if im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getchannel('A').getextrema()[0] < 250:
                return None, R.cutout_glow(R.alpha_crop(im)), None
            return None, R.grade(im.convert('RGB'), sat=0.8, bright=0.92, warm=0.0), None
        if kind == 'crane' or (not kind and iid == (self.c.get('id') or '').lower()):
            return 14, Image.open(io.BytesIO(crane_blob)), crane_blob
        if self.T and kind == 'trailer':
            data = self.raster('trl_cutout', lambda p: R.png(R.cutout_glow(R.alpha_crop(Image.open(R.asset(p))))),
                               self.T['cutout'], assets=(self.T['cutout'],))
            return None, Image.open(io.BytesIO(data)), data
        if iid.startswith('npl') or (kind == 'trailer' and not row.get('photo')):
            data = self.raster('npl_cutout', lambda p: R.png(R.cutout_glow(R.alpha_crop(Image.open(R.asset(p))))),
                               NPL10['cutout'], assets=(NPL10['cutout'],))
            return None, Image.open(io.BytesIO(data)), data
        for prefix, sid in TEMPLATE_TILES.items():
            if prefix != 'crane' and iid.startswith(prefix):
                blob = by_id(self.pages['config'], sid).image.blob
                return sid, Image.open(io.BytesIO(blob)), blob
        if row.get('photo') and R.asset_ok(row['photo']):
            im = Image.open(R.asset(row['photo']))
            if im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getchannel('A').getextrema()[0] < 250:
                return None, R.cutout_glow(R.alpha_crop(im)), None
            return None, R.grade(im.convert('RGB'), sat=0.8, bright=0.92, warm=0.0), None
        return None, None, None

    @staticmethod
    def encoded(im, data):
        return data or (R.png(im) if im.mode == 'RGBA' else R.jpg(im))

    def config_page(self, crane_blob):
        s = self.pages['config']; rows = self.spec.get('config_rows') or self.spec['rows']; n = len(rows)
        slots = {'TL': (13, 14, 15, 18, 19, 20, 21), 'TR': (36, 37, 38, 39, 40, 41, 42),
                 'BL': (22, 23, 24, 25, 26, 27, 28), 'BR': (29, 30, 31, 32, 33, 34, 35)}
        sh = lambda sid: by_id(s, sid)
        imgs = [frame_tile(r, self.tile_image(r, crane_blob)) for r in rows]
        for slot in slots.values():   # "МОДУЛЬ 01" labels: admin prefix, number kept
            lab = sh(slot[2]); lab.name = 'module_label'; put(lab, f"{self.L['module']} {lab.text_frame.text[-2:]}")

        def fill(slot, row, img, box=None):
            rect, pic, label, line, title, desc, price = (sh(i) for i in slot)
            put(title, row['title']); put(desc, row['desc']); put(price, row['price_text'])
            keep, im, data = img
            if keep == pic.shape_id and box is None: return
            if im is None: remove(pic); return
            if keep != pic.shape_id: set_image(pic, self.encoded(im, data))
            fit(pic, im, box or (rect.left + I(0.16), rect.top + I(0.30), rect.width - I(0.32), I(1.55)))

        def stretch(slot, dy):
            rect, pic, label, line, title, desc, price = (sh(i) for i in slot)
            rect.height = rect.height + dy
            for x in (line, title, desc, price): x.top += dy

        def drop(slot):
            for i in slot: remove(sh(i))

        def relabel(slot, k): put(sh(slot[2]), f"{self.L['module']} {k:02d}")

        dy = I(7.3 * CM)   # tile + gap + tile: top tiles stretched over both rows (as in the user's НПЛ-10 KPs)
        if n == 4:
            for slot, row, img in zip(('TL', 'BL', 'BR', 'TR'), rows, imgs): fill(slots[slot], row, img)
        elif n == 2:
            drop(slots['BL']); drop(slots['BR'])
            for (slot, bx), row, img in zip((('TL', 1.5), ('TR', 11.0)), rows, imgs):
                stretch(slots[slot], dy)
                fill(slots[slot], row, img, (I(bx * CM), I(7.3 * CM), I(8.4 * CM), I(10.6 * CM)))
        elif n == 3:
            drop(slots['BL']); stretch(slots['TL'], dy)
            fill(slots['TL'], rows[0], imgs[0], (I(1.5 * CM), I(7.3 * CM), I(8.4 * CM), I(10.6 * CM)))
            fill(slots['TR'], rows[1], imgs[1]); fill(slots['BR'], rows[2], imgs[2]); relabel(slots['BR'], 3)
        elif n == 1:
            for k in ('TR', 'BL', 'BR'): drop(slots[k])
            stretch(slots['TL'], dy); r0 = sh(13); r0.width = I(7.37)
            for x in (18,): sh(x).width = I(7.37 - 0.32)
            sh(19).width = I(7.37 - 0.32); sh(20).width = I(7.37 - 0.32 - 2.0)
            sh(21).left = r0.left + r0.width - I(0.16) - sh(21).width
            fill(slots['TL'], rows[0], imgs[0], (I(0.45 + 0.4), I(2.55 + 0.35), I(7.37 - 0.8), I(4.4)))
        elif n <= 9 and not (self.spec.get('config_rows') and any(im is None for _, im, _ in imgs)):
            if any(im is None for _, im, _ in imgs): self.split_tiles(s, slots, rows, imgs, 5.67)   # photo-less as low cards
            else: self.grid_tiles(s, slots, rows, imgs)
        else:   # 10+ positions (or own cards with some lacking a photo): the upgrade chips give their place to the tiles,
                # the "in the crane price" banner moves down
            down = 1.45
            for sh in list(s.shapes):
                if 48 <= sh.shape_id <= 64: remove(sh)
                elif sh.shape_id in (43, 45, 46, 47, 66, 68): sh.top += I(down)
            if any(im is None for _, im, _ in imgs): self.split_tiles(s, slots, rows, imgs, 5.67 + down)
            else: self.grid_tiles(s, slots, rows, imgs, 5.67 + down)
            return
        self.config_chips(s)

    def grid_tiles(self, s, slots, rows, imgs, th_all=5.67):
        """5-12 positions: 3 columns of smaller tiles (4 from 10 positions) cloned from the first tile."""
        n = len(rows); cols = 3 if n <= 9 else 4; nrows = (n + cols - 1) // cols
        gap = 0.11; x0, y0, tw_all = 0.45, 2.55, 7.37
        tw = (tw_all - gap * (cols - 1)) / cols; th = (th_all - gap * (nrows - 1)) / nrows
        proto = [by_id(s, i) for i in slots['TL']]
        for i, (row, (keep, im, data)) in enumerate(zip(rows, imgs)):
            x = x0 + (i % cols) * (tw + gap); y = y0 + (i // cols) * (th + gap)
            rect, pic, label, line, title, desc, price = (clone(s, p) for p in proto)
            geom(rect, x, y, tw, th)
            geom(label, x + 0.16, y + 0.14, 1.6, 0.2); put(label, f"{self.L['module']} {i + 1:02d}"); label.name = 'module_label'
            if cols == 3:
                ph = th - 1.35
                geom(line, x + 0.16, y + th - 0.88, tw - 0.32, 0)
                geom(title, x + 0.16, y + th - 0.81, tw - 0.32, 0.22); put(title, row['title'])
                set_size(title, 950 if len(row['title']) <= 30 else int(950 * 30 / len(row['title'])))   # one line in a third-width tile
                geom(desc, x + 0.16, y + th - 0.57, tw - 0.32, 0.3); put(desc, row['desc']); set_size(desc, 700)
            else:   # quarter-width tile: title in up to two lines, description in up to four
                ph = th - 1.52
                geom(line, x + 0.16, y + th - 1.12, tw - 0.32, 0)
                geom(title, x + 0.16, y + th - 1.06, tw - 0.32, 0.36); put(title, row['title']); set_size(title, 850 if len(row['title']) <= 40 else 750)
                geom(desc, x + 0.16, y + th - 0.68, tw - 0.32, 0.38); put(desc, row['desc']); set_size(desc, 600)
            geom(price, x + 0.16, y + th - 0.30, tw - 0.32, 0.24); put(price, row['price_text']); set_size(price, 1100)
            if im is None: remove(pic)
            else:
                if keep != proto[1].shape_id: set_image(pic, self.encoded(im, data))
                fit(pic, im, (I(x + 0.16), I(y + 0.36), I(tw - 0.32), I(ph - 0.1)))
        for slot in slots.values():
            for i in slot: remove(by_id(s, i))

    def split_tiles(self, s, slots, rows, imgs, th_all):
        """10+ positions, some without a photo: photo tiles in rows of up to 4 (a shorter last row spreads wider),
        positions without a photo as low cards in rows of up to 3 under them."""
        P = [i for i, (_, im, _) in enumerate(imgs) if im is not None]; Q = [i for i in range(len(rows)) if i not in P]
        gap, x0, y0, W = 0.11, 0.45, 2.55, 7.37; hc = 1.0 if self.show['module'] else 1.15
        pc = 3 if len(P) <= 6 else 4; mod = self.show['module']   # without the "МОДУЛЬ 01" labels texts and photos move up
        prow = [P[k:k + pc] for k in range(0, len(P), pc)]; qrow = [Q[k:k + 3] for k in range(0, len(Q), 3)]
        if len(prow) > 1 and len(prow[-1]) == 1: prow[-2:] = [prow[-2][:-1], prow[-2][-1:] + prow[-1]]   # no lone tile
        hp = (th_all - len(qrow) * (hc + gap) - gap * (len(prow) - 1)) / max(1, len(prow))
        proto = [by_id(s, i) for i in slots['TL']]
        y = y0
        for group, h in [(g, hp) for g in prow] + [(g, hc) for g in qrow]:
            w = (W - gap * (len(group) - 1)) / len(group)
            # wide photo tiles of one row share the text block height of their longest description (~6 chars per inch at 7 pt)
            dl = max(-(-len(rows[i]['desc'] or ' ') // int((w - 0.32) * 20.5)) for i in group)
            # one-line titles and descriptions sit closer together, leaving the photo more height
            tight = len(group) < 4 and dl <= 1 and all(len(rows[i]['title']) <= (w - 0.32) * 14 for i in group)
            for j, i in enumerate(group):
                row, (keep, im, data) = rows[i], imgs[i]; x = x0 + j * (w + gap)
                rect, pic, label, line, title, desc, price = (clone(s, p) for p in proto)
                geom(rect, x, y, w, h)
                geom(label, x + 0.16, y + 0.14, 1.6, 0.2); put(label, f"{self.L['module']} {i + 1:02d}"); label.name = 'module_label'
                put(title, row['title']); put(desc, row['desc']); put(price, row['price_text'])
                if im is None and mod:   # low card: label and price on the top line, title and description under them
                    remove(pic); remove(line)
                    geom(price, x + w - 1.56, y + 0.08, 1.4, 0.26); set_size(price, 1050)
                    geom(title, x + 0.16, y + 0.34, w - 0.32, 0.34); set_size(title, 850)
                    geom(desc, x + 0.16, y + 0.68, w - 0.32, 0.28); set_size(desc, 600)
                    continue
                if im is None:   # low card without the label: title over the description, price at the bottom
                    remove(pic); remove(line)
                    geom(title, x + 0.16, y + 0.12, w - 0.32, 0.36); set_size(title, 850)
                    geom(desc, x + 0.16, y + 0.47, w - 0.32, 0.3); set_size(desc, 600)
                    geom(price, x + 0.16, y + h - 0.30, w - 0.32, 0.24); set_size(price, 1050)
                    continue
                wide = len(group) < 4   # title in up to two lines, description in up to three (wide) or five (quarter) lines
                lh = (0.86 if tight else 1.02 + 0.12 * max(0, dl - 2)) if wide else 1.28
                geom(line, x + 0.16, y + h - lh, w - 0.32, 0)
                geom(title, x + 0.16, y + h - lh + 0.06, w - 0.32, 0.38)
                if wide: set_size(title, 950 if len(row['title']) <= 30 else 850)
                else: set_size(title, 850 if len(row['title']) <= 24 else 750)
                geom(desc, x + 0.16, y + h - lh + (0.36 if tight else 0.46), w - 0.32, 0.3 if wide else 0.5)
                set_size(desc, 700 if wide else 600)
                geom(price, x + 0.16, y + h - 0.30, w - 0.32, 0.24); set_size(price, 1100)
                if keep != proto[1].shape_id: set_image(pic, self.encoded(im, data))
                top = 0.36 if mod else 0.18
                fit(pic, im, (I(x + 0.16), I(y + top), I(w - 0.32), I(h - lh - top - 0.1)))
            y += h + gap
        for slot in slots.values():
            for i in slot: remove(by_id(s, i))

    def config_chips(self, s):
        """'+ ОПЦІЇ ДЛЯ АПГРЕЙДУ' chips: spec.upgrade_chips, else the template's / the НПЛ-10 list."""
        chips = self.spec.get('upgrade_chips')
        titles = ' '.join(r['title'].lower() for r in self.spec['rows'])
        if chips is None and (self.npl or self.trl):
            chips = [c for c in self.tdata()['chips'] if self.opt_no or '{opt}' not in c]
        elif chips is None:
            texts = [''.join(r.text for r in by_id(s, 50 + 2 * k).text_frame.paragraphs[0].runs)[2:] for k in range(8)]
            if not self.opt_no and not any(t.lower() in titles for t in texts): return  # template as approved
            if self.opt_no: texts[5] = 'Опції BMF: с. {opt}'   # the template repeats "Ящик для інструмента" here
            chips = list(dict.fromkeys(t for t in texts if t.lower() not in titles))
        chips = [c.replace('{opt}', f'{self.opt_no:02d}' if self.opt_no else '') for c in chips][:8]
        for k in range(8):
            rect, txt = by_id(s, 49 + 2 * k), by_id(s, 50 + 2 * k)
            if k < len(chips):
                runs = txt.text_frame.paragraphs[0].runs
                put(txt, ['+ ', chips[k]] + [''] * (len(runs) - 2))
            else:
                remove(rect); remove(txt)

    # ------------------------------------------------------------ options (accessories) page
    def options_page(self, s):
        """Copy of the configuration page: 3 x 3 cards with accessories (prices on request unless priced)."""
        accs = self.spec['accessories']
        put(by_id(s, 11), '// 07 — ДОДАТКОВІ ОПЦІЇ')
        put(by_id(s, 12), 'ДОДАЙТЕ', 'ПІД СВОЮ РОБОТУ.')
        P = {k: by_id(s, i) for k, i in (('rect', 13), ('pic', 14), ('label', 15), ('line', 18), ('title', 19), ('desc', 20))}
        for sh in list(s.shapes):
            if sh.shape_id > 12 and sh.shape_id not in (13, 14, 15, 18, 19, 20): remove(sh)
        gap = 0.11; cw = (7.37 - 2 * gap) / 3; ch = 2.62
        for n, a in enumerate(accs[:9]):
            x = 0.45 + (n % 3) * (cw + gap); y = 2.55 + (n // 3) * (ch + gap)
            geom(clone(s, P['rect']), x, y, cw, ch)
            grp = GROUPS.get(a['group'], a['group'].upper())
            lab = clone(s, P['label']); geom(lab, x + 0.14, y + 0.12, 1.5, 0.2); put(lab, f'{grp} · {n + 1:02d}')
            pr = clone(s, P['desc']); geom(pr, x + cw - 1.24, y + 0.1, 1.1, 0.22); put(pr, a['price_text'])
            pr.text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT; pr.name = f'fld_opt_price_{n + 1}'
            ph = clone(s, P['pic']); pw, phh = cw - 0.28, 1.3
            if a['photo'] and R.asset_ok(a['photo']):
                tw = CARD_TWEAKS.get(a['photo'], {})
                data = self.raster('card', lambda p, w, h, fx, fy, kt: R.jpg(R.card_photo(p, w, h, fx, fy, kt)),
                                   a['photo'], pw, phh, tw.get('fx', 0.5), tw.get('fy', 0.5), tw.get('key_t', R.KEY_T),
                                   assets=(a['photo'],))
                set_image(ph, data); geom(ph, x + 0.14, y + 0.4, pw, phh); ph.name = f'opt_photo_{n + 1}'
            else:
                remove(ph)
            ln = clone(s, P['line']); geom(ln, x + 0.14, y + 1.82, cw - 0.28, 0)
            tt = clone(s, P['title']); geom(tt, x + 0.14, y + 1.88, cw - 0.28, 0.25); put(tt, a['title']); tt.name = f'fld_opt_title_{n + 1}'
            if len(a['title']) > OPT_TITLE_CHARS:  # one line: shrink instead of running into the description
                r0 = tt.text_frame.paragraphs[0].runs[0]._r.get_or_add_rPr()
                set_size(tt, max(800, int(int(r0.get('sz') or 1100) * OPT_TITLE_CHARS / len(a['title']))))
            dd = clone(s, P['desc']); geom(dd, x + 0.14, y + 2.14, cw - 0.28, 0.45); put(dd, a['desc'])
        note = clone(s, P['desc']); geom(note, 0.45, 10.74, 7.37, 0.4)
        text = self.spec.get('accessories_note') or (NOTE_NPL if self.npl else NOTE_TRL if self.trl else NOTE_CRANE)
        if len(accs) > 9:
            text += ' Також на замовлення: ' + ', '.join(a['title'] for a in accs[9:]) + '.'
        put(note, text)
        for sh in P.values(): remove(sh)
        return s

    # ------------------------------------------------------------ price page
    def price_page(self):
        s = self.pages['price']; rows = self.spec['rows']; n = len(rows)
        row_ids = [(18, 19, 20, 21), (23, 24, 25, 26), (28, 29, 30, 31), (33, 34, 35, 36)]  # no, title+desc, qty, price
        conn_after = [22, 27, 32]
        box = by_id(s, 13); box_bottom = box.top + box.height
        lower = lambda sh: sh.name != 'bg' and (sh.shape_id in (37, 38, 39) or box_bottom - I(0.05) <= sh.top < I(28 * CM))
        if n < 4:
            up = by_id(s, 37).top - by_id(s, conn_after[n - 1]).top
            for sid in conn_after[n - 1:]: remove(by_id(s, sid))
            for ids in row_ids[n:]:
                for sid in ids: remove(by_id(s, sid))
            for sh in s.shapes:
                if lower(sh): sh.top -= up
            box.height -= up
        elif n > 4:
            pitch = max(0.36, 2.4 / n); wrap = 75 if n <= 8 else 80   # 9+ rows: smaller description type fits more per line
            hs = [pitch + (0.18 if len(r['desc'] or '') > wrap else 0) for r in rows]   # two-line descriptions get a taller row
            extra = I(sum(hs) - 2.4)
            if extra > 0:   # up to 0.25" comes out of the padding under the total, the rest moves the page down
                slack = min(extra, I(0.25))
                for sh in s.shapes:
                    if sh.shape_id in (37, 38, 39): sh.top += extra
                    elif lower(sh): sh.top += extra - slack
                box.height += extra - slack
            proto = [by_id(s, i) for i in row_ids[3]]; proto_c = by_id(s, 32)
            for k in range(4, n):
                ids = []
                for p in proto: ids.append(clone(s, p).shape_id)
                c = clone(s, proto_c); conn_after.append(c.shape_id)
                row_ids.append(tuple(ids))
            for k in range(n):
                y = 3.00 + sum(hs[:k])
                for sid, off in zip(row_ids[k], (0.09, 0.08, 0.09, 0.09)): by_id(s, sid).top = I(y + off)
                if k: by_id(s, conn_after[k - 1]).top = I(y)
        for k, row in enumerate(rows):
            no, td, qty, pr = (by_id(s, i) for i in row_ids[k])
            put(no, f"{int(row['no']):02d}" if str(row['no']).isdigit() else str(row['no']))
            put(td, row['title'], row['desc'] or ' ')
            put(qty, str(row['qty'])); put(pr, row['price_text'])
            if not row['desc']: td.text_frame.paragraphs[1].runs[0].text = ''
            elif n > 8: td.text_frame.paragraphs[1].runs[0].font.size = Pt(6.6)
        put(one(s, 'fld_total'), self.spec['total_text'])
        if len(self.spec['total_text']) > 14: set_size(one(s, 'fld_total'), int(4200 * 14 / len(self.spec['total_text'])))
        # chips under the price box
        mount = any(is_mounting(r) for r in rows)
        tags = self.spec.get('price_tags') or (['З УРАХУВАННЯМ ПДВ', 'ПАКЕТ ДЛЯ РЕЄСТРАЦІЇ'] if self.npl or self.trl
                                               else ['З УРАХУВАННЯМ ПДВ', 'МОНТАЖ ВХОДИТЬ'] if self.truck or mount else None)
        if tags:
            for sid, t in zip((41, 43), tags): put(by_id(s, sid), t.upper())
        put(one(s, 'fld_price_date'), f"ЦІНИ СТАНОМ НА {self.spec.get('price_date') or self.spec['date']}")
        if self.spec['valid_until']:
            r0, t0 = by_id(s, 44), one(s, 'fld_price_date')
            r1, t1 = clone(s, r0), clone(s, t0)
            for sh in (r1, t1): sh.left = r0.left + r0.width + I(0.10); sh.width = I(7.82) - sh.left
            put(t1, f"ДІЙСНА ДО {self.spec['valid_until']}"); t1.name = 'fld_valid_until'
        if self.spec['price_note']:
            put(by_id(s, 48), [None, self.spec['price_note']])
        self.price_terms(s)

    def price_terms(self, s):
        terms = self.spec['terms']; t = len(terms)
        if not t: return
        ids = [(51 + 4 * k, 52 + 4 * k, 53 + 4 * k) for k in range(5)]
        conns = [54, 58, 62, 66]
        if t < 5:
            for sid in conns[t - 1:]: remove(by_id(s, sid))
            for row in ids[t:]:
                for sid in row: remove(by_id(s, sid))
        elif t > 5:
            for k in range(5, t):
                ids.append(tuple(clone(s, by_id(s, i)).shape_id for i in ids[4]))
                conns.append(clone(s, by_id(s, 66)).shape_id)
        head = by_id(s, 50).top
        pitch = min(0.52, (I(11.15) - head) / EMU / max(t, 5))
        per_line = 85
        if not self.show['term']:   # no "T-01" numbers: titles and texts move left into their place, texts get wider
            for k in range(t):
                no, title, text = (by_id(s, i) for i in ids[k])
                d = title.left - no.left
                title.left -= d; text.left -= d; text.width += d
            per_line = int(85 * text.width / (text.width - d))
        lines = [max(2, -(-len(term['text']) // per_line)) for term in terms]   # ~85 characters per line of the term text
        if t <= 5 and max(lines) > 2:   # long terms (the truck KP's payment stages): rows as tall as their text
            y = head / EMU
            for k, n in enumerate(lines):
                for sid, off in zip(ids[k], (0.10, 0.10, 0.09)): by_id(s, sid).top = I(y + off)
                if k: by_id(s, conns[k - 1]).top = I(y)
                by_id(s, ids[k][2]).height = I(n * 0.155 + 0.05)
                y += max(0.52, n * 0.155 + 0.22)
        elif t > 5 or pitch < 0.52:
            for k in range(t):
                y = head / EMU + k * pitch
                for sid, off in zip(ids[k], (0.10, 0.10, 0.09)): by_id(s, sid).top = I(y + off)
                if k: by_id(s, conns[k - 1]).top = I(y)
        for k, term in enumerate(terms):
            no, title, text = (by_id(s, i) for i in ids[k])
            put(no, f"{self.L['term']}{k + 1:02d}"); no.name = 'term_no'; put(title, term['title'].upper()); put(text, term['text'])
            if pitch < 0.45: set_size(text, 750)

    # ------------------------------------------------------------ own production (НПЛ-10 kits)
    def own_production(self, seat_blob, s=None):
        truck = s is not None; s = s or self.pages['maker']; O = OWN_PRODUCTION
        put(by_id(s, 12), *O['headline'])
        put(by_id(s, 10), 'ГІДМАН · ВЛАСНЕ ВИРОБНИЦТВО' if truck else 'НПЛ-10 · ВЛАСНЕ ВИРОБНИЦТВО')
        if truck: put(by_id(s, 11), '// 08 — ВИРОБНИК ДООБЛАДНАННЯ · ' + self.spec['maker']['name'].upper())
        put(by_id(s, 23), ['● ', O['badge']])
        facts = O['truck_facts'] if truck else O['facts']
        for vid, (v, cap) in zip((27, 30, 33, 36, 39), facts):
            put(by_id(s, vid), v); put(by_id(s, vid + 1), cap)
        put(by_id(s, 41), ['“', O['quote']])
        put(by_id(s, 42), '// НАШІ ВИРОБИ')
        swap = {sid: (sid, path, fx, fy) for sid, path, fx, fy in (O['truck_photos'] if truck else ())}
        base = {p_[0] for p_ in O['photos']}
        for sid, path, fx, fy in [swap.get(p_[0], p_) for p_ in O['photos']] + [v for k, v in swap.items() if k not in base]:
            pic = by_id(s, sid); w, h = pic.width / EMU, pic.height / EMU
            set_image(pic, self.raster('graded', R.graded_photo, path, w, h, fx, fy, assets=(path,)))
        pic = by_id(s, O['seat_tile']); w, h = pic.width / EMU, pic.height / EMU  # operator seat, cut-out from KP_2_v3
        if O['seat_tile'] not in swap: set_image(pic, self.raster('seat', lambda b, w_, h_: R.jpg(R.on_card(R.cutout_glow(R.alpha_crop(Image.open(io.BytesIO(b))), a=60), w_, h_, 0.86)),
                                   seat_blob, w, h))
        for sid, path in (O['truck_gallery'] if truck else ()):   # the conversion's own products (the user's cut-outs) on cards
            pic = by_id(s, sid); w, h = pic.width / EMU, pic.height / EMU
            set_image(pic, self.raster('own_cut', lambda p, w_, h_: R.jpg(R.on_card(R.cutout_glow(R.alpha_crop(Image.open(R.asset(p))), a=60), w_, h_, 0.9)),
                                       path, w, h, assets=(path,)))

    def conversion_page(self, s):
        """Truck kits: copy of the manifest page about the conversion (the user's scheme, lead, 8 included items)."""
        from .ultra import conversion
        rows = self.spec['rows']; t = self.spec['title'].split(' + ')[0].strip()
        cv = conversion(rows, self.m(), self.cs, t, lambda k, d: d)
        put(by_id(s, 11), '// 01 — ДООБЛАДНАННЯ · ВЛАСНЕ ВИРОБНИЦТВО')
        put(by_id(s, 12), 'ЛІСОВОЗ', 'НА БАЗІ', f'{t.upper()}.')
        lead = cv['lead']; cut = lead.index(':')
        put(by_id(s, 13), lead[:cut] + '.')
        cd = cv['desc']
        put(by_id(s, 14), lead[cut + 2:cut + 3].upper() + lead[cut + 3:] + (f' У вартість дообладнання входять: {cd}.' if cd else ''))
        for sid, w in ((12, 3.3), (13, 3.25), (14, 3.25)): by_id(s, sid).width = I(w)   # the scheme takes the right half
        by_id(s, 14).height = I(2.2)
        bg = by_name(s, 'bg')[0]   # page background of the config page (no crane photo) + the scheme as a cut-out on the right
        set_image(bg, by_name(self.pages['config'], 'bg')[0].image.blob)
        sch = 'prod/truck_pyramid.png'
        data = self.raster('scheme', lambda p: R.png(R.cutout_glow(R.alpha_crop(Image.open(R.asset(p))), a=45)), sch, assets=(sch,))
        im = Image.open(io.BytesIO(data))
        pic = s.shapes.add_picture(io.BytesIO(data), I(3.7), I(1.35), I(4.2), I(4.2 * im.height / im.width))
        s.shapes._spTree.remove(pic._element); s.shapes._spTree.insert(3, pic._element)   # under the texts, over the background
        fit(pic, im, (I(3.85), I(1.3), I(4.0), I(3.55)))
        put(by_id(s, 16), ['4', ' шт'], 'стійки лісовозної платформи')
        put(by_id(s, 17), '// ЩО ВХОДИТЬ У ДООБЛАДНАННЯ')
        for k, (a, b) in enumerate(cv['tiles'][:8]):
            base = 19 + 5 * k
            put(by_id(s, base), f'{k + 1:02d}')
            title, desc = by_id(s, base + 2), by_id(s, base + 3)
            put(title, a); put(desc, b); title.width = I(1.62)
            if len(a) > 18: set_size(title, 760 if len(a) > 24 else 800 if len(a) > 22 else 900)
        return s

    # ------------------------------------------------------------ cover, end page, chrome
    def cover_page(self):
        s = self.pages['cover']; cs = self.cs; m = self.m()
        if self.npl or self.trl:
            D = self.tdata()
            put(by_id(s, 18), 'TIMBER TRAILER SYSTEM')
            put(by_id(s, 22), self.spec.get('cover_text') or D['cover_text'])
            kpi = D['cover_kpi'] + [('03 / ВИЛІТ', cs['reach_m'], '  м'), ('04 / МОМЕНТ', cs['torque_knm'], '  кНм')]
            for (kid, vid), (k, v, u) in zip(((25, 26), (29, 30), (33, 34), (37, 38)), kpi):
                put(by_id(s, kid), k); put(by_id(s, vid), [v, u])
            self.outline(s, D['outline'], 4.1 if self.panel else 7.35)
        else:
            lead = self.spec.get('cover_text') or (self.truck_cover()[1] if self.truck else self.crane_cover_text())
            put(by_id(s, 22), lead)
            if len(lead) > 140: by_id(s, 22).width = I(7.37)   # long lead: two full-width lines
            hl = self.spec.get('cover_headline') or (self.truck_cover()[0] if self.truck else None)
            if hl:   # two lines, white and orange; long ones get smaller type to stay on one line each
                hs = by_id(s, 21); put(hs, *hl[:2])
                longest = max(len(x) for x in hl[:2])   # ~0.0087" per character and point of the bold caps, 7.25" line
                if longest > 16: set_size(hs, max(2200, min(3600, int(7.25 / (0.0087 * longest)) * 100)))
            for vid, v in ((26, cs['reach_m']), (30, cs['torque_knm']), (34, cs['lift_4m_kg']), (38, cs['turn_deg'])):
                put(by_id(s, vid), [v, None])
            if not self.P.get('native'): self.outline(s, self.P['model_no'], 4.1 if self.panel else 7.35)
        if self.panel: self.panel_cover(s)
        else:
            bg = self.hero('cover', R.cover_bg)
            if bg: set_image(one(s, 'bg'), bg)
        cl = one(s, 'fld_client'); name = self.spec['client']['name'] or 'Назва замовника'
        lines = ['ПІДГОТОВЛЕНО ДЛЯ', name] + ([self.spec['client']['contact']] if self.spec['client']['contact'] else [])
        set_lines(cl, lines)
        if len(name) > 34: cl.text_frame.paragraphs[1].runs[0]._r.get_or_add_rPr().set('sz', str(max(900, int(1300 * 34 / len(name)))))
        if len(lines) > 2:
            r = cl.text_frame.paragraphs[2].runs[0]._r.get_or_add_rPr(); r.set('sz', '900'); r.set('b', '0')
            cl.height = I(0.62)

    def panel_cover(self, s):
        """Light design with the orange panel: crane (or trailer) cut-out over the panel, short spec list on the right."""
        cs = self.cs
        for i, v in enumerate((self.sp('pressure_bar'), self.sp('pump_lpm'), self.sp('slew_knm'), self.sp('weight_kg')), 1):
            f = by_name(s, f'fld_cover_spec_{i}')
            if f: put(f[0], v)
        chip = [sh for sh in s.shapes if sh.has_text_frame and sh.text_frame.text.startswith('ВИРОБНИЦТВО')]
        if chip and self.npl: put(chip[0], 'УКРАЇНА · ЕСТОНІЯ')
        hero = by_name(s, 'hero_crane')
        if not hero: return
        hero = hero[0]
        if self.npl or self.trl:
            path = self.T['cutout'] if self.trl else NPL10['cutout']
            data = self.raster('cutout', lambda p: R.png(R.alpha_crop(Image.open(R.asset(p)))), path, assets=(path,))
        elif not self.P.get('native'):
            data = R.png(R.alpha_crop(Image.open(io.BytesIO(self.crane_blob))))
        else:
            return
        set_image(hero, data); fit(hero, Image.open(io.BytesIO(data)))

    def crane_cover_text(self):
        parts = []
        for r in self.spec['rows']:
            iid = (r.get('item_id') or '').lower()
            if iid.startswith('base_outriggers'): parts.append('платформою, аутригерами')
            elif iid.startswith('tank'): parts.append('баком')
            elif iid.startswith('seat'): parts.append('місцем оператора')
            elif iid.startswith('truck_pyramid'): parts.append('пірамідою з аутригерами')
            elif iid == 'pump': parts.append('насосом')
            elif iid.startswith('oil'): parts.append('оливою')
            elif is_mounting(r): parts.append('монтажем')
        parts = list(dict.fromkeys(parts))
        text = f'Гідравлічний кран-маніпулятор {self.m()} з ротатором і захватом'
        if self.truck:
            text = f"{self.spec['rows'][0]['title']} з краном-маніпулятором {self.m()}, ротатором і захватом"
            return text + (', ' + ', '.join(parts[:-1]) + ' і ' + parts[-1] if len(parts) > 1 else f', {parts[0]}' if parts else '') + '.'
        if parts:
            text += ' — повний комплект з ' + (', '.join(parts[:-1]) + ' і ' + parts[-1] if len(parts) > 1 else parts[0])
        return text + '.'

    def truck_cover(self):
        """Truck kits: cover headline and lead as approved in the ЗІЛ KP of 22.10.2026."""
        t = self.spec['title'].split(' + ')[0].strip(); m = self.m(); cs = self.cs
        return ([f'ДООБЛАДНАННЯ АВТОМОБІЛЯ {t.upper()}', f'+ КРАН-МАНІПУЛЯТОР {m.upper()}'],
                f'Лісовоз з краном {m} · ротатор {cs["rotator_t"]}\u00a0т і грейфер {cs["grapple_m2"]}\u00a0м² у комплекті: '
                f'дообладнання вантажівки {t} в транспортний засіб (лісовоз-сортиментовоз), який призначений для перевезення '
                f'колод, брусів під ключ.')

    def outline(self, s, text, max_w_in, cap=2.45):
        o = one(s, 'model_outline')
        big = Image.open(io.BytesIO(self.raster('outline', lambda t, c: R.png(R.outline_text(t, c, stroke=6)), text, cap)))
        w, h = big.width / R.DPI, big.height / R.DPI
        if w > max_w_in: h *= max_w_in / w; w = max_w_in
        bottom = o.top + o.height
        set_image(o, R.png(big)); o.width, o.height = I(w), I(h); o.top = bottom - I(h)

    def end_page(self):
        s = self.pages['end']; ct = self.spec['contacts']
        bg = self.hero('end', R.end_bg)
        if bg: set_image(one(s, 'bg'), bg)
        if ct['phones']: set_lines(one(s, 'fld_contact_0'), ct['phones'][:3])
        if ct['email']: set_lines(one(s, 'fld_contact_1'), [ct['email']])
        if ct['sites']: set_lines(one(s, 'fld_contact_2'), ct['sites'][:3])
        if ct['address']:
            a = ct['address']
            if '\n' in a: lines = a.split('\n')
            else:
                p = [x.strip() for x in a.split(',')]
                lines = [', '.join(p[:2]), ', '.join(p[2:])] if len(p) > 2 else [a]
            set_lines(one(s, 'fld_contact_3'), lines[:3])
        if ct.get('socials'): set_lines(one(s, 'fld_contact_4'), ct['socials'][:3])
        put(by_id(s, 47), f"Офіційний дистриб’ютор BMF в Україні  ·  {self.spec['maker']['line']}")

    def chrome(self):
        S = list(self.prs.slides); n = len(S); sp = self.spec; ct = sp['contacts']
        footer = (self.L['footer'].replace('{сайт}', ct['sites'][0].upper() if ct['sites'] else '')
                  .replace('{телефон}', ct['phones'][0] if ct['phones'] else '').strip(' ·')) if ct['sites'] or ct['phones'] else None
        tags = {}
        if self.npl or self.trl:
            tags = {self.pages[k].slide_id: t for k, t in (('manifest', 'КРАН-МАНІПУЛЯТОР'), ('anatomy', 'КОНСТРУКЦІЯ'),
                    ('passport', 'ТЕХНІЧНИЙ ПАСПОРТ КРАНА'), ('config', 'КОНФІГУРАЦІЯ'), ('price', 'ВАРТІСТЬ'),
                    ('maker', 'ВЛАСНЕ ВИРОБНИЦТВО' if self.npl else 'ВИРОБНИК'))}
        kit = self.npl or self.trl   # section names the admin changed
        sec = dict(manifest='sec_crane_in_kit' if kit else 'sec_manifest', anatomy='sec_anatomy',
                   passport='sec_passport_in_kit' if kit else 'sec_passport', config='sec_config', price='sec_price',
                   maker='sec_own' if self.npl else 'sec_maker', trailer='sec_trailer_npl' if self.npl else 'sec_trailer',
                   trailer_spec='sec_trailer_spec')
        for k, lk in sec.items():
            if k in self.pages and lk in self.Lset: tags[self.pages[k].slide_id] = self.L[lk]
        if self.options and 'sec_options' in self.Lset: tags[self.options.slide_id] = self.L['sec_options']
        for i, s in enumerate(S, 1):
            for sh in s.shapes:
                if sh.name == 'fld_kp_header': put(sh, [None, f"№ {sp['number']}", f"  //  {sp['title']}  //  ", sp['date']])
                if sh.name == 'fld_kp_cover': put(sh, None, f"№ {sp['number']}  ·  {sp['date']}")
                if not sh.has_text_frame: continue
                t = sh.text_frame.text
                # page numbers follow the slide order (duplicated pages carry the template's number)
                if i > 1 and len(sh.text_frame.paragraphs[0].runs) == 2 and re.fullmatch(r'\d\d / \d\d', t):
                    put(sh, [f'{i:02d}', f' / {n:02d}'])
                if footer and t.startswith('BMF.RV.UA  ·  '): put(sh, footer); sh.name = 'footer_site'
                # section tags "// NN — ..." follow the page number too
                if sh.shape_id == 11 and 1 < i < n and re.match(r'// \d\d — ', t):
                    put(sh, f"// {i - 1:02d} — {tags.get(s.slide_id, t[8:])}")

    # ------------------------------------------------------------ admin «Написи й елементи»
    def layout(self):
        L, show, Ls = self.L, self.show, self.Lset
        drop = lambda sh: sh is not None and remove(sh)
        def find(s, sid):
            try: return by_id(s, sid)
            except KeyError: return None
        s = self.pages['cover']
        kp = by_name(s, 'fld_kp_cover')
        if kp:
            if 'kp_title' in Ls: put(kp[0], L['kp_title'])
            parts = ([f"№ {self.spec['number']}"] if show['kp_no'] else []) + ([self.spec['date']] if show['kp_date'] else [])
            if not parts: set_lines(kp[0], [kp[0].text_frame.paragraphs[0].text])
            else: put(kp[0], None, '  ·  '.join(parts))
        kick = find(s, 18)
        if kick is not None:
            k = 'cover_kicker_trailer' if self.npl or self.trl else 'cover_kicker'
            if k in Ls: put(kick, L[k])
        cl = by_name(s, 'fld_client')
        if cl:
            if not show['client']:
                drop(cl[0])
                if not self.panel:   # the headline, lead and KPI cards move down into the client's place
                    for sid in [21, 22] + list(range(23, 39)):
                        sh = find(s, sid)
                        if sh is not None: sh.top += I(0.55)
            elif 'client_label' in Ls: put(cl[0], L['client_label'])
        if not show['frames']:
            for sid in range(43, 51): drop(find(s, sid))
        lab = find(s, 16)
        if lab is not None and lab.has_text_frame and len(lab.text_frame.paragraphs) == 2:   # the TARGET LOCKED sight
            if not show['sight']:
                for sid in range(5, 17): drop(find(s, sid))
            else:
                if 'sight_title' in Ls: put(lab, L['sight_title'])
                box = self.sights.get(self.cover_key) or self.sights.get('*') or SIGHTS.get(self.cover_key)
                if box: self.sight(s, box)
        for page in self.prs.slides:
            for sh in list(page.shapes):
                if not sh.has_text_frame: continue
                t = sh.text_frame.text
                if sh.name == 'footer_site' or (sh.shape_id == 9 and t.startswith('BMF.RV.UA')):
                    if not show['footer']: drop(sh)
                elif sh.shape_id == 10 and sh.top > I(11):
                    if not show['footer_label']: drop(sh)
                    elif t == LAYOUT_TEXTS['footer_label']:   # the price page is signed with its own subject
                        if 'price' in self.pages and page.slide_id == self.pages['price'].slide_id: put(sh, L['footer_label_price'])
                        elif 'footer_label' in Ls: put(sh, L['footer_label'])
                elif sh.name == 'module_label':
                    if not show['module']: drop(sh)
                elif sh.name == 'term_no' and not show['term']: drop(sh)
                elif t == LAYOUT_TEXTS['anatomy_note'] and 'anatomy_note' in Ls: put(sh, L['anatomy_note'])
        mk = self.pages['maker']
        badge, gal = find(mk, 23), find(mk, 42)
        bk, gk = ('own_badge', 'own_gallery') if self.npl else ('maker_badge', 'maker_gallery')
        if badge is not None and bk in Ls: put(badge, ['● ', L[bk]])
        if gal is not None and gk in Ls: put(gal, L[gk])
        e = self.pages['end']
        for sh in e.shapes:
            if not sh.has_text_frame: continue
            for k in ('lbl_phone', 'lbl_email', 'lbl_site', 'lbl_address', 'lbl_socials', 'lbl_production'):
                if sh.text_frame.text == LAYOUT_TEXTS[k] and k in Ls: put(sh, L[k])
        prod = by_name(e, 'fld_contact_5')
        if prod and 'production' in Ls: set_lines(prod[0], L['production'].split('\n')[:3])

    def sight(self, s, box):
        """Sight frame moved/resized by the admin: corners follow the frame, the centre ring keeps its size,
        the TARGET LOCKED label sits right of the frame (left when the page edge is too close)."""
        try: x, y, w, h = (float(box[k]) for k in ('x', 'y', 'w', 'h'))
        except (KeyError, TypeError, ValueError): return
        w, h = max(0.4, min(w, PAGE_W - 0.4)), max(0.4, min(h, PAGE_H - 0.4))
        x, y = max(0.2, min(x, PAGE_W - 0.2 - w)), max(0.2, min(y, PAGE_H - 0.2 - h))
        a = min(0.2, w / 3, h / 3)
        lines = {5: (x, y, a, 0), 6: (x, y, 0, a), 7: (x + w - a, y, a, 0), 8: (x + w, y, 0, a),
                 9: (x, y + h, a, 0), 10: (x, y + h - a, 0, a), 11: (x + w - a, y + h, a, 0), 12: (x + w, y + h - a, 0, a)}
        for sid, g in lines.items(): geom(by_id(s, sid), *g)
        ring = by_id(s, 13); d = ring.width / EMU
        geom(ring, x + w / 2 - d / 2, y + h / 2 - d / 2, d, d)
        lead, rect, txt = by_id(s, 14), by_id(s, 15), by_id(s, 16)
        rw, rh, ll = rect.width / EMU, rect.height / EMU, 0.25
        ly = max(0.2, min(y + 0.02, PAGE_H - 0.2 - rh))
        if x + w + ll + rw <= PAGE_W - 0.2: lx, cx = x + w + ll, x + w
        else: lx, cx = max(0.2, x - ll - rw), x - ll
        geom(lead, cx, ly + 0.23, ll, 0)
        dx, dy = txt.left / EMU - rect.left / EMU, txt.top / EMU - rect.top / EMU
        geom(rect, lx, ly, rw, rh); txt.left, txt.top = I(lx + dx), I(ly + dy)
