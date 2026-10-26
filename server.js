'use strict';
/*
 * Tersine — oyun sunucusu
 *   node server.js            → aynı Wi-Fi'daki cihazlar katılabilir
 *   node server.js --internet → Cloudflare tüneli açılır, her yerden katılınabilir
 *
 * Gizlilik kuralı: söyleyenin ORİJİNAL kaydı sunucuya hiç gelmez.
 * Telefon kaydı kendi içinde ters çevirir ve yalnızca ters halini yollar.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
let qr = null;
try { qr = require('qrcode-terminal'); } catch (e) { /* QR isteğe bağlı */ }

const PORT = parseInt(process.env.PORT, 10) || 3000;
const INTERNET = process.argv.includes('--internet') || process.env.TUNNEL === '1';
const PUBLIC = path.join(__dirname, 'public');
const COLORS = ['#ff4d6d', '#5b4dff', '#19b394', '#ff8a3d', '#2fa4ff', '#c04bd6', '#d4a000', '#00a3a3'];
const CODE_CH = 'ABCDEFGHJKMNPRSTUVYZ23456789';
const MAX_CLIP = 600 * 1024;   // tek ses kaydı (wav) en fazla
const MAX_TRIES = 3;           // tahmin hakkı
const POINTS = [3, 2, 1];      // 1., 2., 3. denemede bilene
const MAX_PLAYERS = 12;
const MAX_ROOMS = 200;
const MAX_VOICE = 8;
const EMPTY_ROOM_TTL = 2 * 60 * 60 * 1000;
const HOST_AWAY_MS = 30 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

/* ---------------- Kelimeler ---------------- */
const WORDS = {
  kolay: ['elma', 'kedi', 'masa', 'kalem', 'kapı', 'ayna', 'saat', 'gemi', 'uçak', 'balık', 'kuzu', 'ördek', 'limon',
    'çilek', 'simit', 'çanta', 'yastık', 'terlik', 'bardak', 'tabak', 'kaşık', 'çatal', 'bulut', 'yıldız', 'deniz',
    'orman', 'tavuk', 'aslan', 'kaplan', 'maymun', 'tavşan', 'lamba', 'perde', 'koltuk', 'sabun', 'havlu', 'kitap',
    'defter', 'silgi', 'makas', 'çorap', 'şapka', 'karpuz', 'kiraz', 'üzüm', 'peynir', 'zeytin', 'ekmek', 'çorba',
    'sincap', 'kirpi', 'timsah', 'gitar', 'davul', 'kamyon', 'tren', 'köprü', 'kale', 'bahçe', 'çiçek'],
  orta: ['araba', 'telefon', 'pencere', 'şemsiye', 'merdiven', 'kurbağa', 'zürafa', 'eldiven', 'salata', 'makarna',
    'patates', 'domates', 'portakal', 'dondurma', 'tencere', 'bisiklet', 'kelebek', 'penguen', 'papağan', 'örümcek',
    'karınca', 'hamburger', 'otobüs', 'piyano', 'keman', 'futbolcu', 'uçurtma', 'dinozor', 'hastane', 'patlıcan',
    'ananas', 'baklava', 'lahmacun', 'kurabiye', 'battaniye', 'tornavida', 'sandalye', 'kalemlik', 'yumurta',
    'kanepe', 'kamera', 'gazete', 'paraşüt', 'balina', 'yunus', 'ahtapot', 'kaktüs', 'mantar', 'pamuk', 'sihirbaz'],
  zor: ['buzdolabı', 'bilgisayar', 'çikolata', 'televizyon', 'helikopter', 'kaplumbağa', 'ayakkabı', 'gökkuşağı',
    'denizaltı', 'hipopotam', 'astronot', 'kütüphane', 'salatalık', 'mandalina', 'karnabahar', 'çamaşırhane',
    'gökdelen', 'süpermarket', 'itfaiyeci', 'hamamböceği', 'uğurböceği', 'deniz kızı', 'kardan adam', 'ateşböceği',
    'akordeon', 'trampolin', 'buzdağı', 'yanardağ', 'portakal suyu', 'diş fırçası', 'çamaşır makinesi',
    'kırmızı başlıklı kız', 'elektrik süpürgesi', 'bulaşık makinesi', 'satranç tahtası', 'gözlükçü'],
};
WORDS.karisik = [...WORDS.kolay, ...WORDS.orta, ...WORDS.zor];
const DIFFS = Object.keys(WORDS);

