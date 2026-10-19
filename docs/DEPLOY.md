# Розгортання конструктора КП

Конструктор — один процес Node.js (API + веб-сторінка), який викликає Python-генератор: той робить PPTX,
а LibreOffice перетворює його на PDF. Усі дані — журнал КП, налаштування цін, згенеровані файли, кеш
зображень — лежать у теці `data`. Її і треба зберігати (див. «Резервні копії»).

Два варіанти:

- **А. VPS з Docker** (рекомендовано) — доступ звідусіль через https, з телефонів і ПК.
- **Б. Windows-ПК в офісі без Docker** — доступ лише в локальній мережі офісу (або через VPN).

## А. VPS з Docker

Потрібно: Ubuntu 22.04/24.04 або Debian 12, від 2 ГБ RAM (LibreOffice), 5 ГБ диска, домен
(наприклад `kp.example.com`) з A-записом на IP сервера.

```sh
curl -fsSL https://get.docker.com | sudo sh            # Docker + docker compose

git clone <адреса репозиторію> kp && cd kp
cp .env.example .env
openssl rand -hex 24                                   # згенерувати токен; так само другий
nano .env                                              # KP_ADMIN_TOKEN (обов’язково), KP_ACCESS_TOKEN
mkdir -p data && sudo chown 1000:1000 data             # сервіс у контейнері працює не від root (uid 1000)
sudo docker compose up -d --build
sudo docker compose ps                                 # STATUS має стати «healthy»
curl http://127.0.0.1:8080/api/health                  # {"ok":true,...}
```

Перша збірка образу триває 5–10 хв. Перша КП кожного крана генерується довше (креслення й фото),
наступні беруть зображення з кешу `data/kpgen-build`.

- Оновлення: `git pull && sudo docker compose up -d --build` — тека `data` не змінюється.
- Журнал сервера: `sudo docker compose logs -f --tail 100`.
- `KP_ACCESS_TOKEN` порожній — API відкритий для всіх, хто знає адресу. Для сервера в інтернеті задайте його.

### HTTPS через reverse proxy

Сам застосунок https не обслуговує — перед ним ставимо Caddy, він сам отримує й поновлює сертифікат
Let’s Encrypt.

1. У `.env` вкажіть `KP_HOST_PORT=127.0.0.1:8080` і виконайте `sudo docker compose up -d` — порт 8080 тепер
   доступний лише з самого сервера.
2. Встановіть Caddy і пропишіть домен:

   ```sh
   sudo apt install -y caddy
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   kp.example.com {
       encode gzip
       reverse_proxy 127.0.0.1:8080
   }
   EOF
   sudo systemctl reload caddy
   sudo ufw allow 80,443/tcp          # якщо увімкнено ufw
   ```

3. Адреса для менеджерів і Android-застосунку: `https://kp.example.com`.

Якщо на сервері вже є nginx: `sudo certbot --nginx -d kp.example.com`, а в `server { … }` для цього домену:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
}
```

## Б. Windows-ПК без Docker

1. Встановіть:
   - Node.js 22 LTS — <https://nodejs.org>;
   - Python 3.12 — <https://www.python.org> (у майстрі встановлення позначте «Add python.exe to PATH»);
   - LibreOffice — <https://www.libreoffice.org>;
   - Git for Windows — <https://git-scm.com> (потрібен Git Bash для збірки).
2. У Git Bash:

   ```sh
   git clone <адреса репозиторію> /c/kp && cd /c/kp
   python -m pip install python-pptx pillow numpy
   npm config set script-shell "C:\\Program Files\\Git\\bin\\bash.exe"   # скрипти збірки написані для bash
   npm install
   npm run build
   ```

3. Створіть файл `C:\kp\start-kp.cmd` (замініть `CHANGE_ME` на свій токен):

   ```bat
   @echo off
   cd /d C:\kp
   set PORT=8080
   set KP_DATA_DIR=C:\kp\data
   set KP_ADMIN_TOKEN=CHANGE_ME
   set KP_ACCESS_TOKEN=
   set KP_PYTHON=python
   set KPGEN_BUILD=C:\kp\data\kpgen-build
   set KPGEN_SOFFICE=C:\Program Files\LibreOffice\program\soffice.exe
   node build\server\src\main.js
   ```

4. Запустіть `start-kp.cmd` і відкрийте <http://localhost:8080>.
5. Доступ з телефонів і інших ПК офісу: `http://<IP цього ПК>:8080` (IP — команда `ipconfig`, «IPv4-адреса»).
   Мережа Wi‑Fi має бути «Приватна»; відкрийте порт (PowerShell від імені адміністратора):

   ```powershell
   New-NetFirewallRule -DisplayName "Konstruktor KP" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
   ```

   Закріпіть за ПК постійний IP у налаштуваннях роутера, інакше адреса в телефонах колись перестане працювати.
6. Автозапуск: «Планувальник завдань» → «Створити завдання» → «Виконувати для всіх користувачів», тригер
   «Під час запуску системи», дія — `C:\kp\start-kp.cmd`.
7. Оновлення: зупиніть сервер, у Git Bash `cd /c/kp && git pull && npm install && npm run build`, запустіть знову.

Без https (у локальній мережі) усе працює, крім офлайн-режиму веб-версії: браузери вмикають його лише на
https або localhost. Доступ ззовні без відкриття портів — через VPN, наприклад Tailscale (адреси 100.x.x.x
Android-застосунок пускає без https).

## Резервні копії

Копіювати треба теку `data` (журнал КП, налаштування, PDF/PPTX). `data/kpgen-build` — лише кеш, його можна
пропустити. Копію робіть при зупиненому сервері (кілька секунд), щоб файл журналу був цілісним, і тримайте
її не лише на тому самому сервері (інший ПК, хмара).

VPS, щоночі о 02:30, зберігати 30 днів (`sudo crontab -e`, шлях до теки `kp` — свій):

```cron
30 2 * * * cd /home/user/kp && docker compose stop kp && tar czf /var/backups/kp-$(date +\%F).tar.gz --exclude=data/kpgen-build data; docker compose start kp; find /var/backups -name 'kp-*.tar.gz' -mtime +30 -delete
```

Відновлення:

```sh
sudo docker compose down
mv data data.old && sudo tar xzf /var/backups/kp-2026-10-18.tar.gz
sudo chown -R 1000:1000 data
sudo docker compose up -d
```

Windows: закрийте вікно сервера, скопіюйте `C:\kp\data` (або
`robocopy C:\kp\data D:\backup\kp-data /MIR /XD kpgen-build`) і запустіть `start-kp.cmd` знову.
Відновлення — скопіювати теку назад при зупиненому сервері.
