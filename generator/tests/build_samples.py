# Sample KPs for the engine: writes specs/*.json from the data kp_v3_set.py used (round 3, 18.10.2026),
# runs the CLI, renders the PDFs and compares them page by page with the reference PDFs.
#   python3 tests/build_samples.py [--refs DIR] [--orig DIR] [--only NAME] [--fresh] [--no-run]
# --refs: delivered PDFs (default /mnt/project-files/kp-configurator/kp_v3_set, read only)
# --orig: PDFs of the current kp_v3_set.py run (same rules as the engine), optional second baseline
import argparse, json, os, shutil, subprocess, sys, tempfile, time
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
SPECS, OUT = os.path.join(HERE, 'specs'), os.path.join(HERE, 'out')

CONTACTS = dict(phones=['(+380) 67 363 0629', '(+380) 68 177 5997'], email='debeliy78@ukr.net', sites=['bmf.rv.ua', 'bmf.ee'],
                address='вул. Заводська 5, м. Сарни, Рівненська обл., 34500', socials=['TikTok @bmf.ua', 'Instagram @bmf.rv.ua'])
GIDMAN = dict(name='ТОВ «ГІДМАН»', line='Виробник: ТОВ «ГІДМАН»')            # KP_2_v3.pptx, contacts page
FOP = dict(name='ФОП Дебелий В. М.', line='Виробник НПЛ-10: ФОП Дебелий В. М.')  # kp_v3_set.py НПЛ-10 kits
EUR_NOTE = 'Ціна прив’язана до курсу EUR і може переглядатись у разі його зростання. Рекомендуємо зафіксувати комплект договором.'
TERMS = [('Документація', 'Договір з усіма ключовими умовами; повний пакет документів разом із товаром.'),
         ('Терміни', 'Під замовлення — до 60 календарних днів з моменту підписання договору.'),
         ('Оплата', 'Повна оплата, частинами за договором або кредитні умови.'),
         ('Доставка', 'Здійснюється за рахунок покупця.'),
         ('Бонуси', 'Від 2 кранів BMF — персональна система знижок.')]
TERMS_NPL = [('Документація', 'Договір з усіма ключовими умовами; повний пакет документів для реєстрації НПЛ-10 разом із товаром.')] \
    + TERMS[1:4] + [('Бонуси', 'Від 2 одиниць НПЛ-10 — персональна система знижок.')]
# bmf.rv.ua/accessories (kp_v3_set.py ACC)
ACC = [('crane', 'Регулюючий клапан', 'На вибір: 5/7 XY, 6/8 XY, 4/8 XYZ, 2/8 XY el. On/Off або HPC.', 'acc_rv/01_valve_4-8xyz.png'),
       ('crane', 'Грейфери Hardox', 'Сталь Hardox (SSAB). Для BMF 750: C20, C24 або C27.', 'acc_rv/02_grapple_forest.jpg'),
       ('crane', 'Ротатори', 'GR 3, GR 30, GR 46, CR 300 або CR 400.', 'acc_rv/03_rotator.jpg'),
       ('crane', 'Опори крана', 'Опора F/D-типу («метелик») або опора типу А, підходить для всіх кранів.', 'acc_rv/04_leg_fd.jpg'),
       ('trailer', 'Привід 2WD або 4WD', 'Гідромотори коліс: Black Bruin BB5 для 2WD, Robson для 4WD.', 'acc_rv/05_wheel_drive.jpg'),
       ('trailer', 'Колеса', '11,5/80-15,3; 400/60-15,5; 500/50-17; 520/50-17; 550/45-22,5.', 'acc_rv/06_wheel.jpg'),
       ('trailer', 'Додаткові стійки', 'Додаткова пара стійок до вантажної платформи.', 'acc_rv/07_poles.png'),
       ('trailer', 'Подовжувач рами', 'Подовжує вантажну раму під довші сортименти.', 'acc_rv/08_frame_ext.png'),
       ('trailer', 'Ліхтарі', 'Задні світлові ліхтарі для руху дорогами.', 'acc_rv/09_lights.jpg')]

# crane data as kp_v3_set.py printed it; rows it did not set keep the template's (BMF 720) values
# (slew_cyl, telescope: also docs/research/bmf_specs.json, bmf.ee)
BASE_SPECS = dict(valve='6/8XY', valve_flow_l='55', slew_cyl='4', pressure_bar='200', pump_lpm='30–60', legs='A/FD', telescope='так')
CR720 = dict(id='bmf720', model='BMF 720', profile='bmf720', specs=dict(
    BASE_SPECS, reach_m='7,2', torque_knm='60', lift_4m_kg='1100', lift_full_kg='580', grapple_m2='0,24', rotator_t='4',
    slew_knm='14', turn_deg='370', weight_kg='675'))
