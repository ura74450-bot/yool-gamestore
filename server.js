/**
 * yoll gamestore — server.js
 * Pure Node.js, zero external dependencies.
 * Слушает на 0.0.0.0 → доступен по локальной сети И на Render/Railway
 */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── Persistent DB ────────────────────────────────────────────────────────────
let db = { games: [], messages: {}, users: {} };
function loadDB() {
  try { if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  db.games    = db.games    || [];
  db.messages = db.messages || {};
  db.users    = db.users    || {};
}
function saveDB() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {}
}
loadDB();

// ── Connected WS clients ─────────────────────────────────────────────────────
const clients = new Map(); // socket → { userId, username, avatarData }

// ── HTTP ─────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS for APK / external clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const [urlPath] = req.url.split('?');

  if (urlPath.startsWith('/api/')) { handleAPI(req, res, urlPath); return; }

  // Static
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  const mimes = { '.html':'text/html;charset=utf-8','.js':'application/javascript',
    '.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimes[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

// ── REST API ─────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function convKey(a, b) { return [a, b].sort().join('::'); }

async function handleAPI(req, res, urlPath) {
  // GET /api/ping — health check for Render
  if (urlPath === '/api/ping') return json(res, { ok: true, ts: Date.now() });

  // GET /api/games
  if (urlPath === '/api/games' && req.method === 'GET') return json(res, db.games);

  // POST /api/games
  if (urlPath === '/api/games' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name) return json(res, { error: 'name required' }, 400);
    const g = { id: 'g_'+Date.now(), name: b.name, price: b.price ?? 0,
      emoji: b.emoji||'🎮', iconData: b.iconData||null, authorId: b.authorId,
      authorName: b.authorName, gameData: b.gameData||null,
      sales: 0, hours: 0, rating: (4.5+Math.random()*0.5).toFixed(1), createdAt: Date.now() };
    db.games.push(g); saveDB();
    broadcastAll({ type: 'new_game', game: g });
    return json(res, g);
  }

  // POST /api/game_play
  if (urlPath === '/api/game_play' && req.method === 'POST') {
    const b = await readBody(req);
    const g = db.games.find(x => x.id === b.gameId);
    if (g) { g.sales = (g.sales||0)+1; g.hours = +((g.hours||0)+(Math.random()*0.3)).toFixed(1); saveDB(); }
    return json(res, { ok: true });
  }

  // GET /api/messages?a=&b=
  if (urlPath === '/api/messages' && req.method === 'GET') {
    const p = Object.fromEntries((req.url.split('?')[1]||'').split('&').map(x=>x.split('=')));
    return json(res, db.messages[convKey(p.a, p.b)] || []);
  }

  // POST /api/messages
  if (urlPath === '/api/messages' && req.method === 'POST') {
    const b = await readBody(req);
    const k = convKey(b.fromId, b.toId);
    if (!db.messages[k]) db.messages[k] = [];
    const m = { fromId:b.fromId, fromName:b.fromName, toId:b.toId, text:b.text, time:b.time, ts:b.ts||Date.now() };
    db.messages[k].push(m);
    if (db.messages[k].length > 300) db.messages[k] = db.messages[k].slice(-300);
    saveDB();
    return json(res, m);
  }

  // GET /api/user?id=
  if (urlPath === '/api/user' && req.method === 'GET') {
    const p = Object.fromEntries((req.url.split('?')[1]||'').split('&').map(x=>x.split('=')));
    return json(res, db.users[p.id] || null);
  }

  // POST /api/user
  if (urlPath === '/api/user' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.userId) return json(res, { error: 'userId required' }, 400);
    db.users[b.userId] = { ...db.users[b.userId], ...b };
    saveDB();
    broadcastAll({ type: 'profile_update', user: db.users[b.userId] });
    return json(res, db.users[b.userId]);
  }

  // GET /api/users/search?q=
  if (urlPath === '/api/users/search' && req.method === 'GET') {
    const p = Object.fromEntries((req.url.split('?')[1]||'').split('&').map(x=>x.split('=').map(decodeURIComponent)));
    const q = (p.q||'').toLowerCase();
    const results = Object.values(db.users).filter(u => u.username && u.username.toLowerCase().includes(q));
    return json(res, results);
  }

  // GET /api/online — list of currently connected users
  if (urlPath === '/api/online' && req.method === 'GET') {
    const online = [...clients.values()].filter(c=>c.userId).map(c=>({ userId:c.userId, username:c.username }));
    return json(res, online);
  }

  json(res, { error: 'not found' }, 404);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');

  clients.set(socket, { userId: null, username: null, avatarData: null });
  let buf = Buffer.alloc(0);

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const frame = extractFrame();
      if (!frame) break;
      let msg; try { msg = JSON.parse(frame); } catch { continue; }
      handleWS(socket, msg);
    }
  });

  function extractFrame() {
    if (buf.length < 2) return null;
    const masked = !!(buf[1] & 0x80);
    let pLen = buf[1] & 0x7f, off = 2;
    if (pLen === 126) { if (buf.length < 4) return null; pLen = buf.readUInt16BE(2); off = 4; }
    else if (pLen === 127) { if (buf.length < 10) return null; pLen = Number(buf.readBigUInt64BE(2)); off = 10; }
    const total = off + (masked?4:0) + pLen;
    if (buf.length < total) return null;
    let maskB; if (masked) { maskB = buf.slice(off, off+4); off += 4; }
    let data = buf.slice(off, off+pLen);
    if (masked) { const d = Buffer.alloc(pLen); for (let i=0;i<pLen;i++) d[i]=data[i]^maskB[i%4]; data=d; }
    buf = buf.slice(total);
    const op = buf[0] & 0x0f; // Note: already sliced, use original b1
    return data.toString('utf8');
  }

  socket.on('close', () => {
    const info = clients.get(socket);
    if (info?.userId) broadcast({ type:'user_offline', userId:info.userId, username:info.username }, socket);
    clients.delete(socket);
  });
  socket.on('error', () => clients.delete(socket));
});