const rooms = new Map();
const log = (...a) => console.log(new Date().toLocaleTimeString('tr-TR'), '·', ...a);

/* ---------------- HTTP: sayfa + ses kayıtları ---------------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }

  const m = u.pathname.match(/^\/room\/([A-Z0-9]{4})\/a\/([a-f0-9]{16})$/);
  if (m) {
    const r = rooms.get(m[1]);
    const clip = r && r.audio.get(m[2]);
    if (!clip) { res.writeHead(404); return res.end('Ses yok'); }
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600', 'Content-Length': clip.length });
    return res.end(clip);
  }
  if (u.pathname === '/ice') {
    const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URLS) {
      ice.push({
        urls: process.env.TURN_URLS.split(',').map((x) => x.trim()).filter(Boolean),
        username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '',
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: ice }));
  }
  if (u.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  let rel;
  try { rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, ''); }
  catch (e) { res.writeHead(400); return res.end(); }
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Bulunamadı'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

/* ---------------- Yardımcılar ---------------- */
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
// Karşılaştırma için: küçük harf, Türkçe karakterler sadeleşir, boşluk ve noktalama gider ("Köpek" = "kopek")
const norm = (s) => String(s || '').toLocaleLowerCase('tr').normalize('NFC').replace(/i̇/g, 'i')
  .replace(/[çğıöşüâîû]/g, (c) => TR[c]).replace(/[^a-z]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const pick = (arr, n) => { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };

function genCode() {
  for (let i = 0; i < 100; i++) {
    let s = '';
    for (let j = 0; j < 4; j++) s += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
    if (!rooms.has(s)) return s;
  }
  return null;
}
function sendTo(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function broadcast(room, o) {
  const s = JSON.stringify(o);
  for (const p of room.players.values()) for (const ws of p.conns) if (ws.readyState === 1) ws.send(s);
}

// Her oyuncuya kendi görebileceği durum gider: gizli kelime sadece söyleyene, tur bitince herkese
function snapshot(room, pid) {
  const T = room.turn;
  let turn = null;
  if (T) {
    const isSp = pid === T.speaker, open = T.phase === 'reveal';
    turn = {
      no: T.no, speaker: T.speaker, listener: T.listener, phase: T.phase,
      options: isSp && T.phase === 'pick' ? T.options : null,
      word: isSp || open ? T.word : null,
      len: T.word ? [...T.word].map((c) => (c === ' ' ? ' ' : '_')).join('') : null,
      rev: T.rev, imits: T.imits, guesses: T.guesses, tries: T.tries, maxTries: MAX_TRIES,
      rec: T.rec, result: T.result, pts: T.pts,
    };
  }
  return {
    t: 'state', code: room.code, host: room.host, status: room.status, settings: room.settings,
    total: room.order.length * room.settings.laps, now: Date.now(),
    players: [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, online: p.conns.size > 0 })),
    turn,
  };
}
function pushState(room) {
  for (const p of room.players.values()) {
    if (!p.conns.size) continue;
    const s = JSON.stringify(snapshot(room, p.id));
    for (const ws of p.conns) if (ws.readyState === 1) ws.send(s);
  }
}
const voiceList = (room) => [...room.voice.values()];
const pushVoice = (room) => broadcast(room, { t: 'voice', list: voiceList(room) });
const online = (room, id) => { const p = room.players.get(id); return !!(p && p.conns.size); };

function passHost(room) {
  const cand = [...room.players.values()]
    .filter((p) => p.conns.size && p.id !== room.host)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (cand) { room.host = cand.id; room.hostAway = 0; log(`Oda ${room.code}: yeni kurucu ${cand.name}`); return true; }
  return false;
}

/* ---------------- Tur akışı ----------------
 * pick   : söyleyen gizli kelimeyi seçer (3 öneri ya da kendi kelimesi)
 * record : söyleyen kaydeder; telefon ters çevirip SADECE ters halini yollar
 * guess  : tahmin eden ters sesi dinler, taklit eder, taklidi tersine çevrilir, tahmin eder
 * reveal : kelime açıklanır, herkes ses zincirini dinler
 */
function startGame(room) {
  room.order = [...room.players.values()].filter((p) => p.conns.size).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.id);
  if (room.order.length < 2) return false;
  for (const p of room.players.values()) p.score = 0;
  room.status = 'playing';
  beginTurn(room, 0);
  log(`Oda ${room.code}: oyun başladı (${room.order.length} oyuncu, ${room.settings.laps} tur)`);
  return true;
}