CR650 = dict(id='bmf650', model='BMF 650', profile='bmf650', specs=dict(
    BASE_SPECS, reach_m='6,5', torque_knm='48', lift_4m_kg='840', lift_full_kg='510', grapple_m2='0,2', rotator_t='3',
    slew_knm='11', turn_deg='360', weight_kg='640'),
    lead='Лісовий кран з вильотом 6,5 м — одна з найпопулярніших моделей BMF: і для легкої дров’яної деревини, і для важких колод.',
    lead2='Триточкове навішування з виносною опорою, ширококутний шарнір і телескопічна стріла: BMF 650 монтується на причіп BMF або напряму на трактор.')
CR650P = dict(CR650, id='bmf650_plus', specs=dict(CR650['specs'], torque_knm='60', lift_4m_kg='1120', lift_full_kg='640'))
CR750 = dict(id='bmf750', model='BMF 750', profile='bmf750', specs=dict(
    BASE_SPECS, reach_m='7,5', torque_knm='76', lift_4m_kg='1410', lift_full_kg='750', grapple_m2='0,27', rotator_t='4',
    valve='4/8 XYZ', valve_flow_l='80', slew_knm='17', turn_deg='370', pump_lpm='50–100', legs='FD', weight_kg='996'),
    lead='Далекобійний лісовий кран з вильотом 7,5 м: гідролінії прокладені всередині стріли й захищені від пошкоджень у лісі.',
    lead2='Триточкове підключення до трактора, ширококутний шарнір і телескоп. Жорстка поворотна станина BMF 750 розрахована на довгі робочі дні.')

fmt = lambda n: f'{n:,}'.replace(',', ' ') + ' ₴'
kit_line = lambda c: f"у комплекті з ротатором {c['specs']['rotator_t']} т і захватом {c['specs']['grapple_m2']} м²"
BRAKES = {'гідравлічна': 'гідравлічні', 'пневматична': 'пневматичні'}


def acc(groups=('crane', 'trailer'), n=9):
    return [dict(group=g, title=t, desc=d, photo=p, price_text='ціна за запитом') for g, t, d, p in ACC if g in groups][:n]


def base(number, date, valid, kit_type, title, crane, rows, total, price_date, maker, terms, accessories, **kw):
    return dict(template='kp_v3', number=number, date=date, valid_until=valid, client=dict(name='Назва замовника'),
                kit_type=kit_type, title=title, crane=crane, npl=kw.pop('npl', None), rows=rows,
                accessories=accessories, total_text=fmt(total), price_date=price_date, price_note=EUR_NOTE,
                maker=maker, contacts=CONTACTS, terms=[dict(title=t, text=x) for t, x in terms], **kw)


def npl_kit(crane, brakes, total, price_date, cover, end):
    rows = [dict(no=1, item_id='npl10', kind='trailer', title='Напівпричіп-лісовоз НПЛ-10',
                 desc=f'10 т · 4 коники · {BRAKES[brakes]} гальма · місце оператора', qty=1, price_text='у комплекті'),
            dict(no=2, item_id=crane['id'], kind='crane', title=f"Кран-маніпулятор {crane['model']}", desc=kit_line(crane),
                 qty=1, price_text='у комплекті')]
    return base('0001', '18.10.2026', '25.10.2026', 'npl_crane', f"НПЛ-10 + {crane['model']}", crane, rows, total, price_date,
                FOP, TERMS_NPL, acc(), npl=dict(brakes=brakes, wheels='500/45-22,5', stakes='4'),
                photos=dict(cover=cover[0], cover_focus=cover[1:], end=end[0], end_focus=end[1:]))


def crane_kit(number, date, crane, items, price_date, maker, accessories=(), terms=TERMS, **kw):
    rows = []
    for no, (iid, kind, title, desc, price) in enumerate(items, 1):
        rows.append(dict(no=no, item_id=iid, kind=kind, title=title, desc=desc, qty=1, price_text=fmt(price)))
    return base(number, date, '', 'crane_kit', crane['model'], crane, rows, sum(i[4] for i in items), price_date, maker,
                terms, list(accessories), **kw)


