# Конфігуратор КП для ПК: локальний сервер (лише стандартна бібліотека Python) + генератор generator/kpgen.
#   python pc/server.py [--port 8765] [--no-browser]
# Інтерфейс: http://127.0.0.1:8765  (конфігуратор і адмінка). Дані адмінки: pc/data/admin.json,
# згенеровані КП: pc/data/out/, завантажені фото: generator/assets/custom/ (копія в pc/data/uploads/).
import argparse, glob, hashlib, json, mimetypes, os, re, shutil, subprocess, sys, threading, time, webbrowser
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEN = os.path.join(ROOT, 'generator')
ASSETS = os.path.join(GEN, 'assets')
STATIC = os.path.join(HERE, 'static')
DATA = os.environ.get('KP_PC_DATA') or os.path.join(HERE, 'data')
OUT = os.path.join(DATA, 'out')
CACHE = os.path.join(DATA, 'cache')
ADMIN = os.path.join(DATA, 'admin.json')
HIST = os.path.join(DATA, 'history.json')
VERSIONS = os.path.join(DATA, 'versions')
PREVIEW = os.path.join(CACHE, 'preview')
PAGES = os.path.join(CACHE, 'pages')     # page editor: page images of the KP being edited (last 20 kept)
UPLOADS = os.path.join(DATA, 'uploads')   # a copy of uploaded photos: pc/data survives replacing the program folder
CUSTOM = os.path.join(ASSETS, 'custom')   # where the generator reads them
for d in (DATA, OUT, CACHE, VERSIONS, PREVIEW, PAGES, UPLOADS, CUSTOM): os.makedirs(d, exist_ok=True)


def sync_uploads():
    """Uploaded photos live in pc/data/uploads and generator/assets/custom: copy whatever one of them lacks."""
    for a, b in ((CUSTOM, UPLOADS), (UPLOADS, CUSTOM)):
        for name in os.listdir(a):
            src, dst = os.path.join(a, name), os.path.join(b, name)
            if os.path.isfile(src) and not name.startswith('.') and not os.path.exists(dst): shutil.copy2(src, dst)

sys.path.insert(0, GEN)
sys.path.insert(0, HERE)
from kpgen.styles import STYLES, DEFAULT, HERO_PAGES, pages   # noqa: E402
from kpgen.profiles import PROFILES, NPL10, TRAILERS         # noqa: E402

LOCK = threading.Lock()          # admin.json writes and in-process introspection (the engine has global state)
IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp'}


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return default


