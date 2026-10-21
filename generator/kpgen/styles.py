# KP styles: the user's four approved designs. The first three share the KP_2_v3 layout (same shape ids) and are built
# by the same engine with their own template and raster colours; «НПЛ-10 Heavy Label» has its own layout and filler (d6.py).
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.normpath(os.path.join(HERE, '..', 'templates'))

STYLES = {
    'dark': dict(title='Темний (KP_2_v3)', template='KP_2_v3.pptx', theme='dark', engine='v3'),
    'light_v3': dict(title='Світлий (KP_2_v3, світла тема)', template='KP_light_v3.pptx', theme='light', engine='v3'),
    'light_panel': dict(title='Світлий з помаранчевою панеллю', template='KP_light.pptx', theme='light', engine='v3', cover='panel'),
    'npl_label': dict(title='НПЛ-10 «Heavy Label»', template='KP_npl_label.pptx', theme='dark', engine='d6', kits=('npl_crane',),
                      kits_title='лише НПЛ-10 + кран'),
    'ultra': dict(title='Ultra (сучасний темний)', template=None, theme='dark', engine='ultra', kits=('crane_kit', 'npl_crane'),
                  kits_title='кран у комплекті та НПЛ-10 + кран'),
}
DEFAULT = 'dark'

# pages of the KP_2_v3 layout: key -> (title, template slide index); trailer pages are copies of 1 and 3, options of 4
V3_PAGES = [('cover', 'Обкладинка', 0), ('manifest', 'Кран: маніфест', 1), ('trailer', 'Причіп: опис', 1),
            ('trailer_spec', 'Причіп: габарити', 3), ('anatomy', 'Кран: конструкція', 2), ('passport', 'Кран: паспорт', 3),
            ('config', 'Конфігурація', 4), ('options', 'Додаткові опції', 4), ('price', 'Вартість', 5),
            ('maker', 'Виробник BMF', 6), ('own_production', 'Власне виробництво (НПЛ-10)', 6), ('end', 'Контакти', 7)]
D6_PAGES = [('cover', 'Обкладинка', 0), ('npl_info', 'НПЛ-10: інформація', 1), ('npl_dims', 'НПЛ-10: габарити', 2),
            ('npl_spec', 'НПЛ-10: характеристики', 3), ('crane', 'Кран', 4), ('crane_spec', 'Кран: характеристики', 5),
            ('price', 'Вартість', 6), ('terms', 'Умови', 7), ('advantages', 'Переваги', 8), ('end', 'Контакти', 9)]
# pages whose background is a photo treated by the style (others take an underlay photo blended into the page)
HERO_PAGES = {'cover', 'manifest', 'trailer', 'end'}


# «Ultra» has no template: the settings can replace the photos of these pages (full-page photos)
ULTRA_PAGES = [('npl', 'НПЛ-10: фото', None), ('crane', 'Кран: фото', None), ('end', 'Контакти: фото', None)]


def template_path(style):
    t = STYLES[style]['template']
    return os.path.join(TEMPLATES, t) if t else None


def pages(style):
    return {'d6': D6_PAGES, 'ultra': ULTRA_PAGES}.get(STYLES[style]['engine'], V3_PAGES)