def kit4(crane, prices):
    return [(crane['id'], 'crane', f"Кран-маніпулятор {crane['model']}", kit_line(crane), prices[0]),
            ('base_outriggers_' + crane['id'][3:6], 'component', 'Платформа з аутригерами', 'опорні лапи, РВТ, з’єднувальні болти, фланці', prices[1]),
            ('tank', 'component', 'Гідравлічний бак в зборі', 'живлення робочої системи крана', prices[2]),
            ('seat', 'component', 'Місце оператора', 'ергономічне робоче місце з органами керування', prices[3])]


SAMPLES = {
    # name: (spec, reference pdf, orig pdf name, options page number missing in the delivered reference)
    'npl10_bmf750': (npl_kit(CR750, 'гідравлічна', 1978000, '18.05.2026', ('npl/npl10_bmf750_studio.jpg', 0.5, 0.42),
                             ('bmf/750_forest_load.jpg', 0.45, 0.5)), 'KP_NPL10_BMF750_v3_r2.pdf', 'KP_NPL10_BMF750_v3_r2.pdf', None),
    'npl10_bmf720': (npl_kit(CR720, 'пневматична', 1886600, '29.09.2026', ('ref/bmf720_photo4.jpg', 0.62, 0.35),
                             ('ref/bmf720_photo2.jpg', 0.55, 0.5)), 'KP_NPL10_BMF720_v3_r2.pdf', 'KP_NPL10_BMF720_v3_r3.pdf', 8),
    'npl10_bmf650': (npl_kit(CR650P, 'гідравлічна', 1709100, '18.05.2026', ('ref/bmf720_photo2.jpg', 0.7, 0.35),
                             ('bmf/650_b.jpg', 0.6, 0.5)), 'KP_NPL10_BMF650_v3_r2.pdf', 'KP_NPL10_BMF650_v3_r3.pdf', 8),
    'bmf720_komplekt': (crane_kit('0001', '06.10.2026', CR720, kit4(CR720, [686000, 155000, 18500, 27750]), '24.08.2025', GIDMAN),
                        'KP_BMF720_komplekt_v3.pdf', 'KP_BMF720_komplekt_v3.pdf', None),
    # extra checks: 650 kit (reference exists), 6-position 750 kit with options, 2-position 650 kit
    'bmf650_komplekt': (crane_kit('0001', '18.10.2026', CR650, kit4(CR650, [626400, 160000, 18500, 27750]), '02.09.2025', GIDMAN),
                        'KP_BMF650_komplekt_v3.pdf', 'KP_BMF650_komplekt_v3.pdf', None),
    'bmf750_radiator': (crane_kit('0002', '18.10.2026', CR750, [
        ('bmf750', 'crane', 'Кран-маніпулятор BMF 750', kit_line(CR750), 856800),
        ('base_outriggers_750', 'component', 'Платформа з аутригерами', 'опорні лапи, РВТ, з’єднувальні болти, фланці', 180000),
        ('tank', 'component', 'Гідравлічний бак в зборі', 'живлення робочої системи крана', 18500),
        ('oil_90l', 'component', 'Олива гідравлічна 90 л', '', 16200),
        ('seat', 'component', 'Місце оператора', 'заднє, по центру', 27750),
        ('heat_exchanger', 'component', 'Теплообмінник (радіатор)', '', 27000)], '02.10.2026', GIDMAN,
        accessories=acc(('crane',)), client_note='КП BMF750 у комплекті 02102026 радіатор.pptx'), None, None, None),
    'bmf650plus_2pos': (crane_kit('0003', '18.10.2026', CR650P, [
        ('bmf650_plus', 'crane', 'Кран-маніпулятор BMF 650', kit_line(CR650P), 637800),
        ('base_outriggers_650', 'component', 'Основа з аутригерами та баком', 'опорні лапи, РВТ, з’єднувальні болти, фланці; гідробак в зборі', 174500)],
        '17.03.2026', GIDMAN), None, None, None),
}
SAMPLES['bmf750_radiator'][0]['valid_until'] = '25.10.2026'
SAMPLES['bmf750_radiator'][0]['client'] = dict(name='ТОВ «Лісові ресурси Полісся»', contact='Іван Петренко · (+380) 50 000 0000')
SAMPLES['bmf750_radiator'][0].pop('client_note')


def render(pdf, d, dpi):
    os.makedirs(d, exist_ok=True)
    subprocess.run(['pdftoppm', '-r', str(dpi), '-png', pdf, os.path.join(d, 'p')], check=True)
    return [Image.open(os.path.join(d, f)).convert('RGB') for f in sorted(os.listdir(d)) if f.endswith('.png')]


