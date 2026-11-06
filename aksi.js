/* Semua perintah ke monitor lewat sini. Satu pintu, dua jalur ("backend"):
     mac = server.py di laptop M5
     tv  = service.js di monitor sendiri (modul TizenBrew), di http://127.0.0.1:8097
   Pilih jalurnya di tema.json: "backend": "mac" atau "tv".
   Semua fungsi balikin Promise berisi {ok: true/false, error?: "...", belumNyambung?: true}.
   Plus "m1": server kecil di M1 (wallpaper + penjaga tombol Home). Semua panggilan ke M1
   "lempar terus lupa": batas waktu pendek, error diabaikan, UI nggak pernah nunggu. */
(function () {
  'use strict';

  var TV = 'http://127.0.0.1:8097';
  var BELUM = 'Belum nyambung ke monitor, coba lagi sebentar';

  function enc(s) { return encodeURIComponent(String(s)); }
  function tunggu(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  // fetch dengan batas waktu; error jaringan dibedain dari kelamaan
  function ambil(url, opsi, batasMs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, batasMs);
    opsi.signal = ctrl ? ctrl.signal : undefined;
    return fetch(url, opsi).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return { ok: r.ok, error: r.ok ? '' : 'jawaban aneh' }; });
    }, function (e) {
      clearTimeout(t);
      throw (e && e.name === 'AbortError') ? { kelamaan: true } : { jaringan: true };
    });
  }

  // server.py di Mac (path relatif, jadi ikut alamat halaman)
  function postMac(path, data) {
    return ambil(path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Home-TV': '1' },
      body: JSON.stringify(data || {})
    }, 12000).catch(function (e) {
      return { ok: false, error: e.kelamaan ? 'kelamaan, nggak ada jawaban' : 'penghubung ke monitor nggak nyala' };
    });
  }

  // service di monitor. GET polos (nggak perlu preflight CORS).
  // Service-nya baru nyala pas modul dibuka, jadi panggilan pertama bisa gagal: coba lagi pelan-pelan.
  var JEDA = [0, 400, 900, 1800, 3000];
  function getTv(path, batasMs) {
    var i = 0;
    function coba() {
      return tunggu(JEDA[i]).then(function () {
        return ambil(TV + path, { cache: 'no-store' }, batasMs || 10000);
      }).catch(function (e) {
        if (e && e.kelamaan) return { ok: false, error: 'monitor kelamaan jawab' };
        i += 1;
        if (i < JEDA.length) return coba();
        return { ok: false, belumNyambung: true, error: BELUM };
      });
    }
    return coba();
  }

  var BACKEND = {
    mac: {
      bukaApp: function (id) { return postMac('api/app/' + enc(id)); },
      tombol: function (key) { return postMac('api/key/' + enc(key)); },
      bukaUrl: function (url) { return postMac('api/url', { url: url }); },
      // server cek status dulu, KEY_POWER cuma dikirim kalau monitor lagi "on"
      matikanLayar: function () { return postMac('api/layar/mati'); }
    },
    tv: {
      bukaApp: function (id) { return getTv('/launch/' + enc(id)); },
      // tombol pertama kali bisa nunggu pesan "Allow" di layar (~30 detik)
      tombol: function (key) { return getTv('/key/' + enc(key), 40000); },
      // di monitor, halaman pindah sendiri ke situsnya
      bukaUrl: function (url) { return Promise.resolve({ ok: true, url: url }); },
      matikanLayar: function () { return getTv('/power/off', 40000); }
    }
  };

  // ---------- M1 (penjaga tombol Home) ----------
  var m1 = '';
  function keM1(path) {
    if (!m1) return;
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 1500);
    try {
      fetch(m1 + path, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function () { clearTimeout(t); }, function () { clearTimeout(t); });
    } catch (e) { clearTimeout(t); }
  }

  var aktif = 'mac';
  window.Aksi = {
    pakai: function (nama) { aktif = BACKEND[nama] ? nama : 'mac'; return aktif; },
    backend: function () { return aktif; },
    pakaiM1: function (url) { m1 = String(url || '').replace(/\/+$/, ''); },
    detak: function () { keM1('/detak'); },
    // halaman baru aja ketutup (mis. Zee pencet Home): kirim 2 cara biar pasti nyampe di browser lama
    sembunyi: function () {
      if (!m1) return;
      try { fetch(m1 + '/sembunyi', { cache: 'no-store', keepalive: true }).catch(function () {}); } catch (e) { /* abaikan */ }
      try { new Image().src = m1 + '/sembunyi?t=' + Date.now(); } catch (e) { /* abaikan */ }
    },
    jedaJaga: function (menit) { keM1('/jeda?menit=' + enc(menit || 10)); },
    // buka app dengan sengaja: kasih tau penjaga dulu biar app-nya nggak "ditarik balik"
    bukaApp: function (id) { keM1('/niat?app=' + enc(id)); return BACKEND[aktif].bukaApp(id); },
    // matiin layar: penjaga istirahat 2 menit dulu biar nggak "narik balik" pas monitor lagi mati
    tombol: function (key) { if (key === 'KEY_POWER') keM1('/jeda?menit=2'); return BACKEND[aktif].tombol(key); },
    bukaUrl: function (url) { return BACKEND[aktif].bukaUrl(url); },
    matikanLayar: function () { keM1('/jeda?menit=2'); return BACKEND[aktif].matikanLayar(); }
  };
})();
