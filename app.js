/* Home screen monitor v2: jam besar di tengah, widget kaca kiri-kanan, dock kaca, mode tidur.
   Fokus sendiri buat remote TV (panah, OK, Back) + mouse. Semua path relatif.
   Ditulis gaya ES2017 polos biar aman di Samsung Browser Tizen 6.5 (~Chromium 85). */
(function () {
  'use strict';

  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var SIMPAN = 'hometv.fokus3';
  // jam: perak keunguan yang kalem (bukan pink). Yang terang cuma buat mode terang (opsional)
  var PERAK = ['#ecebf3', '#dcd8ee', '#c9c4e5'];
  var WARNA_JAM = { gelap: PERAK, terang: ['#b0476f', '#8a4fa6', '#5f55c8'], pemandangan: PERAK, tidur: PERAK };
  var PARAM = location.search;

  var tema = {};
  var latarSekarang = 'gradasi';
  var modeSekarang = '';
  var items = [];           // [{el, data, grup: 'widget'|'dock'}]
  var fokus = -1;
  var terakhir = {};        // fokus terakhir per grup
  var timers = {};
  var sibuk = {};
  var widgetCuaca = [];
  var cuacaData = null;
  var cuacaGagal = false;   // baru true kalau udah dicoba dan gagal (bukan pas lagi muat)
  var tidur = false;
  var idleMenit = 10;
  var matiMenit = 60;
  var terakhirAksi = Date.now();
  var diLuar = false;       // abis buka app/situs: jangan auto-tidur/auto-mati sampai Zee balik ke sini

  function $(id) { return document.getElementById(id); }
  var el = {
    belakang: $('belakang'), depan: $('depan'), jamGelap: $('jamGelap'), jamTerang: $('jamTerang'), tanggalBaris: $('tanggalBaris'),
    tanggal: $('tanggal'), cuaca: $('cuaca'), toast: $('toast'),
    kolomKiri: $('kolomKiri'), kolomKanan: $('kolomKanan'), dockIsi: $('dockIsi'),
    tidur: $('tidur'), tidurGeser: $('tidurGeser'), tidurJam: $('tidurJam'), tidurTanggal: $('tidurTanggal'),
    tidurCuaca: $('tidurCuaca'), tidurDepan: $('tidurDepan'), tidurCatatan: $('tidurCatatan')
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function later(nama, ms, fn) {
    clearTimeout(timers[nama]);
    timers[nama] = setTimeout(fn, ms);
  }
  function buat(tag, kelas, teks) {
    var n = document.createElement(tag);
    if (kelas) n.className = kelas;
    if (teks !== undefined && teks !== null) n.textContent = teks;
    return n;
  }
  // ikon SVG dimasukin langsung ke halaman, biar ikon satu warna bisa ikut mode terang/gelap
  var cacheSvg = {};
  function ikon(src, kelas) {
    var wadah = buat('span', kelas);
    if (!cacheSvg[src]) {
      cacheSvg[src] = fetch(src).then(function (r) {
        if (!r.ok) throw new Error(src);
        return r.text();
      }).then(function (t) {
        return t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
      });
    }
    cacheSvg[src].then(function (t) { wadah.innerHTML = t; }, function () { wadah.appendChild(gambar(src)); });
    return wadah;
  }
  function gambar(src, kelas) {
    var i = buat('img', kelas);
    i.src = src;
    i.alt = '';
    return i;
  }
  function param(nama) {
    var m = new RegExp('[?&]' + nama + '=([^&]+)').exec(PARAM);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function angkaParam(nama) {
    var v = param(nama);
    return v !== null && !isNaN(parseFloat(v)) ? parseFloat(v) : null;
  }

  // ---------- toast ----------
  function toast(teks, lama) {
    el.toast.textContent = teks;
    el.toast.classList.add('show');
    later('toast', lama || 2400, function () { el.toast.classList.remove('show'); });
  }

  function ambilJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path);
      return r.json();
    });
  }

  // ---------- jam + tanggal ----------
  function dua(n) { return n < 10 ? '0' + n : String(n); }
  function tick() {
    var d = new Date();
    var jam = dua(d.getHours()) + '.' + dua(d.getMinutes());
    var tgl = HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()];
    el.jamGelap.textContent = jam;
    el.jamTerang.textContent = jam;
    el.tidurJam.textContent = jam;
    terapkanMode();
    el.tanggal.textContent = tgl;
    el.tidurTanggal.textContent = tgl;
    if (tidur) geserTidur();
    later('jam', (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50, tick);
  }

  // ---------- cuaca ----------
  var AWAN = '<path d="M7.6 18h9a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.4 1.4A3.2 3.2 0 0 0 7.6 18z"/>';
  var IKON = {
    cerah: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    malam: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
    'berawan-cerah': '<path d="M8.6 7.1a3.6 3.6 0 0 1 5.6-1.2M6.2 4.3l.9.9M10.4 2.6v1.2M3.9 8.6h1.2"/>' + AWAN,
    berawan: AWAN,
    hujan: '<g transform="translate(0 -2.6)">' + AWAN + '</g><path d="M9 18.6l-1 2.4M13 18.6l-1 2.4M17 18.6l-1 2.4"/>',
    petir: '<g transform="translate(0 -2.6)">' + AWAN + '</g><path d="M12.8 16.2l-2 3.2h2.8l-1.8 3"/>',
    kabut: '<path d="M4 9h16M3 13h18M5 17h14"/>'
  };
  function namaIkon(nama, siang) {
    if (nama === 'cerah' && siang === false) return 'malam';
    return IKON[nama] ? nama : 'berawan';
  }
  function svgCuaca(nama, siang) {
    var n = namaIkon(nama, siang);
    return '<span class="ik-' + n + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + IKON[n] + '</svg></span>';
  }
  function ikonCuaca(nama, siang) {
    var s = buat('span', 'ikon-cuaca');
    s.innerHTML = svgCuaca(nama, siang);
    return s;
  }
  // kode cuaca WMO -> [teks, ikon]; sama kayak di server.py
  function artiKode(k) {
    if (k === 0) return ['Cerah', 'cerah'];
    if (k === 1) return ['Cerah berawan', 'berawan-cerah'];
    if (k === 2) return ['Berawan', 'berawan-cerah'];
    if (k === 3) return ['Mendung', 'berawan'];
    if (k === 45 || k === 48) return ['Berkabut', 'kabut'];
    if (k >= 51 && k <= 57) return ['Gerimis', 'hujan'];
    if (k === 65 || k === 67 || k === 82) return ['Hujan deras', 'hujan'];
    if ((k >= 61 && k <= 67) || k === 80 || k === 81) return ['Hujan', 'hujan'];
    if (k >= 95) return ['Badai petir', 'petir'];
    return ['', 'berawan'];
  }
  // langsung ke Open-Meteo dari halaman (dia ngizinin CORS), simpen 30 menit
  function cuacaLangsung(c) {
    try {
      var lama = JSON.parse(localStorage.getItem('hometv.cuaca2') || 'null');
      if (lama && lama.sampai > Date.now() && lama.lat === c.lat && lama.lon === c.lon) return Promise.resolve(lama.data);
    } catch (e) { /* abaikan */ }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon +
      '&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day' +
      '&daily=temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto';
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var now = j.current, h = j.hourly, arti = artiKode(Number(now.weather_code));
      var sekarang = String(now.time).slice(0, 13), perJam = [];
      for (var i = 0; i < h.time.length && perJam.length < 6; i++) {
        if (String(h.time[i]).slice(0, 13) > sekarang) {
          perJam.push({ jam: String(h.time[i]).slice(11, 13) + '.00', suhu: Math.round(h.temperature_2m[i]),
            ikon: artiKode(Number(h.weather_code[i]))[1], siang: h.is_day[i] !== 0 });
        }
      }
      var data = { ok: true, suhu: Math.round(now.temperature_2m), teks: arti[0], ikon: arti[1], siang: now.is_day !== 0,
        tinggi: Math.round(j.daily.temperature_2m_max[0]), rendah: Math.round(j.daily.temperature_2m_min[0]), perJam: perJam };
      try { localStorage.setItem('hometv.cuaca2', JSON.stringify({ sampai: Date.now() + 30 * 60000, lat: c.lat, lon: c.lon, data: data })); } catch (e) { /* abaikan */ }
      return data;
    });
  }
  function infoCuaca() {
    var c = tema.cuaca || {};
    return { kota: c.kota || 'Denpasar', lat: typeof c.lat === 'number' ? c.lat : -8.65, lon: typeof c.lon === 'number' ? c.lon : 115.22,
      sumber: c.sumber || (tema.backend === 'tv' ? 'langsung' : 'server') };
  }
  function tampilCuaca(d) {
    cuacaData = d && d.ok ? d : null;
    cuacaGagal = !cuacaData;
    [el.cuaca, el.tidurCuaca].forEach(function (n) {
      n.innerHTML = '';
      if (!cuacaData) { n.classList.remove('siap'); n.style.display = 'none'; return; }
      n.innerHTML = svgCuaca(d.ikon, d.siang);
      n.appendChild(document.createTextNode(d.suhu + '° ' + (d.teks || '')));
      n.style.display = '';
      n.classList.add('siap');
    });
    widgetCuaca.forEach(isiWidgetCuaca);
  }
  function muatCuaca() {
    var c = infoCuaca();
    var minta = c.sumber === 'langsung' ? cuacaLangsung(c)
      : fetch('api/cuaca', { cache: 'no-store' }).then(function (r) { return r.json(); });
    minta.then(tampilCuaca, function () { tampilCuaca(null); });
    later('cuaca', 30 * 60 * 1000, muatCuaca);
  }

  // ---------- tema ----------
  function muatLapis(img, src) {
    img.onload = function () { img.classList.add('siap'); };
    img.src = src;
  }
  function gradJam(warna) {
    var stops = warna.map(function (c, i) { return c + ' ' + Math.round(i / (warna.length - 1) * 100) + '%'; });
    return 'linear-gradient(100deg, ' + stops.join(', ') + ')';
  }
  function warnaJam(mode) {
    var w = tema.jamWarna;
    if (w && w.length > 1) return w;                       // satu daftar buat semua
    if (w && w[mode] && w[mode].length > 1) return w[mode];
    return WARNA_JAM[mode];
  }
  // gelap selalu. Terang cuma kalau dipilih sendiri (tema.json "mode": "terang" atau ?mode=terang)
  function modeDiminta() {
    return (param('mode') || tema.mode) === 'terang' ? 'terang' : 'gelap';
  }
  function terapkanMode() {
    var m = modeDiminta();
    if (m === modeSekarang) return;
    modeSekarang = m;
    document.documentElement.className = 'mode-' + m;
  }
  function terapkanTema(t) {
    tema = t || {};
    var latar = param('latar') || tema.latar || 'gradasi';
    if (latar !== 'pemandangan') latar = 'gradasi';
    var ringan = tema.kacaRingan || param('kaca') === 'ringan';
    document.body.className = 'latar-' + latar + (ringan ? ' kaca-ringan' : '');
    window.Aksi.pakai(tema.backend || 'mac');

    var belakang = tema.belakang || 'wallpaper/langit.svg', depan = tema.depan || 'wallpaper/depan.svg';
    if (latar === 'pemandangan') {
      muatLapis(el.belakang, belakang);
      muatLapis(el.depan, depan);
    }
    muatLapis(el.tidurDepan, depan);

    latarSekarang = latar;
    el.jamGelap.style.backgroundImage = gradJam(warnaJam(latar === 'pemandangan' ? 'pemandangan' : 'gelap'));
    el.jamTerang.style.backgroundImage = gradJam(warnaJam(latar === 'pemandangan' ? 'pemandangan' : 'terang'));
    el.tidurJam.style.backgroundImage = gradJam(warnaJam('tidur'));
    var atas = typeof tema.jamAtas === 'number' ? tema.jamAtas : 17.7;
    var ukuran = typeof tema.jamUkuran === 'number' ? tema.jamUkuran : 16;
    [el.jamGelap, el.jamTerang].forEach(function (j) {
      j.style.top = atas + '%';
      j.style.fontSize = 'calc(var(--w) * ' + ukuran + ')';
    });
    // tanggal duduk di atas angka jam (bawaan: sejajar tepi atas widget, 11g)
    el.tanggalBaris.style.top = (atas + 0.267 * ukuran - 6.33) + '%';

    terapkanMode();
    idleMenit = typeof tema.tidurMenit === 'number' ? tema.tidurMenit : 10;
    matiMenit = typeof tema.matiSetelahTidurMenit === 'number' ? tema.matiSetelahTidurMenit : 60;
    // buat ngetes / dipicu dari luar: ?tidurMenit=0.2&matiMenit=1
    if (angkaParam('tidurMenit') !== null) idleMenit = angkaParam('tidurMenit');
    if (angkaParam('matiMenit') !== null) matiMenit = angkaParam('matiMenit');
  }

  // ---------- widget ----------
  function permukaan(kelas) {
    var p = buat('div', 'permukaan rim ' + (kelas || ''));
    return p;
  }
  function isiWidgetCuaca(w) {
    var isi = w.isi, c = infoCuaca(), d = cuacaData;
    isi.innerHTML = '';
    w.muka.className = 'permukaan rim kaca cuaca-w';
    var atas = buat('div', 'cuaca-atas');
    var kiri = buat('div');
    kiri.appendChild(buat('div', 'kota', c.kota));
    if (!d) {
      if (cuacaGagal) kiri.appendChild(buat('div', 'cuaca-kosong', 'Cuaca belum kebaca'));
      atas.appendChild(kiri);
      isi.appendChild(atas);
      return;
    }
    kiri.appendChild(buat('div', 'suhu', d.suhu + '°'));
    var kanan = buat('div', 'kondisi');
    kanan.appendChild(ikonCuaca(d.ikon, d.siang));
    kanan.appendChild(buat('div', null, d.teks));
    if (typeof d.tinggi === 'number') kanan.appendChild(buat('div', 'tr', 'T:' + d.tinggi + '°  R:' + d.rendah + '°'));
    atas.appendChild(kiri);
    atas.appendChild(kanan);
    isi.appendChild(atas);
    var baris = buat('div', 'per-jam');
    (d.perJam || []).slice(0, 6).forEach(function (j) {
      var kol = buat('div');
      kol.appendChild(buat('div', 'j', j.jam.slice(0, 2)));
      kol.appendChild(ikonCuaca(j.ikon, j.siang));
      kol.appendChild(buat('div', 't', j.suhu + '°'));
      baris.appendChild(kol);
    });
    isi.appendChild(baris);
  }

  function bangunWidget(w) {
    var slot = String(w.slot || '');
    var wadah = slot.indexOf('kanan') === 0 ? el.kolomKanan : el.kolomKiri;
    var bisa = !!(w.app || w.url || w.tombol || w.aksi);
    var n = buat('div', 'widget slot-' + (slot.indexOf('bawah') > 0 ? 'bawah' : 'atas') + (bisa ? ' bisa-fokus' : ''));
    n.appendChild(buat('div', 'bayang'));
    if (bisa) n.appendChild(buat('div', 'bayang-fokus'));

    if (w.jenis === 'cuaca') {
      var muka = permukaan('kaca cuaca-w');
      var isi = buat('div', 'isi');
      muka.appendChild(isi);
      n.appendChild(muka);
      var ref = { muka: muka, isi: isi };
      widgetCuaca.push(ref);
      isiWidgetCuaca(ref);
    } else {
      var gaya = w.gaya || 'kaca';
      var m = permukaan(gaya === 'gradasi' ? 'warna-tetap' : 'kaca');
      if (gaya === 'gradasi') {
        var warna = (w.warna && w.warna.length > 1) ? w.warna : ['#5a3fd2', '#9b3fb8'];
        m.style.background = 'linear-gradient(150deg, ' + warna[0] + ' 0%, ' + warna[1] + ' 100%)';
      }
      var isi2 = buat('div', 'isi' + (gaya === 'album' ? ' album' : ''));
      if (gaya === 'album') {
        var ubin = buat('div', 'ubin');
        if (w.ikon) ubin.appendChild(ikon(w.ikon));
        isi2.appendChild(ubin);
      } else if (w.ikon) {
        isi2.appendChild(ikon(w.ikon, 'glyph-pojok'));
      }
      var teks = buat('div', 'teks-bawah');
      if (w.label) teks.appendChild(buat('div', 'keterangan', w.label));
      if (w.judul) teks.appendChild(buat('div', 'judul', w.judul));
      isi2.appendChild(teks);
      m.appendChild(isi2);
      m.appendChild(buat('div', 'kilau'));
      n.appendChild(m);
    }
    wadah.appendChild(n);
    if (bisa) daftar(n, w, 'widget');
  }

  // ---------- dock ----------
  function bangunApp(a) {
    var n = buat('div', 'app bisa-fokus');
    n.setAttribute('role', 'button');
    n.setAttribute('aria-label', a.label);
    n.appendChild(buat('div', 'bayang-fokus'));
    var m = permukaan('kaca-isi');
    m.appendChild(ikon(a.ikon || 'ikon/browser.svg', 'glyph'));
    m.appendChild(buat('div', 'kilau'));
    n.appendChild(m);
    n.appendChild(buat('div', 'app-nama', a.label));
    el.dockIsi.appendChild(n);
    daftar(n, a, 'dock');
  }

  // ---------- fokus + navigasi ruang (kayak tvOS) ----------
  function daftar(n, data, grup) {
    var i = items.length;
    items.push({ el: n, data: data, grup: grup });
    n.addEventListener('mouseenter', function () { if (!tidur) setFokus(i, null, true); });
    n.addEventListener('mousemove', function (e) {
      if (tidur || i !== fokus) return;
      var r = n.getBoundingClientRect();
      var x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      n.classList.add('ikut-mouse');
      n.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
      n.style.setProperty('--rx', (-(y - 0.5) * 8).toFixed(2) + 'deg');
    });
    n.addEventListener('mouseleave', function () {
      n.classList.remove('ikut-mouse');
      n.style.setProperty('--rx', '0deg');
      n.style.setProperty('--ry', '0deg');
    });
    n.addEventListener('click', function () {
      if (tidur) return;
      setFokus(i, null, true);
      aktifkan(data, n);
    });
  }

  function kotak(n) {
    var r = n.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width };
  }
  function cari(daftarItem, asal, dx, dy, sekolom) {
    var terbaik = null, skorTerbaik = Infinity;
    daftarItem.forEach(function (it) {
      var k = kotak(it.el), ax = k.cx - asal.cx, ay = k.cy - asal.cy;
      if (dx > 0 && ax <= 2) return;
      if (dx < 0 && ax >= -2) return;
      if (dy > 0 && ay <= 2) return;
      if (dy < 0 && ay >= -2) return;
      if (sekolom && Math.abs(ax) > asal.w * 0.6) return;   // atas/bawah: tetap di kolom yang sama
      var skor = dx !== 0 ? Math.abs(ax) + Math.abs(ay) * 2 : Math.abs(ay) + Math.abs(ax) * 2;
      if (skor < skorTerbaik) { skorTerbaik = skor; terbaik = it; }
    });
    return terbaik;
  }
  function pindah(dx, dy) {
    var cur = items[fokus];
    if (!cur) return;
    var asal = kotak(cur.el);
    var lawan = items.filter(function (it) { return it !== cur && it.grup === cur.grup; });
    var tujuan = cari(lawan, asal, dx, dy, dy !== 0);
    if (!tujuan && dy !== 0) {
      // atas/bawah pindah antara widget <-> dock
      var grupLain = cur.grup === 'widget' ? 'dock' : 'widget';
      var lain = items.filter(function (it) { return it.grup === grupLain; });
      var ingat = items[terakhir[grupLain]];
      if (ingat && cari([ingat], asal, 0, dy)) tujuan = ingat;
      else tujuan = cari(lain, asal, 0, dy);
    }
    if (tujuan) setFokus(items.indexOf(tujuan), { x: dx, y: dy });
  }

  function setFokus(i, arah, dariMouse) {
    var it = items[i];
    if (!it || i === fokus) return;
    var lama = items[fokus];
    if (lama) {
      lama.el.classList.remove('is-focus', 'ikut-mouse');
      lama.el.style.setProperty('--rx', '0deg');
      lama.el.style.setProperty('--ry', '0deg');
    }
    fokus = i;
    terakhir[it.grup] = i;
    var n = it.el;
    n.classList.add('is-focus');
    // miring dikit ke arah gerak, terus balik lurus (pake per)
    if (arah && !dariMouse) {
      n.style.setProperty('--ry', (arah.x * 6) + 'deg');
      n.style.setProperty('--rx', (-arah.y * 6) + 'deg');
      later('miring', 170, function () {
        n.style.setProperty('--rx', '0deg');
        n.style.setProperty('--ry', '0deg');
      });
    }
    // kilau nyapu sekali
    var k = n.querySelector('.kilau');
    if (k) {
      k.classList.remove('sapu');
      void k.offsetWidth;
      k.classList.add('sapu');
    }
    try { localStorage.setItem(SIMPAN, String(i)); } catch (e) { /* mode privat */ }
  }

  // ---------- aksi ----------
  function tekan(n) {
    var m = n && n.querySelector('.permukaan');
    if (!m) return;
    m.classList.remove('tekan');
    void m.offsetWidth;
    m.classList.add('tekan');
  }
  function aktifkan(t, n) {
    if (!t) return;
    tekan(n);
    if (t.aksi === 'tidur') return later('masukTidur', 280, masukTidur);
    var kunci = t.label + '|' + (t.app || t.url || t.tombol || '');
    var now = Date.now();
    if (sibuk[kunci] && sibuk[kunci] > now) return;
    sibuk[kunci] = now + 1500;

    function gagal(hasil) {
      sibuk[kunci] = 0;
      diLuar = false;
      toast(hasil.belumNyambung ? hasil.error : 'Gagal: ' + (hasil.error || 'nggak tahu kenapa'), 4500);
    }
    var nama = t.judul && t.label && t.judul.length < t.label.length ? t.judul : (t.judul || t.label);
    if (t.app || t.tombol || t.url) diLuar = true;
    if (t.app) {
      toast('Buka ' + nama + '…');
      window.Aksi.bukaApp(t.app).then(function (h) { if (!h.ok) gagal(h); });
    } else if (t.tombol) {
      toast((t.judul || t.label) + '…');
      window.Aksi.tombol(t.tombol).then(function (h) { if (!h.ok) gagal(h); });
    } else if (t.url) {
      toast('Buka ' + nama + '…');
      window.Aksi.bukaUrl(t.url).then(function (h) {
        if (!h.ok) return gagal(h);
        // server bisa jawab navigate:false kalau nanti dia yang buka sendiri
        if (h.navigate !== false) setTimeout(function () { location.href = h.url || t.url; }, 400);
      });
    } else {
      gagal({ error: 'belum ada aksinya' });
    }
  }

  // ---------- mode tidur ----------
  function geserTidur() {
    // geser beberapa piksel tiap menit, pelan, biar panel nggak "kebakar"
    var u = Math.min(window.innerWidth, window.innerHeight * 1.7778) / 100;
    var dx = (Math.random() * 2 - 1) * u * 0.8;
    var dy = (Math.random() * 2 - 1) * u * 0.5;
    el.tidurGeser.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
  }
  function jadwalMati() {
    el.tidurCatatan.classList.remove('on');
    window.Power.jadwal(matiMenit, {
      peringatan: function () { el.tidurCatatan.classList.add('on'); },
      mati: function (h) {
        el.tidurCatatan.classList.remove('on');
        if (!h.ok) {
          el.tidurCatatan.textContent = 'Gagal matiin layar: ' + (h.error || '');
          el.tidurCatatan.classList.add('on');
        }
      }
    });
  }
  function masukTidur() {
    if (tidur) return;
    tidur = true;
    el.toast.classList.remove('show');
    geserTidur();
    el.tidur.classList.add('on');
    jadwalMati();
  }
  function keluarTidur() {
    if (!tidur) return;
    tidur = false;
    terakhirAksi = Date.now();
    window.Power.batal();
    el.tidurCatatan.classList.remove('on');
    el.tidurCatatan.textContent = 'Layar mati 30 detik lagi, pencet tombol apa aja buat batal';
    el.tidur.classList.remove('on');
  }
  el.tidur.addEventListener('click', function (e) { e.stopPropagation(); keluarTidur(); });
  function cekDiam() {
    if (!tidur && !diLuar && !document.hidden && idleMenit > 0 && Date.now() - terakhirAksi > idleMenit * 60000) masukTidur();
    later('diam', Math.min(15000, Math.max(1000, idleMenit * 60000 / 6)), cekDiam);
  }
  document.addEventListener('mousemove', function () { if (!tidur) terakhirAksi = Date.now(); });

  // ---------- remote ----------
  function balik() {
    el.toast.classList.remove('show');
    for (var i = 0; i < items.length; i++) if (items[i].grup === 'widget') return setFokus(i, null);
  }
  document.addEventListener('keydown', function (e) {
    terakhirAksi = Date.now();
    diLuar = false;
    if (tidur) {               // tombol pertama cuma bangunin, nggak ngapa-ngapain
      e.preventDefault();
      keluarTidur();
      return;
    }
    if (!items.length) return;
    switch (e.keyCode) {
      case 37: pindah(-1, 0); break;                           // kiri
      case 39: pindah(1, 0); break;                            // kanan
      case 38: pindah(0, -1); break;                           // atas
      case 40: pindah(0, 1); break;                            // bawah
      case 13: case 32: case 415: case 10252:                  // OK, spasi, Play, Play/Pause
        if (!e.repeat && items[fokus]) aktifkan(items[fokus].data, items[fokus].el);
        break;
      case 10009: case 27: case 8: balik(); break;             // Back (Tizen), Esc, Backspace
      default: return;
    }
    e.preventDefault();
  });

  if (window.tizen && window.tizen.tvinputdevice) {
    ['MediaPlayPause', 'MediaPlay'].forEach(function (k) {
      try { window.tizen.tvinputdevice.registerKey(k); } catch (e) { /* tombol nggak ada */ }
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { window.Power.batal(); return; }
    if (tidur) jadwalMati();   // balik keliatan pas lagi tidur: hitung ulang dari awal
    tick();
    terakhirAksi = Date.now();
    diLuar = false;
  });

  // ---------- garis bantu buat ngecek kerapian (?grid=1) ----------
  function garisBantu() {
    var g = buat('div', 'grid-bantu');
    var u = 0.8;  // 1 g = 0.8% lebar
    [6, 35, 90, 119].forEach(function (x) {
      var v = buat('div', 'gv'); v.style.left = (x * u) + '%'; g.appendChild(v);
    });
    var t = buat('div', 'gv tengah'); t.style.left = '50%'; g.appendChild(t);
    [11, 29, 31, 49, 53, 64].forEach(function (y) {
      var h = buat('div', 'gh'); h.style.top = (y * u / 56.25 * 100) + '%'; g.appendChild(h);
    });
    var tm = buat('div', 'gh tengah'); tm.style.top = (58.5 * u / 56.25 * 100) + '%'; g.appendChild(tm);
    document.querySelector('.stage').appendChild(g);
  }

  // ---------- mulai ----------
  if (param('grid') === '1') garisBantu();
  tick();
  var fontSiap = document.fonts && document.fonts.load ? document.fonts.load('300 100px Satoshi') : Promise.resolve();
  Promise.race([fontSiap, new Promise(function (ok) { setTimeout(ok, 1500); })]).then(function () {
    el.jamGelap.classList.add('siap');
    el.jamTerang.classList.add('siap');
  });

  Promise.all([
    ambilJson('tema.json').catch(function () { return {}; }),
    ambilJson('tiles.json')
  ]).then(function (hasil) {
    terapkanTema(hasil[0]);
    var data = hasil[1] || {};
    (data.widget || []).forEach(function (w) { if (w && (w.jenis || w.judul || w.label)) bangunWidget(w); });
    (data.dock || []).forEach(function (a) { if (a && a.label) bangunApp(a); });
    var awal = 0;
    try { awal = parseInt(localStorage.getItem(SIMPAN), 10) || 0; } catch (e) { awal = 0; }
    setFokus(items[awal] ? awal : 0, null);
    muatCuaca();
    cekDiam();
    if (/[?&]tidur=1(&|$)/.test(PARAM)) masukTidur();
  }).catch(function () {
    terapkanTema({});
    muatCuaca();
    cekDiam();
    toast('Gagal: tiles.json nggak kebaca', 6000);
  });
})();
