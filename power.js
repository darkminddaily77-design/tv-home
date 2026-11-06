/* Matiin layar otomatis setelah lama di Mode Tidur.
   Cara matiinnya ada di aksi.js (Aksi.matikanLayar), jadi nanti di TizenBrew cukup ganti backend-nya.
   Power.jadwal(menit, {peringatan, mati}) -> 30 detik sebelum mati panggil peringatan(), terus matiin.
   Power.batal() -> batalin (dipanggil kalau ada tombol dipencet / keluar mode tidur). */
(function () {
  'use strict';

  var PERINGATAN_MS = 30000;
  var tPeringatan = 0, tMati = 0;

  function batal() {
    clearTimeout(tPeringatan);
    clearTimeout(tMati);
    tPeringatan = tMati = 0;
  }

  function matikanLayar() {
    return window.Aksi.matikanLayar();
  }

  function jadwal(menit, cb) {
    batal();
    if (!(menit > 0)) return;
    cb = cb || {};
    var ms = menit * 60000;
    tPeringatan = setTimeout(function () {
      if (cb.peringatan) cb.peringatan();
    }, Math.max(0, ms - PERINGATAN_MS));
    tMati = setTimeout(function () {
      tMati = 0;
      // halaman lagi ketutup app lain = jangan pencet power (bisa kebalik nyalain/matiin)
      if (document.hidden) return;
      matikanLayar().then(function (h) { if (cb.mati) cb.mati(h); });
    }, ms);
  }

  window.Power = { jadwal: jadwal, batal: batal, matikanLayar: matikanLayar };
})();
