# Visual profiles of the KP_2_v3 engine, keyed by KpSpec.crane.profile.
# Everything here is about pictures (which chart, where to crop, where CAD labels sit, which photo
# goes on the cover) or default wording taken from the user's approved KPs; prices and specs come
# from the spec.
#
# Drawings: bmf.ee crane charts (3308 x 2339 px; the 750 chart is 1600 px wide, upscaled to 3308).
# side / fold: crop boxes of the side view and the folded view; *_labels: CAD label centres inside
# each crop (text "{lift_4m_kg}" / "{lift_full_kg}" is filled from the spec); piv / tip / base_y:
# boom pivot, tip at the drawn reach and base bottom (crop px) for the reach axis of the passport chart.
# open: opening size that strips CAD lines/text off the body (the upscaled 750 chart has thicker strokes).
# Source of all numbers: kp_v3_set.py (DRAW650, DRAW750, KITS), 18.10.2026.


def _k750(*b): return tuple(int(round(v * 3308 / 1600)) for v in b)


DRAW650 = dict(
    open=5, side=(880, 470, 3280, 1230), fold=(200, 360, 870, 2320),
    side_labels=[(1270, 28, '6525'), (146, 90, '105'), (676, 90, '2760'), (46, 464, '1820'), (118, 528, '1430'),
                 (1524, 526, '{lift_4m_kg} кг'), (1520, 618, '4 м'), (2324, 526, '{lift_full_kg} кг'), (2320, 618, '6,5 м')],
    fold_labels=[(616, 1460, '2195'), (300, 1920, '1000')], piv=242, tip=2296, base_y=750, tip_m=6.525)

DRAW750 = dict(
    open=9, pass_erase=[(0, 0, 2753, 180), (0, 0, 200, 900)], caption_at=(1.15, 3.14),
    side=(555, 227, 3308, 1127), fold=(165, 734, 703, 2270), fold_erase=[(415, 0, 538, 446)], plate=_k750(428, 757, 1000, 1040),
    side_labels=[(1467, 46, '7500'), (183, 110, '160'), (799, 110, '3200'), (76, 534, '2155'), (146, 614, '1640'),
                 (1581, 641, '{lift_4m_kg} кг'), (1575, 749, '4 м'), (2666, 641, '{lift_full_kg} кг'), (2664, 749, '7,5 м')],
    fold_labels=[(478, 1147, '2520'), (242, 1499, '1000')], piv=294, tip=2642, base_y=872, tip_m=7.5)

# Crane cut-outs on the anatomy (slide 3) and configuration (slide 5) pages show "720" on the boom;
# other models get the number repainted at these boxes (px of the template images).
DECAL_ANATOMY = (870, 850, 978, 928)
DECAL_CONFIG = (775, 755, 880, 830)

PROFILES = {
    # The template itself is the BMF 720 KP: its drawings, cut-outs and photos are kept as they are.
    'bmf720': dict(
        model_no='720', native=True,
        lead='Лісовий кран з вильотом 7,2 м для ефективного навантаження деревини на лісовозні причепи або трактори.',
        lead2='Триточкове навішування, ширококутний шарнір і телескопічна стріла роблять BMF 720 універсальним: монтаж на причіп BMF або напряму на трактор.',
        cover={'crane_kit': None, 'npl_crane': ('ref/bmf720_photo4.jpg', 0.62, 0.35)},   # None = template photo
        end={'crane_kit': None, 'npl_crane': ('ref/bmf720_photo2.jpg', 0.55, 0.5)},
    ),
    'bmf650': dict(
        model_no='650', native=False, draw=DRAW650,
        charts={'default': 'bmf/650_chart_90.jpg', 'bmf650_plus': 'bmf/650_chart_100.jpg'},
        chart_by_torque={'60': 'bmf/650_chart_100.jpg'},   # BMF 650 (100 kNm class) as in the user's КП НПЛ-10+650
        lead='Лісовий кран з вильотом 6,5 м — одна з найпопулярніших моделей BMF: і для легкої дров’яної деревини, і для важких колод.',
        lead2='Триточкове навішування з виносною опорою, ширококутний шарнір і телескопічна стріла: BMF 650 монтується на причіп BMF або напряму на трактор.',
        cover={'crane_kit': ('bmf/650_a.jpg', 0.3, 0.4), 'npl_crane': ('ref/bmf720_photo2.jpg', 0.7, 0.35)},
        end={'crane_kit': ('bmf/650_b.jpg', 0.6, 0.5), 'npl_crane': ('bmf/650_b.jpg', 0.6, 0.5)},
    ),
    'bmf750': dict(
        model_no='750', native=False, draw=DRAW750,
        charts={'default': 'bmf/750_chart_up.jpg'},
        lead='Далекобійний лісовий кран з вильотом 7,5 м: гідролінії прокладені всередині стріли й захищені від пошкоджень у лісі.',
        lead2='Триточкове підключення до трактора, ширококутний шарнір і телескоп. Жорстка поворотна станина BMF 750 розрахована на довгі робочі дні.',
        # crane_kit photos: no BMF 750 kit KP was built on KP_2_v3 yet; bmf.ee photos of the 750
        cover={'crane_kit': ('bmf/750_forest_load.jpg', 0.45, 0.5), 'npl_crane': ('npl/npl10_bmf750_studio.jpg', 0.5, 0.42)},
        end={'crane_kit': ('bmf/750_forest.webp', 0.5, 0.35), 'npl_crane': ('bmf/750_forest_load.jpg', 0.45, 0.5)},
    ),
}

# Values the template prints for the BMF 720 (slides 1-6); a native profile with other values gets
# the affected labels/bars rewritten.
TEMPLATE_720 = dict(reach_m='7,2', lift_4m_kg='1100', lift_full_kg='580')

