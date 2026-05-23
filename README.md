# 🎮 yoll gamestore

Real-time игровой маркетплейс — чат, публикация игр, профили.

## Быстрый старт (локальная сеть)

```bash
node server.js
```
Открой в браузере любой телефон в той же Wi-Fi: `http://192.168.x.x:3000`

## Публичный сервер (интернет)

Смотри **КАК_СДЕЛАТЬ_APK.html** — там все инструкции:
- Render.com (бесплатно)
- Railway (бесплатно)
- APK через Capacitor
- WebAPK через Chrome (без кода!)

## Структура

```
yoll-gamestore/
├── index.html          — всё приложение
├── server.js           — Node.js WebSocket + HTTP + REST API  
├── data.json           — база данных (создаётся автоматически)
├── render.yaml         — конфиг для Render.com
├── package.json
└── КАК_СДЕЛАТЬ_APK.html — полная инструкция
```

## Смена сервера (для APK / облака)

В `index.html` найди строку:
```js
const SERVER_URL = '';
```
Замени на адрес твоего сервера:
```js
const SERVER_URL = 'https://yoll-gamestore.onrender.com';
```
