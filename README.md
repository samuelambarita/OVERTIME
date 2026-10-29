# Lembur

Aplikasi web ringan untuk pengajuan lembur karyawan dengan persetujuan dua tahap (Manager, lalu HR), pencatatan realisasi, dan rekap yang bisa diunduh sebagai CSV. Seluruh antarmuka berbahasa Indonesia.

## Fitur

- Pengajuan lembur pribadi atau kelompok (2-50 peserta), termasuk lembur lewat tengah malam.
- Peringatan (tidak memblokir) bila melebihi 4 jam/hari atau 18 jam/minggu, serta deteksi bentrok jadwal.
- Persetujuan dua tahap per peserta, bisa massal, dengan catatan wajib saat menolak.
- Realisasi jam lembur, bisa diubah sampai 7 hari setelah tanggal lembur.
- Notifikasi dalam aplikasi, rekap dengan filter, dan ekspor CSV (UTF-8 BOM, pemisah `;`).
- Panel admin: user, departemen, dan log audit.

## Kebutuhan

- Node.js 22.13 atau lebih baru (memakai `node:sqlite` bawaan).
- Dependency runtime: express, ejs, express-session, bcryptjs, dotenv. Tidak ada database server dan tidak ada CDN eksternal.

## Instalasi

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
```

Edit `.env`:

| Variabel | Keterangan |
| --- | --- |
| `PORT` | Port HTTP (default 3000). |
| `SESSION_SECRET` | Wajib. Isi string acak panjang, mis. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `HTTPS` | `true` bila diakses lewat HTTPS (cookie sesi diberi flag Secure). |
| `TRUST_PROXY` | `true` bila berjalan di belakang reverse proxy (lihat bagian HTTPS). |
| `DB_FILE` | Lokasi file SQLite (default `data/lembur.db`). Path relatif dihitung dari folder proyek, bukan dari direktori kerja. |
| `APP_TZ` | Zona waktu server (default `Asia/Jakarta`). Jam lembur memakai waktu lokal server; `TZ` yang sudah diset di lingkungan mengalahkan `APP_TZ`. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Opsional, dipakai `npm run seed` bila argumen tidak diberikan. |

Buat admin pertama. Cara yang disarankan: isi `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env` (agar password tidak muncul di riwayat perintah), jalankan seed, lalu kosongkan lagi `ADMIN_PASSWORD`:

```bash
npm run seed
npm start
```

Alternatif: `npm run seed -- --username admin --password <password>` (password terlihat di command line).

Setelah seed, login sebagai admin dan buka **Admin → Users**, edit akun admin untuk menetapkan atasannya (supervisor). Admin bootstrap dibuat tanpa atasan, sehingga pengajuan lembur miliknya tidak punya rantai persetujuan sampai atasan diisi.

Buka `http://localhost:3000`. Admin diminta mengganti password saat login pertama. Seed bersifat idempoten: bila admin sudah ada, ia mencetak `Admin sudah ada, dilewati.` Password minimal 8 karakter dan tidak pernah dicetak.

## Data demo

```bash
npm run seed -- --demo
```

Hanya berjalan bila tabel `users` masih kosong. Semua akun memakai password `Password123` (khusus demo, jangan dipakai di produksi):

| Username | Jabatan |
| --- | --- |
| `presdir` | Presdir |
| `direktur` | Direktur |
| `deputi` | Deputi |
| `hr` | HR |
| `smit` | Senior Manager (IT) |
| `mgrit` | Manager (IT) |
| `leadit` | Lead (IT) |
| `budi`, `andi` | Karyawan (IT) |
| `mgrfin` | Manager (Finance) |
| `sari` | Karyawan (Finance) |
| `admin` | Karyawan + Admin |

## Role dan alur approval

Jabatan: 1 Karyawan, 2 Lead, 3 Manager, 4 Senior Manager, 5 HR, 6 Deputi, 7 Direktur, 8 Presdir.

1. Siapa pun mengajukan lembur (untuk diri sendiri atau kelompok). Tanggal boleh dari 3 hari lalu sampai 30 hari ke depan; durasi 30 menit sampai 12 jam.
2. Tiap peserta punya status sendiri. Tahap **Manager**: approver adalah atasan terdekat berjabatan level 3 ke atas di rantai atasan peserta (Lead dilewati, atasan yang lebih tinggi boleh menggantikan).
3. Tahap **HR**: user berjabatan level 5 ke atas memutuskan peserta yang sudah disetujui Manager.
4. Penolakan di tahap mana pun mengakhiri peserta tersebut (catatan wajib). Pengaju dapat membatalkan selama belum ada keputusan.
5. Setelah disetujui, peserta atau pengaju mengisi realisasi. Rekap memakai realisasi bila ada, jika tidak memakai rencana.

Menu **Persetujuan** untuk level 3 ke atas, **Persetujuan HR** dan **Rekap** sesuai level, serta **Admin** hanya untuk admin.

## Menjalankan sebagai service

### Windows (NSSM)

```bat
nssm install LemburApp "C:\Program Files\nodejs\node.exe"
nssm set LemburApp AppDirectory "C:\aplikasi\lembur-app"
nssm set LemburApp AppParameters "--disable-warning=ExperimentalWarning src\server.js"
nssm set LemburApp AppStdout "C:\aplikasi\lembur-app\logs\out.log"
nssm set LemburApp AppStderr "C:\aplikasi\lembur-app\logs\err.log"
nssm start LemburApp
```

Pastikan `.env` ada di folder aplikasi dan folder `logs` sudah dibuat (`logs/` ada di `.gitignore`).

### Linux (systemd)

`/etc/systemd/system/lembur.service`:

```ini
[Unit]
Description=Aplikasi Lembur
After=network.target

[Service]
WorkingDirectory=/opt/lembur-app
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server.js
Restart=on-failure
User=lembur
Environment=NODE_ENV=production
Environment=TZ=Asia/Jakarta

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lembur
```

## HTTPS lewat reverse proxy

Aplikasi berbicara HTTP biasa; pasang nginx/Caddy/IIS di depannya untuk HTTPS. Pada `.env` set:

```
HTTPS=true
TRUST_PROXY=true
```

`HTTPS=true` membuat cookie sesi hanya dikirim lewat HTTPS. `TRUST_PROXY=true` mengaktifkan `app.set('trust proxy', 1)` sehingga alamat klien diambil dari header `X-Forwarded-For` milik proxy. Batas login (5 gagal / 15 menit per `username|ip`) memakai `req.ip`; tanpa pengaturan ini semua pengguna tampak berasal dari IP proxy dan saling memblokir. Aktifkan hanya bila ada satu proxy tepercaya di depan aplikasi; proxy harus meneruskan `X-Forwarded-For` dan `Host`.

## Backup dan restore

```bash
npm run backup
```

Membuat salinan konsisten lewat `VACUUM INTO` ke `backups/lembur-YYYYMMDD-HHMMSS.db` (waktu lokal) dan mencetak path-nya; aman dijalankan saat aplikasi hidup. Folder `backups/` ada di folder proyek (bukan direktori kerja). Perintah ditolak bila `DB_FILE=:memory:` atau file database belum ada. Jadwalkan dengan Task Scheduler atau cron, dan salin hasilnya ke tempat lain.

Restore: hentikan aplikasi, salin file backup menjadi file `DB_FILE` (default `data/lembur.db`), hapus file `lembur.db-wal` dan `lembur.db-shm` bila ada, lalu jalankan lagi.

## Menjalankan test

```bash
npm test
```