# Focus points for photos used as page heroes when the spec names the photo but no focus.
PHOTO_FOCUS = {
    'ref/bmf720_photo4.jpg': (0.62, 0.35), 'ref/bmf720_photo2.jpg': (0.55, 0.5), 'bmf/650_a.jpg': (0.3, 0.4),
    'bmf/650_b.jpg': (0.6, 0.5), 'npl/npl10_bmf750_studio.jpg': (0.5, 0.42), 'bmf/750_forest_load.jpg': (0.45, 0.5),
}

# Accessory card photo tweaks (kp_v3_set.py ACC): focus and white-paper key tolerance for studio shadows.
CARD_TWEAKS = {
    'acc_rv/02_grapple_forest.jpg': dict(fy=0.45),
    'acc_rv/03_rotator.jpg': dict(key_t=200),
    'acc_rv/06_wheel.jpg': dict(key_t=200),
}

# Configuration-page tile pictures taken from the template (slide 5 shape ids) by item id prefix.
TEMPLATE_TILES = {'crane': 14, 'seat': 37, 'base_outriggers': 23, 'tank': 30}

# НПЛ-10 (own production): facts from the user's КП НПЛ-10 (reference/kp/kp_text.md, README.md).
NPL10 = dict(
    cover_kpi=[('01 / ВАНТАЖ', '10', '  т'), ('02 / ОБ’ЄМ', '10', '  м³')],
    lead='Напівпричіп-лісовоз НПЛ-10 для перевезення деревини бездоріжжям і дорогами загального користування.',
    lead2='Вантажопідйомність до 10 000 кг, габарити 6950 × 2412 × 2789 мм. На вибір: кран BMF (650, 720, 750, 850), тип гальм, розмір коліс, кількість коників і місце оператора.',
    tiles=[('Рама 10 мм', 'Стінки рами 10 мм і шасі з бічними лонжеронами.'),
           ('Посилений балансир', 'Стійкість причепа на бездоріжжі з повним кузовом.'),
           ('Ступиця TVZ', '8 болтів на кожному колесі: надійна ходова під вантажем.'),
           ('Колеса {wheels}', 'Чотири ходові колеса з дисками; інші розміри на вибір.'),
           ('Гальма на вибір', 'Гідравлічна або пневматична гальмівна система.'),
           ('{stakes_text}', 'Сортименти 2–5 м, решітка огорожі в комплекті.'),
           ('Аутригери V-типу', 'Стійка опора причепа під час роботи крана.'),
           ('Автономна робота', 'Своя гідросистема і місце оператора: без гідравліки трактора.')],
    spec_rows=[('Повна конструктивна маса', '13 500', 'кг'), ('Споряджена маса (з маніпулятором)', '3 500', 'кг'),
               ('Вантажопідйомність', '10 000', 'кг'), ('Об’єм вантажного простору', '10,0', 'м³'),
               ('Довжина сортиментів', '2–3–4–5', 'м'), ('Площа навантаження, довжина × ширина', '4500 × 2140', 'мм'),
               ('Габарити, довжина × ширина × висота', '6950 × 2412 × 2789', 'мм'), ('Коники / стійки', '{stakes}', 'шт'),
               ('Товщина стінки рами', '10', 'мм'), ('Ступиця TVZ', '8', 'болтів'),
               ('Колесо ходове з диском {wheels}', '4', 'шт'), ('Гальмівна система', '{brakes}', ''),
               ('Аутригери V-типу, підсилений балансир', 'так', ''), ('Поворотний причіпний механізм, автономна гідравліка', 'так', ''),
               ('Решітка огорожі, освітлення, номерна рамка, місце оператора', 'так', '')],
    drawing_note='* Креслення відповідають стандартному розміру. Габаритні та конструктивні розміри можуть змінюватися за погодженням із замовником.',
    side='npl/npl10_side.png', front='npl/npl10_front.png', cutout='npl/npl10_cutout.png',
    p2_photo=('bmf/forest_trailer_work.jpg', 0.55, 0.5),   # bmf.ee, loaded trailer in a pine forest
)

# Own-production page (НПЛ-10 kits): photos from the user's KPs (kp_v3_set.py, round 3).
OWN_PRODUCTION = dict(
    headline=('ВИГОТОВЛЯЄМО САМІ.', 'ВІД РАМИ ДО БАКА.'),
    badge='OWN PRODUCTION · UA',
    facts=[('100+', 'НПЛ-10 ВИГОТОВЛЕНО'), ('до 60', 'ДНІВ ПІД ЗАМОВЛЕННЯ'), ('10 т', 'ВАНТАЖОПІДЙОМНІСТЬ'),
           ('10 мм', 'СТІНКА РАМИ'), ('BMF', 'ОФІЦІЙНИЙ ДИСТРИБ’ЮТОР')],
    quote='Під замовлення виготовляємо напівпричепи НПЛ-10, основи з аутригерами, гідробаки й місця оператора, а також дообладнуємо вантажівки під лісовоз.',
    photos=[(13, 'prod/npl10_workshop.png', 0.5, 0.55), (24, 'prod/truck_conversion.png', 0.5, 0.6),
            (25, 'prod/base_outriggers.jpg', 0.5, 0.6), (43, 'prod/npl10_tractor.png', 0.6, 0.5),
            (46, 'prod/tank.jpg', 0.5, 0.5), (52, 'prod/npl10_rear.jpg', 0.5, 0.45)],
    seat_tile=49,
)


def chart_for(profile, crane):
    p = PROFILES[profile]
    charts = p.get('charts') or {}
    if crane.get('id') in charts: return charts[crane['id']]
    t = (crane.get('specs') or {}).get('torque_knm')
    return (p.get('chart_by_torque') or {}).get(t) or charts.get('default')
