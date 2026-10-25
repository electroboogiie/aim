# Доступ з телефону: другий вхід програми (0.0.0.0:8766) для телефонів у тій самій Wi‑Fi, з PIN-кодом,
# і за бажання HTTPS-адреса через Cloudflare (cloudflared quick tunnel), з якою телефон ставить програму як застосунок.
# Комп'ютер працює через 127.0.0.1:8765 без PIN; усе, що приходить на другий вхід (зокрема через тунель), потребує PIN.
import hashlib, hmac, json, os, platform, re, secrets, shutil, socket, subprocess, sys, threading, time
from urllib.request import urlopen

PORT = 8766
TUNNEL_RE = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com')
CLOUDFLARED = {'Windows': 'cloudflared-windows-amd64.exe', 'Linux': 'cloudflared-linux-amd64'}
DL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/'


class Phone:
    def __init__(self, data_dir, handler_cls):
        self.path = os.path.join(data_dir, 'phone.json')
        self.bin_dir = os.path.join(data_dir, 'bin')
        self.handler_cls = handler_cls
        self.cfg = self._load()
        if not os.path.isfile(self.path): self._save()   # the PIN stays the same after a restart
        self.srv = None
        self.lan_error = ''
        self.tun = None
        self.tun_state = {'state': 'off', 'url': '', 'error': ''}
        self.fails = {}          # ip -> [count, blocked_until]
        self.lock = threading.Lock()

    # ------------------------------------------------------------ settings
    def _load(self):
        try:
            with open(self.path, encoding='utf-8') as f: c = json.load(f)
        except (OSError, ValueError): c = {}
        c.setdefault('pin', f'{secrets.randbelow(10**6):06d}')
        c.setdefault('secret', secrets.token_hex(16))
        c.setdefault('lan', False); c.setdefault('tunnel', False); c.setdefault('port', PORT)
        return c

    def _save(self):
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(self.cfg, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def token(self):
        return hmac.new(self.cfg['secret'].encode(), self.cfg['pin'].encode(), hashlib.sha256).hexdigest()[:40]

    def new_pin(self):
        self.cfg['pin'] = f'{secrets.randbelow(10**6):06d}'; self._save()   # signs every phone out

    # ------------------------------------------------------------ PIN check with a brake on guessing
    def authorized(self, cookie_header):
        for part in (cookie_header or '').split(';'):
            k, _, v = part.strip().partition('=')
            if k == 'kp_auth' and hmac.compare_digest(v, self.token()): return True
        return False

    def login(self, ip, pin):
        """(ok, error): 5 wrong PINs from one address lock it for a minute, 30 from anywhere lock all for 10 minutes."""
        now = time.time()
        with self.lock:
            g = self.fails.setdefault('*', [0, 0]); f = self.fails.setdefault(ip, [0, 0])
            if g[1] > now or f[1] > now:
                return False, f'Забагато спроб. Спробуйте через {int(max(g[1], f[1]) - now) + 1} с.'
            if hmac.compare_digest(str(pin or '').strip(), self.cfg['pin']):
                f[0] = 0; return True, ''
            f[0] += 1; g[0] += 1
            if f[0] >= 5: f[0], f[1] = 0, now + 60
            if g[0] >= 30: g[0], g[1] = 0, now + 600
            return False, 'Неправильний PIN'

    # ------------------------------------------------------------ the Wi‑Fi entrance
    def start_lan(self):
        if self.srv: return True
        from http.server import ThreadingHTTPServer
        try: self.srv = ThreadingHTTPServer(('0.0.0.0', int(self.cfg['port'])), self.handler_cls)
        except OSError as e:
            self.lan_error = f'Порт {self.cfg["port"]} зайнятий або недоступний: {e}'; return False
        self.lan_error = ''
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return True

    def stop_lan(self):
        if self.srv:
            s, self.srv = self.srv, None
            threading.Thread(target=lambda: (s.shutdown(), s.server_close()), daemon=True).start()

    # ------------------------------------------------------------ HTTPS through Cloudflare
    def _cloudflared(self, download=True):
        exe = 'cloudflared.exe' if os.name == 'nt' else 'cloudflared'
        local = os.path.join(self.bin_dir, exe)
        if os.path.isfile(local): return local
        found = shutil.which('cloudflared')
        if found: return found
        name = CLOUDFLARED.get(platform.system())
        if not download or not name or platform.machine().lower() not in ('amd64', 'x86_64'):
            raise RuntimeError('Не знайдено cloudflared: встановіть його з https://github.com/cloudflare/cloudflared/releases')
        os.makedirs(self.bin_dir, exist_ok=True)
        self.tun_state.update(state='download', error='')
        tmp = local + '.part'
        with urlopen(DL + name, timeout=60) as r, open(tmp, 'wb') as f: shutil.copyfileobj(r, f)
        if os.path.getsize(tmp) < 5_000_000: os.remove(tmp); raise RuntimeError('cloudflared завантажився не повністю')
        os.replace(tmp, local)
        if os.name != 'nt': os.chmod(local, 0o755)
        return local

    def start_tunnel(self):
        if self.tun and self.tun.poll() is None: return
        self.tun_state = {'state': 'start', 'url': '', 'error': ''}
        threading.Thread(target=self._run_tunnel, daemon=True).start()

    def _run_tunnel(self):
        try:
            exe = self._cloudflared()
            self.tun_state['state'] = 'start'
            flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            p = subprocess.Popen([exe, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{self.cfg["port"]}'],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors='replace', creationflags=flags)
            self.tun = p
            last = ''
            for line in p.stderr:
                if ' ERR ' in line or line.startswith('failed'): last = line.strip()[-200:]
                m = TUNNEL_RE.search(line)
                if m and not self.tun_state['url']:
                    self.tun_state.update(state='on', url=m.group(0))
                    sys.stderr.write(f'Адреса для телефону через інтернет: {m.group(0)}\n')
            if self.tun is p:   # stopped by itself, not by «вимкнути»
                self.tun_state.update(state='off', url='', error='cloudflared зупинився: перевірте інтернет на комп’ютері і ввімкніть ще раз' + (f' ({last})' if last else ''))
        except Exception as e:  # noqa: BLE001
            self.tun_state.update(state='off', url='', error=str(e))

    def stop_tunnel(self):
        p, self.tun = self.tun, None
        if p and p.poll() is None:
            p.terminate()
            try: p.wait(5)
            except subprocess.TimeoutExpired: p.kill()
        self.tun_state = {'state': 'off', 'url': '', 'error': ''}

    # ------------------------------------------------------------ state for the «Телефон» window
    def apply(self, body):
        if body.get('new_pin'): self.new_pin()
        if 'lan' in body: self.cfg['lan'] = bool(body['lan'])
        if 'tunnel' in body: self.cfg['tunnel'] = bool(body['tunnel'])
        if self.cfg['tunnel']: self.cfg['lan'] = True     # the tunnel goes through the Wi‑Fi entrance
        self._save()
        self.sync()

    def sync(self):
        if self.cfg['lan']:
            if not self.start_lan(): self.cfg['lan'] = self.cfg['tunnel'] = False
        else: self.stop_lan()
        if self.cfg['tunnel']: self.start_tunnel()
        else: self.stop_tunnel()

    def info(self):
        port = int(self.cfg['port'])
        return dict(lan=bool(self.srv), lan_error=self.lan_error, port=port, pin=self.cfg['pin'],
                    urls=[f'http://{ip}:{port}/' for ip in lan_ips()], tunnel=dict(self.tun_state, want=self.cfg['tunnel']))

    def shutdown(self):
        self.stop_tunnel(); self.stop_lan()


def lan_ips():
    """Addresses of this PC in the local network (Wi‑Fi / cable), the default route first."""
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); out.append(s.getsockname()[0]); s.close()
    except OSError: pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in out: out.append(ip)
    except OSError: pass
    return [ip for ip in out if not ip.startswith(('127.', '169.254.', '0.'))]
