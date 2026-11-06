/* Zee Home: service kecil yang jalan DI monitor (TizenBrew serviceFile).
   - `tizen` ada sebagai global, `require` cuma buat modul bawaan Node (nggak ada npm).
   - Server HTTP di 127.0.0.1:8097, semua jawaban pake Access-Control-Allow-Origin: *
   Rute:
     GET /ping              -> {ok:true}
     GET /launch/<appId>    -> buka app (tizen.application.launch, cadangan launchAppControl)
     GET /key/<KEY_...>     -> kirim tombol remote ke monitor ini sendiri lewat websocket Samsung (port 8002)
     GET /power/off         -> cek status di port 8001 dulu, KEY_POWER cuma kalau statusnya "on"
   Tiket izin ("Allow") disimpen di memori + file kecil kalau ada tempat yang bisa ditulis.
   Tiketnya nggak pernah ditulis ke log. */
'use strict';

var http = require('http');
var tls = require('tls');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var os = require('os');

var PORT = 8097;
var HOST = '127.0.0.1';
var TV = '127.0.0.1';
var NAMA = 'Zee Home';
var APP_ID = /^[A-Za-z0-9._-]{1,64}$/;
var KEY = /^KEY_[A-Z0-9_]{1,32}$/;

function log() {
  var a = Array.prototype.slice.call(arguments);
  a.unshift('[zee-home]');
  try { console.log.apply(console, a); } catch (e) { /* abaikan */ }
}

// ---------- tiket izin ----------
var TEMPAT_TIKET = [
  '/home/owner/apps_rw/xvvl3S1bvH/data/zee-home/tiket.json',   // folder data TizenBrew
  path.join(os.tmpdir ? os.tmpdir() : '/tmp', 'zee-home-tiket.json')
];
var tiket = '';
var fileTiket = '';

function bacaTiket() {
  for (var i = 0; i < TEMPAT_TIKET.length; i++) {
    try {
      var isi = JSON.parse(fs.readFileSync(TEMPAT_TIKET[i], 'utf8'));
      if (isi && isi.token) {
        fileTiket = TEMPAT_TIKET[i];
        return String(isi.token);
      }
    } catch (e) { /* belum ada / nggak bisa dibaca */ }
  }
  return '';
}

function simpanTiket(t) {
  tiket = t;
  var calon = fileTiket ? [fileTiket].concat(TEMPAT_TIKET) : TEMPAT_TIKET;
  for (var i = 0; i < calon.length; i++) {
    try {
      try { fs.mkdirSync(path.dirname(calon[i]), { recursive: true }); } catch (e) { /* udah ada */ }
      fs.writeFileSync(calon[i], JSON.stringify({ token: t }), { mode: 384 });  // 0600
      fileTiket = calon[i];
      log('tiket izin disimpen ke file');
      return;
    } catch (e) { /* coba tempat berikutnya */ }
  }
  log('tiket izin cuma di memori (nggak ada tempat yang bisa ditulis)');
}

tiket = bacaTiket();

// ---------- websocket mini (port dari alat/samsung.py) ----------
function bingkai(opcode, data) {
  var isi = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  var n = isi.length, kepala;
  if (n < 126) {
    kepala = Buffer.from([0x80 | opcode, 0x80 | n]);
  } else if (n < 65536) {
    kepala = Buffer.alloc(4);
    kepala[0] = 0x80 | opcode; kepala[1] = 0x80 | 126;
    kepala.writeUInt16BE(n, 2);
  } else {
    kepala = Buffer.alloc(10);
    kepala[0] = 0x80 | opcode; kepala[1] = 0x80 | 127;
    kepala.writeUInt32BE(Math.floor(n / 4294967296), 2);
    kepala.writeUInt32BE(n >>> 0, 6);
  }
  var topeng = crypto.randomBytes(4);
  var tertutup = Buffer.alloc(n);
  for (var i = 0; i < n; i++) tertutup[i] = isi[i] ^ topeng[i % 4];
  return Buffer.concat([kepala, topeng, tertutup]);
}