def write_json(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def default_admin():
    return {'style': DEFAULT, 'kp_counter': 1, 'styles': {}, 'photos': {'items': {}, 'accessories': {}},
            'prices': {'items': {}, 'bundles': {}, 'accessories': {}, 'choices': {}},
            'texts': {'terms': {}, 'cranes': {}, 'npl': {}}, 'catalog': {}, 'photo_history': {}}


# ---------------------------------------------------------------- admin versions (rollback)
SNAP_EVERY = 180      # s: saves closer together than this update the latest snapshot instead of adding one
SNAP_KEEP = 120


def snapshots():
    out = []
    for f in sorted(glob.glob(os.path.join(VERSIONS, '*.json')), reverse=True):
        d = read_json(f, None)
        if d is None: continue
        out.append(dict(id=os.path.basename(f)[:-5], time=d.get('time'), note=d.get('note') or '', size=os.path.getsize(f)))
    return out


def snapshot(data, note='', force=False):
    """Keep a copy of admin.json; frequent autosaves fold into the newest copy."""
    now = time.time()
    files = sorted(glob.glob(os.path.join(VERSIONS, '*.json')))
    last = files[-1] if files else None
    if last and not force and not note and now - os.path.getmtime(last) < SNAP_EVERY and not read_json(last, {}).get('note'):
        path = last
    else:
        path = os.path.join(VERSIONS, time.strftime('%Y%m%d-%H%M%S') + f'-{int(now * 1000) % 1000:03d}.json')
    write_json(path, {'time': time.strftime('%d.%m.%Y %H:%M:%S'), 'note': note, 'admin': data})
    for f in sorted(glob.glob(os.path.join(VERSIONS, '*.json')))[:-SNAP_KEEP]: os.remove(f)


# ---------------------------------------------------------------- previews of photos as the KP will show them
def preview(kind, q):
    style = q.get('style', [DEFAULT])[0]
    if style not in STYLES: raise ValueError('Невідомий стиль')
    path = q.get('path', [''])[0]
    from kpgen import raster as R
    if not R.asset_ok(path): raise ValueError('Фото не знайдено')
    f = lambda k, d: float(q.get(k, [d])[0])
    if kind == 'page':
        key = q.get('page', ['cover'])[0]
        args = (style, key, path, f('fx', 0.5), f('fy', 0.45), f('opacity', 0.18))
    else:
        z = f('zoom', 1)
        pos = dict(zoom=max(1.0, min(4.0, z)), fx=f('fx', 0.5), fy=f('fy', 0.5)) if 'zoom' in q else None
        args = (style, path, q.get('kind', ['tile'])[0], 360, pos)
    st = os.stat(R.asset(path))
    h = hashlib.sha1(repr((kind, args, st.st_size, st.st_mtime_ns, 'p3')).encode()).hexdigest()
    cached = os.path.join(PREVIEW, h + '.jpg')
    if os.path.exists(cached):
        with open(cached, 'rb') as fh: return fh.read()
    from kpgen import preview as P
    with LOCK: data = P.page(*args) if kind == 'page' else P.item(*args)
    with open(cached, 'wb') as fh: fh.write(data)
    return data


def styles_info():
    return [dict(id=k, title=v['title'], engine=v['engine'], kits=list(v.get('kits') or []), kits_title=v.get('kits_title') or '',
                 pages=[dict(key=key, title=t, hero=v['engine'] == 'ultra' or (v['engine'] == 'v3' and key in HERO_PAGES and not (key == 'cover' and v.get('cover') == 'panel')))
                        for key, t, _ in pages(k)]) for k, v in STYLES.items()]


def defaults_texts():
    from kpgen.build import LAYOUT_TEXTS, LAYOUT_SHOW, SIGHT_BOX
    x, y, w, h = SIGHT_BOX
    return {'cranes': {k: {'lead': p.get('lead', ''), 'lead2': p.get('lead2', '')} for k, p in PROFILES.items()},
            'npl': {'lead': NPL10.get('lead', ''), 'lead2': NPL10.get('lead2', '')},
            'layout': dict(text=LAYOUT_TEXTS, show=LAYOUT_SHOW, sight=dict(x=x, y=y, w=w, h=h))}


def covers():
    """Cover photos the KPs use (the sight frame is placed per photo): key = photo path, 'template' = the template's."""
    out, seen = [], set()
    def add(key, title, d):
        if key in seen: return
        seen.add(key); path, fx, fy = d if d else ('', 0.5, 0.45)
        out.append(dict(key=key, title=title, path=path, fx=fx, fy=fy))
    for k, p in PROFILES.items():
        m = 'BMF ' + str(p.get('model_no') or k)
        for kit, t in (('crane_kit', m), ('npl_crane', f'НПЛ-10 + {m}')):
            d = p['cover'].get(kit)
            add(d[0] if d else 'template', t if d else f'{t} (фото шаблону)', d)
    for k, t in TRAILERS.items(): add(t['cover'][0], f"BMF {t.get('no') or k} + кран", t['cover'])
    for style, st in (read_json(ADMIN, {}).get('styles') or {}).items():
        o = (st.get('bg') or {}).get('cover') or {}
        if o.get('path') and style in STYLES: add(o['path'], f"Своє фото титулки ({STYLES[style]['title']})", (o['path'], o.get('fx', 0.5), o.get('fy', 0.45)))
    return out


def page_texts(style):
    path = os.path.join(CACHE, f'texts_{style}.json')
    if not STYLES[style]['template']: return {}
    tpl = os.path.join(GEN, 'templates', STYLES[style]['template'])
    cached = read_json(path, None)
    if cached and cached.get('mtime') == os.path.getmtime(tpl) and cached.get('v') == 2: return cached['pages']
    with LOCK:
        from kpgen.introspect import static_texts
        data = static_texts(style)
    write_json(path, {'mtime': os.path.getmtime(tpl), 'v': 2, 'pages': data})
    return data


def safe_join(base, rel):
    full = os.path.realpath(os.path.join(base, rel))
    if not full.startswith(os.path.realpath(base) + os.sep): return None
    return full


def apply_admin(spec, admin):
    """Style, page underlays and page texts from the admin go into the generator spec."""
    style = spec.get('style') or admin.get('style') or DEFAULT
    if style not in STYLES: style = DEFAULT
    kits = STYLES[style].get('kits')
    if kits and spec.get('kit_type') not in kits:
        raise ValueError(f"Стиль «{STYLES[style]['title']}» є лише для: {STYLES[style].get('kits_title') or ', '.join(kits)}. Оберіть інший стиль.")
    spec['style'] = style
    st = (admin.get('styles') or {}).get(style) or {}
    bg = {k: v for k, v in (st.get('bg') or {}).items() if v and v.get('path')}
    own_bg = ((spec.get('overrides') or {}).get('bg') or {})   # page photos chosen in the page editor for this KP win
    bg.update({k: v for k, v in own_bg.items() if isinstance(v, dict) and v.get('path')})
    photos = dict(spec.get('photos') or {})
    panel = STYLES[style].get('cover') == 'panel'
    for key in ('cover', 'end'):
        o = bg.get(key)
        if o and key in HERO_PAGES and not (key == 'cover' and panel) and STYLES[style]['engine'] == 'v3':
            photos[key] = o['path']; photos[key + '_focus'] = [float(o.get('fx', 0.5)), float(o.get('fy', 0.45))]
    if photos: spec['photos'] = photos
    layout = dict(admin.get('layout') or {})   # this KP's own switches (e.g. no client name -> no «Підготовлено для») win
    own = ((spec.get('overrides') or {}).get('layout') or {}).get('show') or {}
    if own: layout['show'] = {**(layout.get('show') or {}), **own}
    spec['overrides'] = {'bg': bg, 'texts': st.get('texts') or {}, 'layout': layout}
    ct = dict(spec.get('contacts') or {})   # contacts from the admin: every style
    for k, v in ((admin.get('layout') or {}).get('contacts') or {}).items():
        if k in ('phones', 'sites', 'socials') and isinstance(v, str): v = [x.strip() for x in v.split('\n') if x.strip()]
        if k in ('phones', 'email', 'sites', 'address', 'socials') and v: ct[k] = v
    if ct: spec['contacts'] = ct
    return spec


def history():
    h = read_json(HIST, [])
    for e in h:   # entries from the first test version had no id: the output folder is one
        if not e.get('id'):
            m = re.match(r'^/out/([^/]+)/', e.get('pptx') or e.get('pdf') or '')
            e['id'] = m.group(1) if m else hashlib.sha1(json.dumps(e, sort_keys=True).encode()).hexdigest()[:12]
    return h


def save_history(h):
    with LOCK: write_json(HIST, h[:300])


def out_dir_of(entry):
    p = entry.get('pptx') or entry.get('pdf') or ''
    m = re.match(r'^/out/([^/]+)/', p)
    return safe_join(OUT, m.group(1)) if m else None


def cover_png(entry_id, pptx):
    """Background: PNG of the KP cover for the history (needs LibreOffice)."""
    try:
        from kpgen.pdf import to_png
        png = to_png(pptx, os.path.dirname(pptx), timeout=120)
        cover = os.path.join(os.path.dirname(png), 'cover.png')
        from PIL import Image
        im = Image.open(png); im.thumbnail((360, 520)); im.save(cover); os.remove(png)
        h = history()
        for e in h:
            if e.get('id') == entry_id: e['cover'] = '/out/' + os.path.relpath(cover, OUT).replace(os.sep, '/')
        save_history(h)
    except Exception as e:  # noqa: BLE001 - a missing preview is not an error for the user
        sys.stderr.write(f'cover preview: {e}\n')


def generate(body):
    spec = body.get('spec') if 'spec' in body else body
    state = body.get('state') if 'spec' in body else None
    replace_id = body.get('history_id')
    admin = read_json(ADMIN, default_admin())
    spec = apply_admin(spec, admin)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    out = os.path.join(OUT, f"{stamp}_{re.sub(r'[^0-9A-Za-z]+', '', str(spec.get('number', '')))}_{spec['style']}")
    os.makedirs(out, exist_ok=True)
    spec_path = os.path.join(out, 'spec.json'); write_json(spec_path, spec)
    env = dict(os.environ, KPGEN_BUILD=CACHE, PYTHONIOENCODING='utf-8')
    r = subprocess.run([sys.executable, '-m', 'kpgen', '--spec', spec_path, '--out', out], cwd=GEN, env=env,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    lines = [l for l in r.stderr.splitlines() if l.startswith('kpgen:')]
    res = {'exit': r.returncode, 'messages': lines[-6:]}
    try: last = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError): last = {}
    rel = lambda p: '/out/' + os.path.relpath(p, OUT).replace(os.sep, '/') if p else None
    res.update(pptx=rel(last.get('pptx')), pdf=rel(last.get('pdf')), pages=last.get('pages'))
    if r.returncode not in (0, 3) and not lines: res['messages'] = r.stderr.splitlines()[-6:]
    if r.returncode not in (0, 3): log_failure(spec, r.stderr)
    if not res['pptx']: return res
    entry = dict(id=os.path.basename(out), time=time.strftime('%d.%m.%Y %H:%M'), date=spec.get('date'), number=spec.get('number'),
                 title=spec.get('title'), kit=[r_.get('title') for r_ in spec.get('rows') or []],
                 options=[a.get('title') for a in spec.get('accessories') or []],
                 client=(spec.get('client') or {}).get('name'), contact=(spec.get('client') or {}).get('contact'),
                 style=spec['style'], total=spec.get('total_text'), pptx=res['pptx'], pdf=res['pdf'], state=state)
    h = history()
    if replace_id:
        old = next((e for e in h if e.get('id') == replace_id), None)
        if old:
            d = out_dir_of(old)
            if d and os.path.isdir(d) and d != out: shutil.rmtree(d, ignore_errors=True)
            h = [e for e in h if e.get('id') != replace_id]
            entry['edited_from'] = old.get('time')
    h.insert(0, entry); save_history(h)
    res['history_id'] = entry['id']
    threading.Thread(target=cover_png, args=(entry['id'], last['pptx']), daemon=True).start()
    return res


def log_failure(spec, stderr):
    """A KP that did not build: its spec and the generator's full error go to data/errors (to send for a fix)."""
    try:
        d = os.path.join(DATA, 'errors'); os.makedirs(d, exist_ok=True)
        files = sorted(os.listdir(d))
        for f in files[:-30]: os.remove(os.path.join(d, f))   # the last 30 kept
        with open(os.path.join(d, time.strftime('%Y%m%d-%H%M%S') + '.txt'), 'w', encoding='utf-8') as f:
            f.write(stderr + '\n\n' + json.dumps(spec, ensure_ascii=False, indent=1))
    except OSError: pass


PAGES_LOCK = threading.Lock()   # one page preview at a time: each runs LibreOffice over every page
GALLERY_DIRS = {'custom': 'Завантажені', 'prod': 'Власне виробництво', 'npl': 'НПЛ-10', 'bmf': 'BMF', 'bmf_trailers': 'Причепи BMF',
                'acc': 'Опції', 'acc_rv': 'Опції bmf.rv.ua'}


def gallery():
    out = []
    for d, title in GALLERY_DIRS.items():
        base = os.path.join(ASSETS, d)
        for root, _, files in os.walk(base):
            for f in sorted(files):
                if os.path.splitext(f)[1].lower() in IMG_EXT:
                    out.append({'path': os.path.relpath(os.path.join(root, f), ASSETS).replace(os.sep, '/'), 'group': title})
    return out


def page_preview(body):
    """Page editor: the KP built without PDF, every page as a PNG, the zones the editor can change."""
    admin = read_json(ADMIN, default_admin())
    spec = apply_admin(body['spec'], admin)
    key = hashlib.sha1(json.dumps(spec, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    out = os.path.join(PAGES, key)
    meta = read_json(os.path.join(out, 'pages.json'), None)
    if meta: return meta
    with PAGES_LOCK:
        meta = read_json(os.path.join(out, 'pages.json'), None)
        if meta: return meta
        os.makedirs(out, exist_ok=True)
        spec_path = os.path.join(out, 'spec.json'); write_json(spec_path, spec)
        env = dict(os.environ, KPGEN_BUILD=CACHE, PYTHONIOENCODING='utf-8')
        r = subprocess.run([sys.executable, '-m', 'kpgen', '--spec', spec_path, '--out', out, '--no-pdf'], cwd=GEN, env=env,
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        try: last = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError): last = {}
        if r.returncode or not last.get('pptx'):
            msgs = [l.replace('kpgen: ', '') for l in r.stderr.splitlines() if l.startswith('kpgen:')] or r.stderr.splitlines()[-3:]
            shutil.rmtree(out, ignore_errors=True); log_failure(spec, r.stderr)
            raise ValueError(msgs[-1] if msgs else 'КП не зібрано')
        zones = read_json(os.path.splitext(last['pptx'])[0] + '.zones.json', {'pages': []})
        from kpgen.pdf import pages_png, PdfError
        try: pngs = pages_png(last['pptx'], out, int(body.get('width') or 640), timeout=240, cache_dir=os.path.join(PAGES, '_png'))
        except PdfError as e: raise ValueError(str(e))
        pages_ = []
        for i, png in enumerate(pngs):
            z = zones['pages'][i] if i < len(zones['pages']) else {'key': f'p{i + 1}', 'title': f'Сторінка {i + 1}', 'zones': []}
            pages_.append(dict(z, png=f'/pages/{key}/{os.path.basename(png)}'))
        meta = {'id': key, 'style': spec['style'], 'pages': pages_, 'hidden': zones.get('hidden') or []}
        write_json(os.path.join(out, 'pages.json'), meta)
        old = sorted((os.path.join(PAGES, d) for d in os.listdir(PAGES) if d != '_png'), key=os.path.getmtime)[:-20]
        for d in old: shutil.rmtree(d, ignore_errors=True)
        return meta


def nbu_eur():
    """Офіційний курс EUR НБУ на сьогодні: {rate, date (ISO)}."""
    from urllib.request import urlopen
    url = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json'
    with urlopen(url, timeout=8) as r: rows = json.loads(r.read().decode('utf-8'))
    if not rows: raise ValueError('порожня відповідь')
    d, m, y = rows[0]['exchangedate'].split('.')
    return {'rate': float(rows[0]['rate']), 'date': f'{y}-{m}-{d}', 'source': 'nbu'}


def xls_to_xlsx(name, data):
    """Old Excel .xls (1C exports): converted to .xlsx by LibreOffice, which the app already uses for PDF."""
    if not name.lower().endswith('.xls') or data[:2] == b'PK': return data
    import tempfile
    from kpgen.pdf import convert, PdfError
    d = tempfile.mkdtemp(prefix='kp_xls_')
    try:
        src = os.path.join(d, 'table.xls')
        with open(src, 'wb') as f: f.write(data)
        try: out = convert(src, d, 'xlsx', timeout=90)
        except PdfError: raise ValueError('Файл .xls відкривається через LibreOffice, а його не знайдено: встановіть LibreOffice або збережіть файл в Excel як .xlsx.')
        with open(out, 'rb') as f: return f.read()
    finally:
        shutil.rmtree(d, ignore_errors=True)


class H(BaseHTTPRequestHandler):
    server_version = 'KP-PC/1'

    def log_message(self, fmt, *a): sys.stderr.write('%s %s\n' % (self.command, self.path))

    def send(self, code, body, ctype='application/json; charset=utf-8', cache=False):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str): body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-store')
        self.end_headers(); self.wfile.write(body)

    def file(self, path, cache=False, download=False):
        if not path or not os.path.isfile(path): return self.send(404, {'error': 'Файл не знайдено'})
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if path.endswith('.js'): ctype = 'text/javascript; charset=utf-8'
        with open(path, 'rb') as f: data = f.read()
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'max-age=3600' if cache else 'no-store')
        if download: self.send_header('Content-Disposition', f'attachment; filename="{os.path.basename(path)}"')
        self.end_headers(); self.wfile.write(data)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def do_GET(self):
        u = urlparse(self.path); p = unquote(u.path); q = parse_qs(u.query)
        try:
            if p == '/api/bootstrap':
                return self.send(200, dict(catalog=read_json(os.path.join(ROOT, 'catalog', 'catalog.json'), {}),
                                           settings=read_json(os.path.join(ROOT, 'catalog', 'settings.default.json'), {}),
                                           admin=read_json(ADMIN, default_admin()), styles=styles_info(),
                                           defaults=defaults_texts(), history=history()))
            if p == '/api/history': return self.send(200, history())
            if p == '/api/covers': return self.send(200, covers())
            if p == '/api/eur':
                try: return self.send(200, nbu_eur())
                except Exception as e:  # noqa: BLE001
                    return self.send(502, {'error': f'Не вдалося отримати курс НБУ: {e}'})
            if p == '/api/versions': return self.send(200, snapshots())
            if p in ('/api/preview/page', '/api/preview/item'):
                try: data = preview(p.rsplit('/', 1)[1], q)
                except ValueError as e: return self.send(400, {'error': str(e)})
                return self.send(200, data, 'image/jpeg', cache=True)
            if p == '/api/texts':
                style = q.get('style', [DEFAULT])[0]
                if style not in STYLES: return self.send(400, {'error': 'Невідомий стиль'})
                return self.send(200, page_texts(style))
            if p == '/api/bg':
                style, key = q.get('style', [DEFAULT])[0], q.get('page', ['cover'])[0]
                from kpgen.introspect import background
                data = background(style, key)
                return self.send(200, data, 'image/jpeg', cache=True) if data else self.send(404, {'error': 'немає фону'})
            if p.startswith('/assets/'): return self.file(safe_join(ASSETS, p[8:]), cache=True)
            if p == '/api/gallery': return self.send(200, gallery())
            if p.startswith('/pages/'): return self.file(safe_join(PAGES, p[7:]))
            if p.startswith('/out/'): return self.file(safe_join(OUT, p[5:]), download=p.endswith('.pptx'))
            if p == '/' or p == '/admin': p = '/index.html'
            return self.file(safe_join(STATIC, p.lstrip('/')))
        except Exception as e:  # noqa: BLE001
            return self.send(500, {'error': str(e)})

    def do_PUT(self):
        p = urlparse(self.path).path
        try: data = json.loads(self.body())
        except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
        if p == '/api/admin':
            note = unquote(self.headers.get('X-Snapshot-Note') or '')
            with LOCK:
                write_json(ADMIN, data)
                snapshot(data, note=note, force=bool(note))
            return self.send(200, {'ok': True})
        m = re.match(r'^/api/history/([\w.-]+)$', p)
        if m:
            h = history()
            e = next((x for x in h if x.get('id') == m.group(1)), None)
            if not e: return self.send(404, {'error': 'КП не знайдено'})
            for k in ('client', 'contact', 'note', 'number', 'date'):
                if k in data: e[k] = data[k]
            save_history(h)
            return self.send(200, e)
        return self.send(404, {'error': 'немає'})

    def do_DELETE(self):
        m = re.match(r'^/api/history/([\w.-]+)$', urlparse(self.path).path)
        if not m: return self.send(404, {'error': 'немає'})
        h = history()
        e = next((x for x in h if x.get('id') == m.group(1)), None)
        if not e: return self.send(404, {'error': 'КП не знайдено'})
        d = out_dir_of(e)
        if d and os.path.isdir(d): shutil.rmtree(d, ignore_errors=True)
        save_history([x for x in h if x is not e])
        return self.send(200, {'ok': True})

    def do_POST(self):
        p = urlparse(self.path).path
        if p == '/api/upload':
            name = unquote(self.headers.get('X-Filename') or 'photo.jpg')
            ext = os.path.splitext(name)[1].lower()
            if ext not in IMG_EXT: return self.send(400, {'error': 'Підтримуються JPG, PNG, WEBP'})
            data = self.body()
            if not data: return self.send(400, {'error': 'Порожній файл'})
            if ext == '.webp':   # python-pptx / LibreOffice: keep to PNG
                from PIL import Image; import io
                b = io.BytesIO(); Image.open(io.BytesIO(data)).save(b, 'PNG'); data = b.getvalue(); ext = '.png'
            name = f"{hashlib.sha1(data).hexdigest()[:16]}{ext}"
            for d in (CUSTOM, UPLOADS):
                with open(os.path.join(d, name), 'wb') as f: f.write(data)
            rel = 'custom/' + name
            return self.send(200, {'path': rel})
        if p == '/api/import':
            name = unquote(self.headers.get('X-Filename') or 'table.xlsx')
            data = self.body()
            if not data: return self.send(400, {'error': 'Порожній файл'})
            from tables import read_table
            try: return self.send(200, {'name': name, 'sheets': read_table(name, xls_to_xlsx(name, data))})
            except ValueError as e: return self.send(400, {'error': str(e)})
        if p == '/api/generate':
            try: body = json.loads(self.body())
            except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
            try: return self.send(200, generate(body))
            except ValueError as e: return self.send(400, {'error': str(e)})
        if p == '/api/pages':
            try: body = json.loads(self.body())
            except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
            try: return self.send(200, page_preview(body))
            except ValueError as e: return self.send(400, {'error': str(e)})
        if p == '/api/versions/restore':
            try: vid = json.loads(self.body()).get('id', '')
            except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
            path = safe_join(VERSIONS, vid + '.json')
            snap = read_json(path, None) if path else None
            if not snap: return self.send(404, {'error': 'Версію не знайдено'})
            with LOCK:
                snapshot(read_json(ADMIN, default_admin()), note='до відновлення ' + (snap.get('time') or ''), force=True)
                write_json(ADMIN, snap['admin'])
            return self.send(200, {'ok': True, 'admin': snap['admin']})
        return self.send(404, {'error': 'немає'})


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=8765); ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    sync_uploads()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    url = f'http://127.0.0.1:{a.port}/'
    print(f'Конфігуратор КП: {url}  (зупинити: Ctrl+C)')
    if not a.no_browser: threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    main()
