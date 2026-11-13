# ESP32 API

Простий Express-сервер на порту **2500**, доступний на всіх мережевих інтерфейсах (`0.0.0.0`).

## Запуск

```powershell
cd D:\dryspell\iot
npm install
npm start
```

Для автоматичного перезапуску після змін: `npm run dev`.

## Запуск на Linux і логи

Потрібні встановлені Node.js і npm (для сервера рекомендовано Node.js 24 LTS).
Скопіюй папку `iot` на Linux без `node_modules`.
Заміни `/path/to/iot` на свій шлях:

```bash
cd /path/to/iot
npm ci
npm start
```

Сервер слухає порт **2500**. Запити, запуск і помилки одночасно виводяться в консоль
та дописуються у `iot/logs/esp32.log`. Папка створюється автоматично поруч із `server.js`,
незалежно від поточної робочої папки. Кожен запис — один рядок JSON із часом у UTC.
Після перезапуску попередні записи зберігаються.

В іншому терміналі переглядай останні 100 рядків і нові записи в реальному часі:

```bash
cd /path/to/iot
tail -n 100 -F logs/esp32.log
```

`Ctrl+C` у терміналі з `tail` зупиняє лише перегляд. `Ctrl+C` у терміналі з `npm start` зупиняє сервер.

Перевірка з іншого термінала:

```bash
curl 'http://localhost:2500/api/esp32?device=esp32&temperature=24.5'
curl 'http://localhost:2500/api/esp32?device=esp32' \
  -H 'Content-Type: application/json' \
  -d '{"temperature":24.5,"humidity":60}'
```

## Ubuntu: автозапуск через systemd

Готовий файл служби: [`esp32-api.service`](esp32-api.service).
Нижче використано шлях `/opt/esp32-api`. Окремого користувача створювати не потрібно:
у файлі немає `User=` і `Group=`, тому системна служба запускається від `root`
(не від користувача поточного SSH-сеансу).
Служба запускається під час завантаження Ubuntu, перезапускається після збою
через 5 секунд і записує логи в journal та `/opt/esp32-api/logs/esp32.log`.

HTTP та WebSocket уже працюють через один сервер на **`0.0.0.0:2500`**:

- HTTP API: `http://SERVER_IP:2500/api/esp32`;
- сторінка логів: `http://SERVER_IP:2500/`;
- WebSocket: `ws://SERVER_IP:2500/ws`.

Заміни `SERVER_IP` на публічну IPv4-адресу сервера. Окремий порт для WS не потрібен.

### 1. Встанови Node.js