function beginTurn(room, no) {
  room.audio.clear();
  const n = room.order.length, total = n * room.settings.laps;
  // Bağlı olmayan söyleyenleri atla
  while (no < total && !online(room, room.order[no % n])) no++;
  if (no >= total) {
    room.status = 'done'; room.turn = null;
    log(`Oda ${room.code}: oyun bitti`);
    return pushState(room);
  }
  const speaker = room.order[no % n];
  let listener = null;
  for (let k = 1; k < n; k++) { const id = room.order[(no + k) % n]; if (online(room, id)) { listener = id; break; } }
  if (!listener) listener = room.order[(no + 1) % n];
  room.turn = {
    no, speaker, listener, phase: 'pick', options: pick(WORDS[room.settings.diff] || WORDS.karisik, 3),
    word: null, rev: null, imits: [], guesses: [], tries: 0, rec: null, result: null, pts: 0,
  };
  pushState(room);
}

function finishTurn(room, result) {
  const T = room.turn;
  T.phase = 'reveal'; T.result = result; T.rec = null;
  if (result === 'ok') {
    T.pts = POINTS[T.tries - 1] || 1;
    const li = room.players.get(T.listener), sp = room.players.get(T.speaker);
    if (li) li.score += T.pts;
    if (sp) sp.score += 1;
  }
  if (!T.word) { room.audio.clear(); return beginTurn(room, T.no + 1); } // kelime bile seçilmeden geçildiyse doğrudan sıradaki tura
  pushState(room);
}

function storeClip(room, data) {
  const mm = typeof data === 'string' && data.match(/^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/);
  if (!mm) return null;
  const buf = Buffer.from(mm[1], 'base64');
  if (buf.length < 100 || buf.length > MAX_CLIP || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  const id = crypto.randomBytes(8).toString('hex');
  room.audio.set(id, buf);
  return id;
}

function attach(ws, room) {
  detach(ws, false);
  let p = room.players.get(ws.pid);
  if (!p) {
    if (room.players.size >= MAX_PLAYERS) return sendTo(ws, { t: 'error', code: 'full', msg: 'Oda dolu' });
    const used = new Set([...room.players.values()].map((x) => x.color));
    const color = COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length];
    p = { id: ws.pid, name: ws.name, color, score: 0, joinedAt: Date.now(), conns: new Set() };
    room.players.set(p.id, p);
    // Oyun sürerken gelen, sıradaki turlara eklenir
    if (room.status === 'playing' && !room.order.includes(p.id)) room.order.push(p.id);
    log(`Oda ${room.code}: ${p.name} katıldı`);
  }
  p.name = ws.name || p.name;
  p.conns.add(ws);
  ws.room = room.code;
  room.emptySince = null;
  pushState(room);
  sendTo(ws, { t: 'voice', list: voiceList(room) });
}

function detach(ws, explicit) {
  const room = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!room) return;
  if (room.voice.delete(ws.cid)) pushVoice(room);
  const p = room.players.get(ws.pid);
  if (p) {
    p.conns.delete(ws);
    if (p.conns.size === 0) {
      if (room.turn && room.turn.rec === p.id) room.turn.rec = null;
      if (explicit) {
        if (room.host === p.id) passHost(room);
        if (room.status === 'lobby' && room.host !== p.id) room.players.delete(p.id);
        log(`Oda ${room.code}: ${p.name} ayrıldı`);
      }
    }
  }
  if (![...room.players.values()].some((x) => x.conns.size)) room.emptySince = Date.now();
  pushState(room);
}