// ambil satu bingkai dari buffer; null kalau belum lengkap
function bacaBingkai(buf) {
  if (buf.length < 2) return null;
  var op = buf[0] & 0x0f, ber = (buf[1] & 0x80) !== 0, n = buf[1] & 0x7f, off = 2;
  if (n === 126) {
    if (buf.length < 4) return null;
    n = buf.readUInt16BE(2); off = 4;
  } else if (n === 127) {
    if (buf.length < 10) return null;
    n = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10;
  }
  var topeng = null;
  if (ber) {
    if (buf.length < off + 4) return null;
    topeng = buf.slice(off, off + 4); off += 4;
  }
  if (buf.length < off + n) return null;
  var isi = Buffer.from(buf.slice(off, off + n));
  if (topeng) for (var i = 0; i < n; i++) isi[i] ^= topeng[i % 4];
  return { op: op, isi: isi, sisa: buf.slice(off + n) };
}

// buka jalur remote, tunggu "ms.channel.connect" (pertama kali: nunggu Zee pencet Allow, ~30 detik)
function sambung(cb) {
  var nama = encodeURIComponent(Buffer.from(NAMA, 'utf8').toString('base64'));
  var jalur = '/api/v2/channels/samsung.remote.control?name=' + nama + (tiket ? '&token=' + encodeURIComponent(tiket) : '');
  var selesai = false, buf = Buffer.alloc(0), sudahUpgrade = false;
  var sock = tls.connect({ host: TV, port: 8002, rejectUnauthorized: false }, function () {
    var kunci = crypto.randomBytes(16).toString('base64');
    sock.write('GET ' + jalur + ' HTTP/1.1\r\nHost: ' + TV + ':8002\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + kunci + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  var batas = setTimeout(function () { akhiri('monitor nggak jawab (pesan Allow kelewat?)'); }, 35000);

  function akhiri(gagal) {
    if (selesai) return;
    selesai = true;
    clearTimeout(batas);
    if (gagal) { try { sock.destroy(); } catch (e) { /* abaikan */ } cb(gagal); }
    else cb(null, sock);
  }

  sock.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    if (!sudahUpgrade) {
      var akhir = buf.indexOf('\r\n\r\n');
      if (akhir < 0) return;
      var baris = buf.slice(0, buf.indexOf('\r\n')).toString();
      if (baris.indexOf(' 101 ') < 0) return akhiri('monitor nolak sambungan: ' + baris.slice(0, 40));
      sudahUpgrade = true;
      buf = buf.slice(akhir + 4);
    }
    var b;
    while ((b = bacaBingkai(buf))) {
      buf = b.sisa;
      if (b.op === 0x9) { sock.write(bingkai(0xA, b.isi)); continue; }      // ping -> pong
      if (b.op === 0x8) return akhiri('monitor nutup sambungan');
      if (b.op !== 0x1 || selesai) continue;
      var pesan = {};
      try { pesan = JSON.parse(b.isi.toString('utf8')); } catch (e) { continue; }
      if (pesan.event === 'ms.channel.unauthorized') return akhiri('ditolak di layar (Deny)');
      if (pesan.event === 'ms.channel.timeOut') return akhiri('pesan Allow kelewat');
      if (pesan.event === 'ms.channel.connect') {
        var baru = pesan.data && pesan.data.token;
        if (baru && String(baru) !== tiket) simpanTiket(String(baru));
        return akhiri(null);
      }
    }
  });
  sock.on('error', function (e) { akhiri('nggak bisa nyambung ke remote monitor (' + (e.code || 'error') + ')'); });
  sock.on('close', function () { akhiri('sambungan ketutup'); });
}

// satu tombol dalam satu waktu
var antrean = Promise.resolve();
function tombol(key) {
  var kerja = antrean.then(function () {
    return new Promise(function (ok) {
      sambung(function (gagal, sock) {
        if (gagal) return ok({ ok: false, error: gagal });
        sock.write(bingkai(0x1, JSON.stringify({
          method: 'ms.remote.control',
          params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' }
        })));
        setTimeout(function () {
          try { sock.write(bingkai(0x8, Buffer.alloc(0))); sock.end(); } catch (e) { /* abaikan */ }
          ok({ ok: true, key: key });
        }, 400);
      });
    });
  });
  antrean = kerja.catch(function () { /* lanjut */ });
  return kerja;
}

// ---------- status power ----------
function statusPower() {
  return new Promise(function (ok) {
    var req = http.get({ host: TV, port: 8001, path: '/api/v2/', timeout: 5000 }, function (res) {
      var data = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try { ok((JSON.parse(data).device || {}).PowerState || ''); } catch (e) { ok(''); }
      });
    });
    req.on('timeout', function () { req.destroy(); });
    req.on('error', function () { ok(''); });
  });
}

