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
  // app yang NGGAK BOLEH dibuka dari Zee Home: YouTube biasa (pake iklan). YouTube cuma lewat TizenTube.
  var DILARANG = ['111299001912'];
  var TIZENBREW = 'xvvl3S1bvH.TizenBrewStandalone';
  var TIZENTUBE = 'npm/@foxreis/tizentube';
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
      fetch(m1 + path, { cache: 'no-store', keepalive: true, signal: ctrl ? ctrl.signal : undefined })
        .then(function () { clearTimeout(t); }, function () { clearTimeout(t); });
    } catch (e) { clearTimeout(t); }
  }

  // ---------- buka modul TizenBrew langsung (mis. TizenTube) ----------
  // Sama persis kayak UI TizenBrew sendiri (reisxd/TizenBrew, tizenbrew-ui/src/components/WebSocketClient.js):
  // websocket ke service TizenBrew di 127.0.0.1:8081 -> GetModules (4) -> LaunchModule (5) dengan objek modulnya
  // -> pindah ke module.appPath. Debugger TizenBrew yang nyuntik script modulnya ke halaman itu.
  function bukaModulTv(nama) {
    return new Promise(function (selesai) {
      var beres = false, ws = null, coba = 0;
      function akhir(h) {
        if (beres) return;
        beres = true;
        clearTimeout(batas);
        try { if (ws && !h.ok) ws.close(); } catch (e) { /* abaikan */ }
        selesai(h);
      }
      var batas = setTimeout(function () { akhir({ ok: false, error: 'TizenBrew nggak jawab' }); }, 6000);
      var host = location.port === '8081' ? location.host : '127.0.0.1:8081';
      try { ws = new WebSocket('ws://' + host); } catch (e) { return akhir({ ok: false, error: 'TizenBrew nggak bisa dihubungi' }); }
      ws.onerror = function () { akhir({ ok: false, error: 'TizenBrew nggak bisa dihubungi' }); };
      ws.onopen = function () { ws.send(JSON.stringify({ type: 4 })); };
      ws.onmessage = function (ev) {
        var pesan = {};
        try { pesan = JSON.parse(ev.data); } catch (e) { return; }
        if (pesan.type !== 4) return;
        if (!pesan.payload) {                       // daftar modul belum siap: coba lagi kayak UI aslinya
          if (++coba > 8) return akhir({ ok: false, error: 'daftar modul TizenBrew belum siap' });
          return setTimeout(function () { ws.send(JSON.stringify({ type: 4 })); }, 500);
        }
        var modul = null;
        for (var i = 0; i < pesan.payload.length; i++) {
          if (pesan.payload[i] && pesan.payload[i].fullName === nama) modul = pesan.payload[i];
        }
        if (!modul || !modul.appPath) return akhir({ ok: false, error: 'TizenTube belum dipasang di TizenBrew' });
        ws.send(JSON.stringify({ type: 5, payload: modul }));
        akhir({ ok: true, appPath: modul.appPath, langsung: !modul.evaluateScriptOnDocumentStart });
        // kasih waktu dikit biar service TizenBrew nyimpen modulnya + niat ke M1 nyampe, baru pindah
        setTimeout(function () {
          if (!modul.evaluateScriptOnDocumentStart) location.href = modul.appPath;
        }, 250);
      };
    });
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
    bukaApp: function (id) {
      if (DILARANG.indexOf(String(id)) >= 0) return Promise.resolve({ ok: false, error: 'YouTube biasa dimatiin, pake tile YouTube (tanpa iklan)' });
      keM1('/niat?app=' + enc(id));
      return BACKEND[aktif].bukaApp(id);
    },
    // buka modul TizenBrew (bawaan: TizenTube) langsung, nggak lewat daftar modul / Autolaunch
    bukaModul: function (nama) {
      nama = nama || TIZENTUBE;
      // penjaga di M1: ini disengaja, TizenBrew bakal tampil lama (nonton), jangan ditarik balik
      keM1('/niat?app=' + enc(TIZENBREW));
      if (aktif !== 'tv') return BACKEND[aktif].bukaApp(TIZENBREW);   // preview Mac: cuma buka TizenBrew
      return bukaModulTv(nama);
    },
    bukaTizenTube: function () { return window.Aksi.bukaModul(TIZENTUBE); },
    // matiin layar: penjaga istirahat 2 menit dulu biar nggak "narik balik" pas monitor lagi mati
    tombol: function (key) { if (key === 'KEY_POWER') keM1('/jeda?menit=2'); return BACKEND[aktif].tombol(key); },
    bukaUrl: function (url) { return BACKEND[aktif].bukaUrl(url); },
    matikanLayar: function () { keM1('/jeda?menit=2'); return BACKEND[aktif].matikanLayar(); }
  };
})();
