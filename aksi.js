/* Semua perintah ke monitor lewat sini. Satu pintu, dua jalur ("backend"):
     mac = server.py di laptop M5
     tv  = service.js di monitor sendiri (modul TizenBrew), di http://127.0.0.1:8097
   Pilih jalurnya di tema.json: "backend": "mac" atau "tv".
   Semua fungsi balikin Promise berisi {ok: true/false, error?: "...", belumNyambung?: true}. */
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

  var aktif = 'mac';
  window.Aksi = {
    pakai: function (nama) { aktif = BACKEND[nama] ? nama : 'mac'; return aktif; },
    backend: function () { return aktif; },
    bukaApp: function (id) { return BACKEND[aktif].bukaApp(id); },
    tombol: function (key) { return BACKEND[aktif].tombol(key); },
    bukaUrl: function (url) { return BACKEND[aktif].bukaUrl(url); },
    matikanLayar: function () { return BACKEND[aktif].matikanLayar(); }
  };
})();
