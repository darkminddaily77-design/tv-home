# Zee Home (modul TizenBrew)

Home screen buat monitor Samsung yang jalan langsung di monitor lewat TizenBrew. Nggak butuh laptop nyala.

Isinya:
- jam besar di tengah, tanggal dan cuaca Denpasar (data asli dari Open-Meteo),
- widget: cuaca, YouTube tanpa iklan (lewat TizenBrew), Mode tidur, Spotify,
- dock: YouTube, Browser, Netflix, Spotify, Mode tidur, Matiin layar,
- tampilan gelap yang kalem: kaca gelap, warna cuma di ikon kecil,
- Mode tidur: layar tetap nyala, cuma jam besar di belakang gunung. Masuk sendiri kalau 10 menit nggak ada tombol dipencet, dan layar dimatiin setelah 60 menit (ada peringatan 30 detik sebelumnya, pencet tombol apa aja buat batal).

Gerakinnya pake remote: kiri/kanan, atas/bawah, OK buat buka, Back balik ke awal.

## Cara pasang

1. Buka **TizenBrew** di monitor.
2. Masuk **Module Manager**, pilih **Add GitHub Module**, ketik:
   `darkminddaily77-design/tv-home@main`
3. Masuk **Settings**, pilih **Autolaunch**, pilih **Zee Home**. Jadi tiap TizenBrew dibuka, langsung masuk home ini.

Pertama kali tombol "Matiin layar" dipencet (atau layar mau dimatiin otomatis), monitor nampilin pesan izin. Pilih **Allow**. Abis itu nggak ditanya lagi.

## Kalau muncul "Belum nyambung ke monitor"

Penghubung kecil di monitor (`service.js`) baru nyala pas modul dibuka. Tunggu beberapa detik, terus pencet lagi.

## Isi folder

- `index.html`, `app.css`, `app.js`: tampilan dan remote.
- `aksi.js`: semua perintah ke monitor lewat sini (buka app, tombol remote, matiin layar).
- `power.js`: matiin layar otomatis setelah Mode tidur.
- `service.js`: penghubung kecil yang jalan di monitor, di `127.0.0.1:8097`:
  - `/launch/<id app>` buka app,
  - `/key/<KEY_...>` tombol remote,
  - `/power/off` matiin layar, tapi cuma kalau monitornya lagi nyala,
  - `/ping` cek nyala.
- `tiles.json`: isi widget dan dock. `tema.json`: tampilan (`"mode": "terang"` kalau mau versi terang, bawaannya gelap; waktu Mode tidur; lokasi cuaca).
- `ikon/`, `wallpaper/`: gambar.

## Catatan

- Nggak ada data login atau alamat rumah di sini. Tiket izin dari monitor cuma disimpen di monitor itu sendiri, nggak pernah masuk repo.
- Font Satoshi dipanggil dari Fontshare (butuh internet). Kalau nggak nyambung, pake font bawaan monitor.
- Ganti isi: edit `tiles.json` / `tema.json`, naikin `version` di `package.json`, bikin tag baru, terus di TizenBrew ganti ke versi itu.