def diff(a, b):
    if a.size != b.size: b = b.resize(a.size)
    x = np.asarray(a, dtype=np.int16); y = np.asarray(b, dtype=np.int16)
    d = np.abs(x - y).mean(axis=2)
    return float(d.mean()), float((d > 40).mean() * 100), d


def compare(out_pages, ref_pages, skip):
    """Pairs of (out page no, ref page no); the options page missing from an older reference is skipped."""
    pairs = []; j = 0
    for i in range(1, len(out_pages) + 1):
        if i == skip: pairs.append((i, None)); continue
        j += 1
        pairs.append((i, j if j <= len(ref_pages) else None))
    return pairs


def sheet(path, cols):
    """cols: list of rows, each row a list of images (None = blank)."""
    w, h = 248, 351
    rows = len(cols); n = max(len(r) for r in cols)
    S = Image.new('RGB', (n * (w + 6), rows * (h + 6)), (255, 255, 255))
    for r, row in enumerate(cols):
        for c, im in enumerate(row):
            if im is not None: S.paste(im.resize((w, h)), (c * (w + 6), r * (h + 6)))
    S.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refs', default='/mnt/project-files/kp-configurator/kp_v3_set')
    ap.add_argument('--orig', default=None)
    ap.add_argument('--only', action='append')
    ap.add_argument('--fresh', action='store_true', help='clear the raster cache first')
    ap.add_argument('--no-run', action='store_true', help='compare existing output only')
    ap.add_argument('--dpi', type=int, default=50)
    a = ap.parse_args()
    os.makedirs(SPECS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    build = os.path.join(OUT, '.build')
    if a.fresh: shutil.rmtree(build, ignore_errors=True)
    env = dict(os.environ, KPGEN_BUILD=build)
    report = {}
    for name, (spec, ref, orig, skip) in SAMPLES.items():
        sp = os.path.join(SPECS, name + '.json')
        with open(sp, 'w', encoding='utf-8') as f: json.dump(spec, f, ensure_ascii=False, indent=1)
        if a.only and name not in a.only: continue
        od = os.path.join(OUT, name)
        r = report[name] = {}
        if not a.no_run:
            shutil.rmtree(od, ignore_errors=True)
            t0 = time.time()
            p = subprocess.run([sys.executable, '-m', 'kpgen', '--spec', sp, '--out', od], cwd=GEN, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            r['seconds'] = round(time.time() - t0, 1)
            r['stderr'] = p.stderr.strip().splitlines()[-1:] if p.stderr else []
            if p.returncode:
                r['error'] = p.stderr[-2000:]; print(name, 'FAILED', p.stderr[-2000:]); continue
            r['result'] = json.loads(p.stdout.strip().splitlines()[-1])
        res = r.get('result') or {'pdf': next((os.path.join(od, f) for f in os.listdir(od) if f.endswith('.pdf')), None)}
        tmp = tempfile.mkdtemp(prefix='kpcmp_')
        outp = render(res['pdf'], os.path.join(tmp, 'out'), a.dpi)
        rows_img = [outp]
        for label, base_dir, fname, sk in (('ref', a.refs, ref, skip), ('orig', a.orig, orig, None)):
            if not base_dir or not fname or not os.path.exists(os.path.join(base_dir, fname)): continue
            refp = render(os.path.join(base_dir, fname), os.path.join(tmp, label), a.dpi)
            pages = []; ref_row = []; diff_row = []
            for i, j in compare(outp, refp, sk):
                if j is None: pages.append(dict(page=i, ref=None)); ref_row.append(None); diff_row.append(None); continue
                m, frac, d = diff(outp[i - 1], refp[j - 1])
                pages.append(dict(page=i, ref=j, mean=round(m, 2), changed_pct=round(frac, 2)))
                ref_row.append(refp[j - 1])
                diff_row.append(Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).convert('RGB'))
            r[label] = dict(file=fname, pages_out=len(outp), pages_ref=len(refp), per_page=pages)
            rows_img += [ref_row, diff_row]
        sheet(os.path.join(OUT, name + '_sheet.png'), rows_img)
        shutil.rmtree(tmp, ignore_errors=True)
        print(name, json.dumps({k: v for k, v in r.items() if k != 'stderr'}, ensure_ascii=False))
    with open(os.path.join(OUT, 'report.json'), 'w', encoding='utf-8') as f: json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
