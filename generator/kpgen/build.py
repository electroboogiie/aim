# KP_2_v3 engine: the user's approved KP (templates/KP_2_v3.pptx, BMF 720 kit, 8 pages) is the
# template. Layout, fonts, colours and HUD labels stay; content comes from a KpSpec.
# НПЛ-10 kits get two trailer pages (duplicated from the crane pages) and the own-production page;
# accessories add an options page after the configuration page.
import copy, io, os, re
from PIL import Image
from pptx import Presentation
from pptx.enum.text import PP_ALIGN

from . import raster as R
from .cache import Cache
from .profiles import (PROFILES, TEMPLATE_720, PHOTO_FOCUS, CARD_TWEAKS, TEMPLATE_TILES, NPL10, OWN_PRODUCTION,
                       DECAL_ANATOMY, DECAL_CONFIG, chart_for)
from .pptx_util import (EMU, I, by_id, by_name, one, remove, put, set_lines, set_image, fit, geom, clone, dup_slide,
                        dim_box, set_size, prune_images)

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.normpath(os.path.join(HERE, '..', 'templates', 'KP_2_v3.pptx'))
CM = 1 / 2.54

GROUPS = {'crane': 'ДЛЯ КРАНА', 'trailer': 'ДЛЯ ПРИЧЕПА'}
NPL_CHIPS = ['Гальма на вибір', 'Колеса 400/60-15.5', 'Колеса 500/50-17', 'Колеса 550/45-22.5',
             'Кількість коників', 'Колір на замовлення', 'Опції для крана: с. {opt}', 'Опції для причепа: с. {opt}']
OPT_TITLE_CHARS = 22
NOTE_CRANE = ('Аксесуари з каталогів BMF (bmf.rv.ua, bmf.ee), сумісні з краном комплекту. Ціни — за запитом: '
              'обрані опції додаємо в КП окремими рядками.')
NOTE_NPL = ('Аксесуари з каталогів BMF (bmf.rv.ua, bmf.ee) для кранів і причепів, сумісні з краном комплекту. Ціни — за запитом: '
            'обрані опції додаємо в КП окремими рядками. Сумісність опцій для причепа з НПЛ-10 підтверджуємо під замовлення.')


def plural(n, one_, few, many):
    nums = re.findall(r'\d+', str(n))   # "2/4" agrees with the last number
    if not nums: return many
    n = int(nums[-1])
    if n % 10 == 1 and n % 100 != 11: return one_
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14: return few
    return many