function handleWS(socket, msg) {
  const info = clients.get(socket);
  switch (msg.type) {
    case 'join': {
      if (!info) return;
      info.userId = msg.userId; info.username = msg.username; info.avatarData = msg.avatarData||null;
      if (!db.users[msg.userId]) db.users[msg.userId] = {};
      Object.assign(db.users[msg.userId], { userId:msg.userId, username:msg.username });
      if (msg.avatarData) db.users[msg.userId].avatarData = msg.avatarData;
      saveDB();
      // Send current state to new client
      wsSend(socket, { type:'init', games: db.games,
        onlineUsers: [...clients.values()].filter(c=>c.userId).map(c=>({userId:c.userId,username:c.username})) });
      broadcast({ type:'user_online', userId:msg.userId, username:msg.username, avatarData:msg.avatarData||null }, socket);
      break;
    }
    case 'chat_message': {
      if (!info?.userId) return;
      const payload = { type:'chat_message', fromId:info.userId, fromName:info.username,
        toId:msg.toId, text:msg.text,
        time: new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}), ts:Date.now() };
      // persist
      const k = convKey(info.userId, msg.toId);
      if (!db.messages[k]) db.messages[k]=[];
      db.messages[k].push({ fromId:payload.fromId,fromName:payload.fromName,toId:payload.toId,text:payload.text,time:payload.time,ts:payload.ts });
      if (db.messages[k].length>300) db.messages[k]=db.messages[k].slice(-300);
      saveDB();
      // deliver
      for (const [s,c] of clients) { if (c.userId===msg.toId) wsSend(s, payload); }
      wsSend(socket, { ...payload, echo:true });
      break;
    }
    case 'typing': {
      if (!info?.userId || !msg.toId) return;
      for (const [s,c] of clients) { if (c.userId===msg.toId) wsSend(s,{type:'typing',fromId:info.userId,fromName:info.username}); }
      break;
    }
  }
}

function wsSend(socket, data) {
  try {
    if (!socket.writable) return;
    const p = Buffer.from(JSON.stringify(data),'utf8'), len=p.length;
    let h;
    if (len<126) h=Buffer.from([0x81,len]);
    else if (len<65536) h=Buffer.from([0x81,126,(len>>8)&0xff,len&0xff]);
    else { h=Buffer.alloc(10); h[0]=0x81; h[1]=127; h.writeBigUInt64BE(BigInt(len),2); }
    socket.write(Buffer.concat([h,p]));
  } catch {}
}
function broadcast(data, excl) { for (const [s,c] of clients) { if (s!==excl&&c.userId) wsSend(s,data); } }
function broadcastAll(data) { for (const [s,c] of clients) { if (c.userId) wsSend(s,data); } }

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const os   = require('os');
  const nets = Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal);
  console.log('\n🎮  yoll gamestore запущен!\n');
  console.log(`    Локально:   http://localhost:${PORT}`);
  nets.forEach(n => console.log(`    По сети:    http://${n.address}:${PORT}`));
  if (process.env.RENDER_EXTERNAL_URL) console.log(`    Публично:   ${process.env.RENDER_EXTERNAL_URL}`);
  console.log('\n    Все люди в одной сети могут открыть ссылку "По сети" в браузере.\n');
});