Якщо Node.js 24 уже встановлений системно, пропусти встановлення. Інакше встанови
його з репозиторію [NodeSource](https://github.com/nodesource/distributions/blob/master/DEV_README.md):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/esp32-nodesource-setup.sh
sudo bash /tmp/esp32-nodesource-setup.sh
sudo apt-get install -y nodejs
/usr/bin/node --version
/usr/bin/npm --version
```

Файл служби використовує `/usr/bin/node`. Якщо системний Node.js установлений,
наприклад, у `/usr/local/bin/node`, зміни `ExecStart` у файлі служби перед копіюванням.
Node.js із `nvm` у домашній папці користувача цій службі недоступний через `ProtectHome=true`;
для наведеного налаштування потрібна системна інсталяція.
Підтримувані версії: [Node.js Releases](https://nodejs.org/en/about/previous-releases).

### 2. Розмісти проєкт

Склонуй [репозиторій dryspell](https://github.com/chillchirill/dryspell) на Ubuntu.
Якщо він уже є у `~/dryspell`, пропусти `git clone`.
Залежності встановлюй на самому сервері; Windows-папку `node_modules` переносити не потрібно.

```bash
git clone https://github.com/chillchirill/dryspell.git ~/dryspell
cd ~/dryspell/iot
npm ci --omit=dev

sudo install -d -m 0755 /opt/esp32-api
sudo install -m 0644 server.js package.json package-lock.json /opt/esp32-api/
sudo cp -R static node_modules /opt/esp32-api/
sudo chmod -R a+rX /opt/esp32-api/static /opt/esp32-api/node_modules
sudo install -d -m 0750 /opt/esp32-api/logs
```

Папка `logs` має існувати до запуску служби. Це дозволений для запису шлях
при `ProtectSystem=strict`; код і залежності належать `root`.

### 3. Установи й запусти службу

З папки `~/dryspell/iot` виконай:

```bash
sudo install -m 0644 esp32-api.service /etc/systemd/system/esp32-api.service
sudo systemd-analyze verify /etc/systemd/system/esp32-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now esp32-api
sudo systemctl restart esp32-api
sudo systemctl status esp32-api --no-pager
```

`restart` застосовує оновлений файл служби, якщо вона вже була запущена.

Якщо раніше запускав `npm start`, зупини той процес перед запуском служби,
щоб звільнити порт 2500. Для зміни шляху проєкту узгоджено зміни
`WorkingDirectory`, шлях до `server.js` в `ExecStart` і `ReadWritePaths`.
Параметри служби описані в [документації systemd](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).

### 4. Дозволь вхідні підключення на TCP 2500

Якщо на сервері використовується UFW:

```bash
sudo ufw allow 2500/tcp
sudo ufw status
```

Якщо UFW показує `inactive`, він зараз не фільтрує трафік. Для відкриття цього
порту вмикати його не потрібно. Також дозволь **вхідний TCP 2500** у firewall / security group
панелі хостингу. Для сервера за роутером потрібне перенаправлення TCP 2500 на цей сервер.
Правила UFW: [документація Ubuntu](https://ubuntu.com/server/docs/how-to/security/firewalls/).

### 5. Перевір HTTP і WebSocket

На сервері:

```bash
sudo ss -ltnp 'sport = :2500'
curl --fail 'http://127.0.0.1:2500/api/esp32?device=test&temperature=24.5'
```

Має бути прослуховування `0.0.0.0:2500` та JSON-відповідь з `ok: true`.
На іншому комп'ютері відкрий `http://SERVER_IP:2500/`: статус має стати `Connected`.
Залиш сторінку відкритою та надішли запит з іншого термінала:

```bash
curl --fail 'http://SERVER_IP:2500/api/esp32?device=test' \
  -H 'Content-Type: application/json' \
  -d '{"temperature":24.5,"humidity":60}'
```

Новий JSON-запис має з'явитися у браузері без оновлення сторінки — це перевіряє
доставку через WebSocket. На Windows використовуй `curl.exe` замість `curl`.
Пряме підключення до цього сервера використовує `http://` та `ws://`.
Для `https://` / `wss://` потрібен TLS, наприклад reverse proxy з підтримкою
WebSocket Upgrade; сам `.service` файл HTTPS не додає.

Керування службою й перегляд логів:

```bash
sudo journalctl -u esp32-api -n 100 -f
sudo systemctl restart esp32-api
sudo systemctl stop esp32-api
```

`Ctrl+C` під час перегляду journal зупиняє лише перегляд логів.
Після оновлення файлів проєкту в `/opt/esp32-api` перезапускай саме службу.

## Живі логи у браузері

Відкрий `http://localhost:2500/` на комп'ютері із сервером або
`http://<IP-комп'ютера>:2500/` з іншого пристрою. Сторінка також доступна на `/static/`.

- `static/index.html` — проста сторінка без оформлення, `static/app.js` — клієнт.
- Клієнт автоматично підключається до `ws://<поточний-хост>:2500/ws` (або `wss://` для HTTPS).
- Кожен новий запис від функції `log()` одночасно надсилається **всім підключеним клієнтам**,
  виводиться в консоль і дописується в `logs/esp32.log`.
- Кожне WebSocket-повідомлення — один JSON-об'єкт, такий самий, як рядок у файлі логів:

```json
{"time":"2026-11-13T14:00:00.000Z","event":"request","method":"POST","query":{"device":"esp32"},"body":{"temperature":24.5}}
```

Кожен новий JSON додається зверху як звичайний текст, повністю й без оформлення.
Кнопки «Connect» та «Disconnect» керують підпискою. Сторінка підключається при відкритті
та автоматично перепідключається після мережевого розриву. Ручне відключення скасовує
автоматичне перепідключення. Оновлення сторінки очищає екран.
Broadcast stateless: без сесій, підписок за ID, історії чи повторної доставки;
новий запис надсилається лише відкритим WebSocket-з'єднанням. Файл логів не використовується
для відновлення потоку після підключення.
Пропущені під час відключення записи автоматично не відтворюються — вони залишаються у файлі.

Після оновлення при ручному запуску на Linux виконай `npm ci` та перезапусти сервер
через `npm start`. Для systemd використовуй `sudo systemctl restart esp32-api`
після оновлення розгорнутих файлів і залежностей.

## Запити

`GET /api/esp32` та `POST /api/esp32` приймають довільні поля без обов'язкової схеми.
`query` і `body` виводяться окремо в консоль та повертаються у JSON-відповіді з `ok: true`.
Дані також дописуються у файл `logs/esp32.log`.

- JSON: об'єкти, масиви та прості значення; розпізнається навіть без `Content-Type`.
- Форми: `application/x-www-form-urlencoded`, включно з вкладеними полями.
- Текст та інші типи тіла: читаються як текст; некоректний JSON також зберігається як текст.
- Порожні запити дозволені. Ліміт тіла — 10 МБ.
- Повторені та вкладені query-параметри підтримуються.

GET з query:

```powershell
curl.exe "http://localhost:2500/api/esp32?device=esp32&temperature=24.5"
```

POST з query та JSON:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:2500/api/esp32?device=esp32' -ContentType 'application/json' -Body '{"temperature":24.5,"humidity":60}'
```

POST із полями форми:

```powershell
curl.exe -X POST "http://localhost:2500/api/esp32" -d "temperature=24.5&humidity=60"
```

Для ESP32 використовуй `http://<IP-комп'ютера>:2500/api/esp32` у спільній локальній мережі.

Опис використаних обробників тіла запиту: [документація Express](https://expressjs.com/en/5x/api/express/).