class Engine:
    def __init__(self, spec, build_dir):
        self.spec = spec
        self.c = spec['crane']; self.cs = self.c['specs']
        self.P = PROFILES[self.c['profile']]
        self.npl = spec['npl'] is not None
        self.kit = 'npl_crane' if self.npl else 'crane_kit'
        self.cache = Cache(build_dir)

    # ------------------------------------------------------------ helpers
    def sp(self, k, default='—'):
        return self.cs.get(k) or default

    def m(self): return self.c['model']

    def kit_line(self):
        return f"у комплекті з ротатором {self.cs['rotator_t']} т і захватом {self.cs['grapple_m2']} м²"

    def raster(self, kind, fn, *args, assets=()):
        return self.cache.get(kind, fn, args, assets)

    def hero(self, which, maker):
        """Photo for the cover / end page: spec.photos, else the profile default; None keeps the template's."""
        path = self.spec['photos'].get(which)
        if path:
            fx, fy = self.spec['photos'].get(which + '_focus') or PHOTO_FOCUS.get(path) or ((0.5, 0.42) if which == 'cover' else (0.5, 0.5))
        else:
            d = self.P[which][self.kit]
            if d is None: return None
            path, fx, fy = d
        return self.raster(which + '_bg', maker, path, fx, fy, assets=(path,))

    # ------------------------------------------------------------ build
    def build(self):
        prs = Presentation(TEMPLATE)
        self.prs = prs
        cover, manifest, anatomy, passport, config, price, maker, end = list(prs.slides)
        self.pages = dict(cover=cover, manifest=manifest, anatomy=anatomy, passport=passport, config=config,
                          price=price, maker=maker, end=end)
        self.crane_pages()
        seat_blob = by_id(config, 37).image.blob
        crane_blob = by_id(config, 14).image.blob
        if self.npl: self.trailer_pages()
        self.options = None
        if self.spec['accessories']:
            idx = list(prs.slides).index(config) + 1
            self.options = self.options_page(dup_slide(prs, config, idx))
        self.opt_no = list(prs.slides).index(self.options) + 1 if self.options else None
        self.config_page(crane_blob)
        self.price_page()
        if self.npl: self.own_production(seat_blob)
        self.cover_page()
        self.end_page()
        self.chrome()
        prune_images(prs)
        return prs

    # ------------------------------------------------------------ crane pages (template slides 1-5)
    def crane_pages(self):
        pg, c, cs, P, m = self.pages, self.c, self.cs, self.P, self.m()
        native = P.get('native')
        # 01 cover tag
        tag = f"НПЛ-10 · 10 Т · {m}" if self.npl else f"{m} · {cs['reach_m']} M · {cs['torque_knm']} KNM"
        put(by_id(pg['cover'], 16), None, tag)
        # 02 crane manifest
        s = pg['manifest']
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
            set_image(pic, self.raster('decal', lambda b: R.png(R.redecal(Image.open(io.BytesIO(b)), DECAL_CONFIG, P['model_no'])),
                                       pic.image.blob))

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
        for sid, box, labels, erase in ((85, D['side'], fill(D['side_labels']), ()), (88, D['fold'], fill(D['fold_labels']), D.get('fold_erase', ()))):
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
        set_image(crane, self.raster('decal', lambda b: R.png(R.redecal(Image.open(io.BytesIO(b)), DECAL_ANATOMY, P['model_no'])),
                                     crane.image.blob))

    def passport(self, s):
        P, cs = self.P, self.cs; native = P.get('native')
        b4, c4, l4 = by_id(s, 39), by_id(s, 40), by_id(s, 41)
        bf, cf, lf = by_id(s, 42), by_id(s, 43), by_id(s, 44)
        same = all(cs[k] == TEMPLATE_720[k] for k in TEMPLATE_720)
        if not same:
            # load-by-reach bars: 4 m and full reach, heights proportional to the user's 1100 kg bar
            k = b4.height / 1100
            bottom = b4.top + b4.height
            for bar, cap, lab, kg in ((b4, c4, l4, int(cs['lift_4m_kg'])), (bf, cf, lf, int(cs['lift_full_kg']))):
                dy = bottom - int(k * kg) - bar.top
                bar.top += dy; bar.height = int(k * kg); cap.top += dy; lab.top += dy
                put(lab, [str(kg), None, None])
            gx, gw = 0.75, 6.9
            xr = I(gx + gw * float(cs['reach_m'].replace(',', '.')) / 7.5)
            dx = xr - (bf.left + bf.width // 2)
            for sh in (bf, cf, lf): sh.left += dx
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
            gx, gw = 0.75, 6.9
            axis_y = 2.95 + 1.5
            in_per_px = (gw * D['tip_m'] / 7.5) / (TIP - PIV)
            set_image(dr, data)
            dr.width = I(gsize[0] * in_per_px); dr.height = I(gsize[1] * in_per_px)
            dr.left = I(gx - (PIV - bb[0] + padg) * in_per_px)
            dr.top = I(axis_y - (BASE_Y - bb[1] + padg) * in_per_px)
        vals = [cs['reach_m'], cs['torque_knm'], cs['lift_4m_kg'], cs['lift_full_kg'], cs['grapple_m2'], cs['rotator_t'],
                self.sp('valve'), self.sp('slew_knm'), self.sp('slew_cyl'), cs['turn_deg'], self.sp('pressure_bar'),
                self.sp('pump_lpm'), self.sp('telescope'), self.sp('legs'), self.sp('weight_kg')]
        for i, v in enumerate(vals, 1): put(one(s, f'fld_spec_{i:02d}'), v)
        put(by_id(s, 80), self.flow())   # unit of row 07
        put(by_id(s, 118), f"* без захвату і ротатора. Дані виробника, bmf.ee. Вага {self.sp('weight_kg')} кг — без опори, захвату і ротатора.")

    # ------------------------------------------------------------ НПЛ-10 trailer pages
    def trailer_pages(self):
        prs, pg, npl = self.prs, self.pages, self.spec['npl']
        stakes = npl['stakes']
        stakes_text = f"{stakes} {plural(stakes, 'коник', 'коники', 'коників')}"
        fmtv = dict(wheels=npl['wheels'], stakes=stakes, stakes_text=stakes_text, brakes=npl['brakes'])
        t1 = dup_slide(prs, pg['manifest'], 1)
        t2 = dup_slide(prs, pg['passport'], 2)
        self.pages.update(trailer=t1, trailer_spec=t2)
        s = t1
        put(by_id(s, 11), '// 01 — НАПІВПРИЧІП')
        put(by_id(s, 12), 'ВЕЗЕ ЛІС ТАМ,', 'ДЕ ДОРОГИ', 'ЗАКІНЧУЮТЬСЯ.')
        put(by_id(s, 13), npl['lead'] or NPL10['lead'])
        put(by_id(s, 14), npl['lead2'] or NPL10['lead2'])
        put(by_id(s, 16), ['10 000', ' кг'], 'вантажопідйомність · об’єм 10 м³')
        for n, (t, d) in enumerate(NPL10['tiles']):
            put(by_id(s, 21 + n * 5), t.format(**fmtv)); put(by_id(s, 22 + n * 5), d)
        put(by_id(s, 10), 'ЛІСОВОЗ НПЛ-10')
        path, fx, fy = NPL10['p2_photo']
        set_image(one(s, 'bg'), self.raster('side_bg', R.side_bg, path, fx, fy, assets=(path,)))

        s = t2
        put(by_id(s, 11), '// 02 — ГАБАРИТИ ТА ХАРАКТЕРИСТИКИ')
        put(by_id(s, 12), 'МІЦНИЙ', 'НА 10 ТОНН.')
        put(by_id(s, 13), 'ГАБАРИТНІ РОЗМІРИ, ММ*'); by_id(s, 13).left, by_id(s, 13).top = I(0.45), I(2.6)
        put(by_id(s, 47), 'ДОВЖИНА 6950 · ШИРИНА 2412 · ВИСОТА 2789')
        for sid in range(14, 45): remove(by_id(s, sid))
        dr = by_name(s, 'crane_side_drawing')[0]
        art = lambda path, rot: self.raster('line_art', lambda p, r: R.png(R.line_art(p, r)), path, rot, assets=(path,))
        side_b, front_b = art(NPL10['side'], -90), art(NPL10['front'], 0)
        side, front = Image.open(io.BytesIO(side_b)), Image.open(io.BytesIO(front_b))
        y0, hh = I(2.85), I(1.95)
        set_image(dr, side_b); dr.name = 'npl_side_drawing'
        fit(dr, side, (I(0.45), y0, I(4.6), hh))
        fp = s.shapes.add_picture(io.BytesIO(front_b), 0, 0); fp.name = 'npl_front_drawing'
        fit(fp, front, (I(5.25), y0, I(2.57), hh))
        labels = [by_id(s, i) for i in (51, 55, 60, 64, 69, 73, 78, 82, 87, 91, 96, 100, 105, 109, 114)]
        units = [by_id(s, i) for i in (53, 57, 62, 66, 71, 75, 80, 84, 89, 93, 98, 102, 107, 111, 116)]
        for i, (lab, (k, v, u)) in enumerate(zip(labels, NPL10['spec_rows']), 1):
            put(lab, k.format(**fmtv)); put(one(s, f'fld_spec_{i:02d}'), v.format(**fmtv))
            if units[i - 1].text_frame.paragraphs[0].runs: put(units[i - 1], u)
            else: units[i - 1].text_frame.paragraphs[0].text = u
        put(by_id(s, 118), NPL10['drawing_note'])
        put(by_id(s, 10), 'ЛІСОВОЗ НПЛ-10')

    # ------------------------------------------------------------ configuration page
    def tile_image(self, row, crane_blob):
        """(template shape id or None, PIL image or None, encoded bytes or None) for the row's tile."""
        iid = (row.get('item_id') or '').lower(); kind = row.get('kind')
        if kind == 'crane' or (not kind and iid == (self.c.get('id') or '').lower()):
            return 14, Image.open(io.BytesIO(crane_blob)), crane_blob
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
        s = self.pages['config']; rows = self.spec['rows']; n = len(rows)
        slots = {'TL': (13, 14, 15, 18, 19, 20, 21), 'TR': (36, 37, 38, 39, 40, 41, 42),
                 'BL': (22, 23, 24, 25, 26, 27, 28), 'BR': (29, 30, 31, 32, 33, 34, 35)}
        sh = lambda sid: by_id(s, sid)
        imgs = [self.tile_image(r, crane_blob) for r in rows]

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

        def relabel(slot, k): put(sh(slot[2]), f'МОДУЛЬ {k:02d}')

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
        else:
            self.grid_tiles(s, slots, rows, imgs)
        self.config_chips(s)

    def grid_tiles(self, s, slots, rows, imgs):
        """5-8 positions: 3 columns of smaller tiles cloned from the first tile."""
        n = len(rows); cols = 3; nrows = (n + cols - 1) // cols
        gap = 0.11; x0, y0, tw_all, th_all = 0.45, 2.55, 7.37, 5.67
        tw = (tw_all - gap * (cols - 1)) / cols; th = (th_all - gap * (nrows - 1)) / nrows
        proto = [by_id(s, i) for i in slots['TL']]
        for i, (row, (keep, im, data)) in enumerate(zip(rows, imgs)):
            x = x0 + (i % cols) * (tw + gap); y = y0 + (i // cols) * (th + gap)
            rect, pic, label, line, title, desc, price = (clone(s, p) for p in proto)
            geom(rect, x, y, tw, th)
            geom(label, x + 0.16, y + 0.14, 1.6, 0.2); put(label, f'МОДУЛЬ {i + 1:02d}')
            ph = th - 1.35
            geom(line, x + 0.16, y + th - 0.88, tw - 0.32, 0)
            geom(title, x + 0.16, y + th - 0.81, tw - 0.32, 0.22); put(title, row['title']); set_size(title, 950)
            geom(desc, x + 0.16, y + th - 0.57, tw - 0.32, 0.3); put(desc, row['desc']); set_size(desc, 700)
            geom(price, x + 0.16, y + th - 0.30, tw - 0.32, 0.24); put(price, row['price_text']); set_size(price, 1100)
            if im is None: remove(pic)
            else:
                if keep != proto[1].shape_id: set_image(pic, self.encoded(im, data))
                fit(pic, im, (I(x + 0.16), I(y + 0.36), I(tw - 0.32), I(ph - 0.1)))
        for slot in slots.values():
            for i in slot: remove(by_id(s, i))

    def config_chips(self, s):
        """'+ ОПЦІЇ ДЛЯ АПГРЕЙДУ' chips: spec.upgrade_chips, else the template's / the НПЛ-10 list."""
        chips = self.spec.get('upgrade_chips')
        titles = ' '.join(r['title'].lower() for r in self.spec['rows'])
        if chips is None and self.npl:
            chips = [c for c in NPL_CHIPS if self.opt_no or '{opt}' not in c]
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
        text = self.spec.get('accessories_note') or (NOTE_NPL if self.npl else NOTE_CRANE)
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
            pitch = max(0.34, 2.4 / n); extra = I(n * pitch - 2.4)
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
                y = 3.00 + k * pitch
                for sid, off in zip(row_ids[k], (0.09, 0.08, 0.09, 0.09)): by_id(s, sid).top = I(y + off)
                if k: by_id(s, conn_after[k - 1]).top = I(y)
        for k, row in enumerate(rows):
            no, td, qty, pr = (by_id(s, i) for i in row_ids[k])
            put(no, f"{int(row['no']):02d}" if str(row['no']).isdigit() else str(row['no']))
            put(td, row['title'], row['desc'] or ' ')
            put(qty, str(row['qty'])); put(pr, row['price_text'])
            if not row['desc']: td.text_frame.paragraphs[1].runs[0].text = ''
        put(one(s, 'fld_total'), self.spec['total_text'])
        if len(self.spec['total_text']) > 14: set_size(one(s, 'fld_total'), int(4200 * 14 / len(self.spec['total_text'])))
        # chips under the price box
        tags = self.spec.get('price_tags') or (['З УРАХУВАННЯМ ПДВ', 'ПАКЕТ ДЛЯ РЕЄСТРАЦІЇ'] if self.npl else None)
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
        if t > 5 or pitch < 0.52:
            for k in range(t):
                y = head / EMU + k * pitch
                for sid, off in zip(ids[k], (0.10, 0.10, 0.09)): by_id(s, sid).top = I(y + off)
                if k: by_id(s, conns[k - 1]).top = I(y)
        for k, term in enumerate(terms):
            no, title, text = (by_id(s, i) for i in ids[k])
            put(no, f'T-{k + 1:02d}'); put(title, term['title'].upper()); put(text, term['text'])
            if pitch < 0.45: set_size(text, 750)

    # ------------------------------------------------------------ own production (НПЛ-10 kits)
    def own_production(self, seat_blob):
        s = self.pages['maker']; O = OWN_PRODUCTION
        put(by_id(s, 12), *O['headline'])
        put(by_id(s, 10), 'НПЛ-10 · ВЛАСНЕ ВИРОБНИЦТВО')
        put(by_id(s, 23), ['● ', O['badge']])
        for vid, (v, cap) in zip((27, 30, 33, 36, 39), O['facts']):
            put(by_id(s, vid), v); put(by_id(s, vid + 1), cap)
        put(by_id(s, 41), ['“', O['quote']])
        put(by_id(s, 42), '// НАШІ ВИРОБИ')
        for sid, path, fx, fy in O['photos']:
            pic = by_id(s, sid); w, h = pic.width / EMU, pic.height / EMU
            set_image(pic, self.raster('graded', R.graded_photo, path, w, h, fx, fy, assets=(path,)))
        pic = by_id(s, O['seat_tile']); w, h = pic.width / EMU, pic.height / EMU  # operator seat, cut-out from KP_2_v3
        set_image(pic, self.raster('seat', lambda b, w_, h_: R.jpg(R.on_card(R.cutout_glow(R.alpha_crop(Image.open(io.BytesIO(b))), a=60), w_, h_, 0.86)),
                                   seat_blob, w, h))

    # ------------------------------------------------------------ cover, end page, chrome
    def cover_page(self):
        s = self.pages['cover']; cs = self.cs; m = self.m()
        if self.npl:
            put(by_id(s, 18), 'TIMBER TRAILER SYSTEM')
            put(by_id(s, 22), self.spec.get('cover_text') or
                f'Напівпричіп-лісовоз НПЛ-10 власного виробництва з краном-маніпулятором {m}, ротатором і захватом — комплект для навантаження й вивезення деревини.')
            kpi = NPL10['cover_kpi'] + [('03 / ВИЛІТ', cs['reach_m'], '  м'), ('04 / МОМЕНТ', cs['torque_knm'], '  кНм')]
            for (kid, vid), (k, v, u) in zip(((25, 26), (29, 30), (33, 34), (37, 38)), kpi):
                put(by_id(s, kid), k); put(by_id(s, vid), [v, u])
            self.outline(s, 'НПЛ-10', 7.35)
        else:
            put(by_id(s, 22), self.spec.get('cover_text') or self.crane_cover_text())
            for vid, v in ((26, cs['reach_m']), (30, cs['torque_knm']), (34, cs['lift_4m_kg']), (38, cs['turn_deg'])):
                put(by_id(s, vid), [v, None])
            if not self.P.get('native'): self.outline(s, self.P['model_no'], 7.35)
        bg = self.hero('cover', R.cover_bg)
        if bg: set_image(one(s, 'bg'), bg)
        cl = one(s, 'fld_client'); name = self.spec['client']['name'] or 'Назва замовника'
        lines = ['ПІДГОТОВЛЕНО ДЛЯ', name] + ([self.spec['client']['contact']] if self.spec['client']['contact'] else [])
        set_lines(cl, lines)
        if len(name) > 34: cl.text_frame.paragraphs[1].runs[0]._r.get_or_add_rPr().set('sz', str(max(900, int(1300 * 34 / len(name)))))
        if len(lines) > 2:
            r = cl.text_frame.paragraphs[2].runs[0]._r.get_or_add_rPr(); r.set('sz', '900'); r.set('b', '0')
            cl.height = I(0.62)

    def crane_cover_text(self):
        parts = []
        for r in self.spec['rows']:
            iid = (r.get('item_id') or '').lower()
            if iid.startswith('base_outriggers'): parts.append('платформою, аутригерами')
            elif iid.startswith('tank'): parts.append('баком')
            elif iid.startswith('seat'): parts.append('місцем оператора')
        parts = list(dict.fromkeys(parts))
        text = f'Гідравлічний кран-маніпулятор {self.m()} з ротатором і захватом'
        if parts:
            text += ' — повний комплект з ' + (', '.join(parts[:-1]) + ' і ' + parts[-1] if len(parts) > 1 else parts[0])
        return text + '.'

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
        footer = f"{ct['sites'][0].upper()}  ·  {ct['phones'][0]}" if ct['sites'] and ct['phones'] else None
        tags = {}
        if self.npl:
            tags = {self.pages[k].slide_id: t for k, t in (('manifest', 'КРАН-МАНІПУЛЯТОР'), ('anatomy', 'КОНСТРУКЦІЯ'),
                    ('passport', 'ТЕХНІЧНИЙ ПАСПОРТ КРАНА'), ('config', 'КОНФІГУРАЦІЯ'), ('price', 'ВАРТІСТЬ'),
                    ('maker', 'ВЛАСНЕ ВИРОБНИЦТВО'))}
        for i, s in enumerate(S, 1):
            for sh in s.shapes:
                if sh.name == 'fld_kp_header': put(sh, [None, f"№ {sp['number']}", f"  //  {sp['title']}  //  ", sp['date']])
                if sh.name == 'fld_kp_cover': put(sh, None, f"№ {sp['number']}  ·  {sp['date']}")
                if not sh.has_text_frame: continue
                t = sh.text_frame.text
                # page numbers follow the slide order (duplicated pages carry the template's number)
                if i > 1 and len(sh.text_frame.paragraphs[0].runs) == 2 and re.fullmatch(r'\d\d / \d\d', t):
                    put(sh, [f'{i:02d}', f' / {n:02d}'])
                if footer and t.startswith('BMF.RV.UA  ·  '): put(sh, footer)
                # section tags "// NN — ..." follow the page number too
                if sh.shape_id == 11 and 1 < i < n and re.match(r'// \d\d — ', t):
                    put(sh, f"// {i - 1:02d} — {tags.get(s.slide_id, t[8:])}")
