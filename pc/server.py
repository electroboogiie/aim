# Конфігуратор КП для ПК: локальний сервер (лише стандартна бібліотека Python) + генератор generator/kpgen.
#   python pc/server.py [--port 8765] [--no-browser]
# Інтерфейс: http://127.0.0.1:8765  (конфігуратор і адмінка). Дані адмінки: pc/data/admin.json,
# згенеровані КП: pc/data/out/, завантажені фото: generator/assets/custom/.
import argparse, hashlib, json, mimetypes, os, re, subprocess, sys, threading, time, webbrowser
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
for d in (DATA, OUT, CACHE, os.path.join(ASSETS, 'custom')): os.makedirs(d, exist_ok=True)

sys.path.insert(0, GEN)
from kpgen.styles import STYLES, DEFAULT, HERO_PAGES, pages   # noqa: E402
from kpgen.profiles import PROFILES, NPL10                   # noqa: E402

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
            'prices': {'items': {}, 'bundles': {}, 'accessories': {}}, 'texts': {'terms': {}, 'cranes': {}, 'npl': {}}}


def styles_info():
    return [dict(id=k, title=v['title'], kits=list(v.get('kits') or []),
                 pages=[dict(key=key, title=t, hero=v['engine'] == 'v3' and key in HERO_PAGES and not (key == 'cover' and v.get('cover') == 'panel'))
                        for key, t, _ in pages(k)]) for k, v in STYLES.items()]


def defaults_texts():
    return {'cranes': {k: {'lead': p.get('lead', ''), 'lead2': p.get('lead2', '')} for k, p in PROFILES.items()},
            'npl': {'lead': NPL10.get('lead', ''), 'lead2': NPL10.get('lead2', '')}}


def page_texts(style):
    path = os.path.join(CACHE, f'texts_{style}.json')
    tpl = os.path.join(GEN, 'templates', STYLES[style]['template'])
    cached = read_json(path, None)
    if cached and cached.get('mtime') == os.path.getmtime(tpl): return cached['pages']
    with LOCK:
        from kpgen.introspect import static_texts
        data = static_texts(style)
    write_json(path, {'mtime': os.path.getmtime(tpl), 'pages': data})
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
        raise ValueError(f"Стиль «{STYLES[style]['title']}» є лише для комплектів НПЛ-10 з краном. Оберіть інший стиль.")
    spec['style'] = style
    st = (admin.get('styles') or {}).get(style) or {}
    bg = {k: v for k, v in (st.get('bg') or {}).items() if v and v.get('path')}
    photos = dict(spec.get('photos') or {})
    panel = STYLES[style].get('cover') == 'panel'
    for key in ('cover', 'end'):
        o = bg.get(key)
        if o and key in HERO_PAGES and not (key == 'cover' and panel) and STYLES[style]['engine'] == 'v3':
            photos[key] = o['path']; photos[key + '_focus'] = [float(o.get('fx', 0.5)), float(o.get('fy', 0.45))]
    if photos: spec['photos'] = photos
    spec['overrides'] = {'bg': bg, 'texts': st.get('texts') or {}}
    return spec


def generate(spec):
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
    # one history line per KP
    hist = read_json(os.path.join(DATA, 'history.json'), [])
    hist.insert(0, dict(time=time.strftime('%d.%m.%Y %H:%M'), number=spec.get('number'), title=spec.get('title'),
                        client=(spec.get('client') or {}).get('name'), style=spec['style'], total=spec.get('total_text'),
                        pptx=res['pptx'], pdf=res['pdf']))
    write_json(os.path.join(DATA, 'history.json'), hist[:200])
    return res


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
                                           defaults=defaults_texts(), history=read_json(os.path.join(DATA, 'history.json'), [])[:30]))
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
            if p.startswith('/out/'): return self.file(safe_join(OUT, p[5:]), download=p.endswith('.pptx'))
            if p == '/' or p == '/admin': p = '/index.html'
            return self.file(safe_join(STATIC, p.lstrip('/')))
        except Exception as e:  # noqa: BLE001
            return self.send(500, {'error': str(e)})

    def do_PUT(self):
        if urlparse(self.path).path != '/api/admin': return self.send(404, {'error': 'немає'})
        try: data = json.loads(self.body())
        except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
        with LOCK: write_json(ADMIN, data)
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
            rel = f"custom/{hashlib.sha1(data).hexdigest()[:16]}{ext}"
            with open(os.path.join(ASSETS, rel), 'wb') as f: f.write(data)
            return self.send(200, {'path': rel})
        if p == '/api/generate':
            try: spec = json.loads(self.body())
            except ValueError: return self.send(400, {'error': 'Неправильний JSON'})
            try: return self.send(200, generate(spec))
            except ValueError as e: return self.send(400, {'error': str(e)})
        return self.send(404, {'error': 'немає'})


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=8765); ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    url = f'http://127.0.0.1:{a.port}/'
    print(f'Конфігуратор КП: {url}  (зупинити: Ctrl+C)')
    if not a.no_browser: threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass


if __name__ == '__main__':
    main()