/* ---------------- Mesajlar ---------------- */
function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'ping') return;
  if (m.t === 'hello') {
    if (typeof m.id === 'string' && /^[a-z0-9]{20}$/.test(m.id)) ws.pid = m.id;
    ws.name = clean(m.name, 14) || 'Oyuncu';
    return sendTo(ws, { t: 'welcome', cid: ws.cid });
  }
  if (!ws.pid) return sendTo(ws, { t: 'error', msg: 'Bağlantı henüz hazır değil' });
  if (typeof m.name === 'string') ws.name = clean(m.name, 14) || ws.name;

  switch (m.t) {
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return sendTo(ws, { t: 'error', msg: 'Sunucuda çok fazla oda var' });
      const code = genCode();
      if (!code) return sendTo(ws, { t: 'error', msg: 'Oda kodu üretilemedi' });
      const r = {
        code, host: ws.pid, hostAway: 0, status: 'lobby', settings: { diff: 'karisik', laps: 1 },
        players: new Map(), order: [], turn: null, audio: new Map(), voice: new Map(),
        emptySince: null, created: Date.now(),
      };
      rooms.set(code, r);
      log(`Oda ${code} kuruldu`);
      return attach(ws, r);
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return sendTo(ws, { t: 'error', code: 'noroom', msg: 'Bu kodla bir oda bulunamadı' });
      return attach(ws, r);
    }
    case 'leave':
      return detach(ws, true);
  }

  const room = ws.room && rooms.get(ws.room);
  const me = room && room.players.get(ws.pid);
  if (!room || !me) return;
  const T = room.turn;
  const isHost = room.host === me.id;

  switch (m.t) {
    case 'settings':
      if (!isHost || room.status !== 'lobby') return;
      if (DIFFS.includes(m.diff)) room.settings.diff = m.diff;
      if ([1, 2, 3].includes(m.laps)) room.settings.laps = m.laps;
      return pushState(room);

    case 'start':
      if (!isHost || room.status !== 'lobby') return;
      if (!startGame(room)) sendTo(ws, { t: 'error', msg: 'Başlamak için en az 2 kişi lazım' });
      return;

    case 'rematch':
      if (!isHost || room.status !== 'done') return;
      if (!startGame(room)) sendTo(ws, { t: 'error', msg: 'Başlamak için en az 2 kişi lazım' });
      return;

    case 'tolobby':
      if (!isHost || room.status === 'lobby') return;
      room.status = 'lobby'; room.turn = null; room.audio.clear();
      for (const [id, p] of room.players) if (!p.conns.size) room.players.delete(id);
      return pushState(room);

    case 'pick': {
      if (!T || T.phase !== 'pick' || T.speaker !== me.id) return;
      let w = clean(m.word, 24).toLocaleLowerCase('tr').replace(/\s+/g, ' ');
      if (!T.options.includes(w)) {
        if (!/^[a-zçğıöşüâîû ]+$/.test(w) || norm(w).length < 2) return sendTo(ws, { t: 'error', msg: 'Sadece harflerden oluşan bir kelime yaz' });
      }
      T.word = w; T.phase = 'record';
      return pushState(room);
    }

    case 'rec': // biri kelime mikrofonuyla kayıt yapıyor: herkeste göster
      if (!T || (T.phase === 'record' ? T.speaker : T.phase === 'guess' ? T.listener : null) !== me.id) return;
      T.rec = m.on ? me.id : null;
      return pushState(room);

    case 'rev': { // söyleyenin TERS çevrilmiş kaydı
      if (!T || T.phase !== 'record' || T.speaker !== me.id) return;
      const id = storeClip(room, m.audio);
      if (!id) return sendTo(ws, { t: 'error', msg: 'Ses kaydı gönderilemedi, tekrar dene' });
      T.rev = id; T.rec = null; T.phase = 'guess';
      return pushState(room);
    }

    case 'imit': { // tahmin edenin taklidi (olduğu gibi; ters çevirmeyi herkesin telefonu yapar)
      if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
      const id = storeClip(room, m.audio);
      if (!id) return sendTo(ws, { t: 'error', msg: 'Ses kaydı gönderilemedi, tekrar dene' });
      for (const old of T.imits.splice(0, Math.max(0, T.imits.length - 2))) room.audio.delete(old.id); // son 3 deneme kalsın
      T.imits.push({ id, at: Date.now() });
      return pushState(room);
    }

    case 'guess': {
      if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
      const text = clean(m.text, 30);
      const g = norm(text), w = norm(T.word);
      if (!g) return;
      T.tries++;
      const ok = g === w;
      T.guesses.push({ text, ok, close: !ok && w.length >= 4 && lev(g, w) <= 1 });
      if (ok) return finishTurn(room, 'ok');
      if (T.tries >= MAX_TRIES) return finishTurn(room, 'fail');
      return pushState(room);
    }

    case 'giveup':
      if (!T || T.phase !== 'guess' || T.listener !== me.id) return;
      return finishTurn(room, 'fail');

    case 'skip': // kurucu, takılan turu geçer
      if (!isHost || !T || T.phase === 'reveal') return;
      return finishTurn(room, 'skip');

    case 'next':
      if (!T || T.phase !== 'reveal') return;
      if (!isHost && me.id !== T.speaker && me.id !== T.listener) return;
      return beginTurn(room, T.no + 1);

    case 'voice': {
      if (m.on) {
        if (room.voice.size >= MAX_VOICE && !room.voice.has(ws.cid)) return sendTo(ws, { t: 'error', msg: 'Sesli sohbet dolu (en fazla ' + MAX_VOICE + ' kişi)' });
        room.voice.set(ws.cid, { cid: ws.cid, pid: me.id, muted: !!m.muted });
      } else room.voice.delete(ws.cid);
      return pushVoice(room);
    }

    case 'rtc': {
      if (typeof m.to !== 'string' || !room.voice.has(ws.cid) || !room.voice.has(m.to)) return;
      if (JSON.stringify(m.data || null).length > 20000) return;
      for (const p of room.players.values()) for (const c of p.conns) {
        if (c.cid === m.to) return sendTo(c, { t: 'rtc', from: ws.cid, data: m.data });
      }
      return;
    }
  }
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });
wss.on('connection', (ws) => {
  ws.cid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf); } catch (e) { return; }
    try { handle(ws, msg); } catch (e) { console.error('Mesaj işlenemedi:', e); }
  });
  ws.on('close', () => detach(ws, false));
  ws.on('error', () => {});
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* yoksay */ }
  });
}, 20000);

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.emptySince && now - r.emptySince > EMPTY_ROOM_TTL) { rooms.delete(code); log(`Oda ${code} kapatıldı (boş)`); continue; }
    const h = r.players.get(r.host);
    if (h && h.conns.size) { r.hostAway = 0; continue; }
    if (!r.hostAway) r.hostAway = now;
    else if (now - r.hostAway > HOST_AWAY_MS && passHost(r)) pushState(r);
  }
}, 10000);