// ---------- buka app ----------
function bukaApp(appId) {
  return new Promise(function (ok) {
    var t = (typeof tizen !== 'undefined') ? tizen : null;   // eslint-disable-line no-undef
    if (!t || !t.application) return ok({ ok: false, error: 'tizen nggak ada' });
    var beres = false;
    function jawab(h) { if (!beres) { beres = true; ok(h); } }
    setTimeout(function () { jawab({ ok: false, error: 'monitor kelamaan buka app' }); }, 10000);
    function cadangan(alasan) {
      try {
        var ac = new t.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, null);
        t.application.launchAppControl(ac, appId,
          function () { jawab({ ok: true, app: appId, cara: 'appcontrol' }); },
          function (e) { jawab({ ok: false, error: 'app nggak kebuka: ' + ((e && e.name) || alasan || 'error') }); });
      } catch (e) {
        jawab({ ok: false, error: 'app nggak kebuka: ' + ((e && e.name) || alasan || 'error') });
      }
    }
    try {
      t.application.launch(appId,
        function () { jawab({ ok: true, app: appId }); },
        function (e) { cadangan(e && e.name); });
    } catch (e) {
      cadangan(e && e.name);
    }
  });
}

// ---------- server ----------
function kirim(res, kode, data) {
  var isi = JSON.stringify(data);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store'
  });
  res.end(isi);
}

var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') return kirim(res, 204, {});
  if (req.method !== 'GET') return kirim(res, 405, { ok: false, error: 'cuma GET' });
  var bagian = String(req.url || '').split('?')[0].split('/').filter(Boolean).map(function (p) {
    try { return decodeURIComponent(p); } catch (e) { return ''; }
  });

  if (bagian.length === 1 && bagian[0] === 'ping') return kirim(res, 200, { ok: true });

  if (bagian.length === 2 && bagian[0] === 'launch') {
    if (!APP_ID.test(bagian[1])) return kirim(res, 400, { ok: false, error: 'id app nggak valid' });
    return bukaApp(bagian[1]).then(function (h) {
      log('launch', bagian[1], h.ok ? 'ok' : h.error);
      kirim(res, h.ok ? 200 : 502, h);
    });
  }

  if (bagian.length === 2 && bagian[0] === 'key') {
    if (!KEY.test(bagian[1])) return kirim(res, 400, { ok: false, error: 'nama tombol nggak valid' });
    return tombol(bagian[1]).then(function (h) {
      log('key', bagian[1], h.ok ? 'ok' : h.error);
      kirim(res, h.ok ? 200 : 502, h);
    });
  }

  if (bagian.length === 2 && bagian[0] === 'power' && bagian[1] === 'off') {
    // KEY_POWER itu bolak-balik: cuma dipencet kalau monitor beneran "on"
    return statusPower().then(function (status) {
      if (status !== 'on') {
        log('power/off dilewati, status:', status || 'nggak kebaca');
        return kirim(res, 200, { ok: true, dilewati: true, status: status || null });
      }
      return tombol('KEY_POWER').then(function (h) {
        log('power/off', h.ok ? 'ok' : h.error);
        kirim(res, h.ok ? 200 : 502, h);
      });
    });
  }

  kirim(res, 404, { ok: false, error: 'nggak ada' });
});

server.on('error', function (e) { log('server error:', e.code || e.message); });
server.listen(PORT, HOST, function () { log('jalan di http://' + HOST + ':' + PORT + (tiket ? ' (tiket ada)' : ' (belum ada tiket)')); });

module.exports = { server: server, _bingkai: bingkai, _bacaBingkai: bacaBingkai };