/* ---------------- Başlangıç ---------------- */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}
function showUrl(title, url) {
  console.log(`\n  ${title}\n  👉 ${url}\n`);
  if (qr) qr.generate(url, { small: true }, (s) => console.log(s.split('\n').map((l) => '  ' + l).join('\n')));
}

function startTunnel() {
  const bin = process.env.CLOUDFLARED || 'cloudflared';
  console.log('  İnternet tüneli açılıyor (Cloudflare)…');
  let found = false;
  const cp = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    if (found) return;
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      found = true;
      showUrl('🌍 HERKES İÇİN BAĞLANTI (farklı Wi-Fi / mobil veri):', m[0]);
      console.log('  Bu bağlantıyı arkadaşlarına gönder. Pencereyi kapatma; kapatınca oyun da kapanır.\n');
    }
  };
  cp.stdout.on('data', onData);
  cp.stderr.on('data', onData);
  cp.on('error', () => {
    console.log(
      '\n  ⚠️  cloudflared bulunamadı. İnternet bağlantısı için bir kez kurman gerekiyor:\n' +
      '     Windows : winget install --id Cloudflare.cloudflared\n' +
      '     macOS   : brew install cloudflared\n' +
      '     Linux   : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
      '  Kurduktan sonra terminali kapatıp yeniden aç ve tekrar başlat.\n'
    );
  });
  cp.on('exit', (code) => { if (found) log(`Tünel kapandı (kod ${code})`); });
  const stop = () => { try { cp.kill(); } catch (e) { /* yoksay */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ❌ ${PORT} numaralı port kullanımda. Başka bir port dene:  PORT=3001 node server.js\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🔁 Tersine sunucusu çalışıyor\n');
  console.log(`  Bu bilgisayarda:  http://localhost:${PORT}`);
  const ips = lanAddresses();
  if (ips.length) showUrl('📶 AYNI WI-FI\'DAKİ CİHAZLAR İÇİN:', `http://${ips[0]}:${PORT}`);
  if (ips.length > 1) console.log('  Diğer yerel adresler: ' + ips.slice(1).map((ip) => `http://${ip}:${PORT}`).join('  ') + '\n');
  if (INTERNET) startTunnel();
  else console.log('  ⚠️  Mikrofon yalnızca https adreslerde çalışır. Arkadaşlarla oynamak için internet modunu (internet.bat) ya da Render\'ı kullan.\n');
  console.log('  Durdurmak için: Ctrl + C\n');
});
