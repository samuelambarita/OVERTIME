# Desain Aplikasi Pengajuan Lembur

Tanggal: 2026-10-29
Status: Draft, menunggu review

## 1. Tujuan dan Konteks

Aplikasi web internal untuk mengajukan, menyetujui, dan merekap lembur karyawan perusahaan (IT dan Non-IT). Aplikasi akan **dipakai sungguhan di kantor**. Lokasi deploy belum ditentukan, jadi aplikasi harus berjalan sama baiknya di Windows maupun Linux, di PC/server LAN maupun VPS.

**Kriteria keberhasilan:**
- Karyawan bisa mengajukan lembur perorangan atau kelompok dengan kegiatan dan waktu yang jelas.
- Setiap peserta lembur disetujui oleh Manager (atau jabatan di atasnya) di rantai atasannya, lalu disetujui HR (atau jabatan di atasnya).
- Approver bisa menyetujui satu per satu atau memilih beberapa sekaligus.
- Admin bisa mendaftarkan dan mengelola akun beserta struktur atasannya.
- Halaman ringan untuk laptop yang mengaksesnya: tanpa framework JS besar di browser.

## 2. Stack

- **Node.js ≥ 22.13 (dikembangkan dengan v24)** + **Express**
- **SQLite** memakai modul bawaan `node:sqlite` (tanpa kompilasi native). Satu file di `data/lembur.db`.
- **EJS** untuk template HTML server-side (auto-escape).
- **htmx** (~14 KB, disimpan lokal di `public/`) untuk aksi parsial tanpa reload penuh.
- CSS buatan sendiri (~10 KB), tanpa font atau CDN eksternal.
- Library tambahan dibatasi: `express`, `ejs`, `express-session`, `bcryptjs` (pure JS), `dotenv`. Session store memakai SQLite (implementasi kecil sendiri di atas `node:sqlite`).
- Testing: `node:test` + `node:assert` bawaan.

## 3. Role

Dua konsep yang terpisah:

### 3.1 Jabatan (menentukan hak approval)

Urutan level, dari rendah ke tinggi:

| Level | Jabatan |
|---|---|
| 1 | Karyawan |
| 2 | Lead |
| 3 | Manager |
| 4 | Senior Manager |
| 5 | HR |
| 6 | Deputi |
| 7 | Direktur |
| 8 | Presdir |

- **Approver tahap Manager:** user berjabatan level ≥ 3 yang berada di **rantai atasan** peserta.
- **Approver tahap HR:** user mana pun berjabatan level ≥ 5 (HR, Deputi, Direktur, Presdir), tidak harus di rantai atasan.

### 3.2 Admin (flag `is_admin`)

Tanda tambahan yang tidak terkait jabatan. Admin dapat:
- Mendaftarkan user: username, password awal, nama, NIK, email (opsional), jabatan, departemen, atasan langsung.
- Mengedit user, mereset password, dan menonaktifkan/mengaktifkan user.
- Mengelola departemen (nama + kategori IT/Non-IT).
- Melihat audit log.

Admin pertama dibuat dengan `npm run seed`, dengan username dan password diambil dari `.env` atau argumen.

## 4. Model Data

```sql
departments(
  id INTEGER PK, name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('IT','NON_IT'))
)

users(
  id INTEGER PK,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,   -- ^[a-z0-9._]{3,32}$
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL, nik TEXT UNIQUE, email TEXT,
  level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 8),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  supervisor_id INTEGER REFERENCES users(id),     -- atasan langsung, NULL hanya untuk puncak (Presdir)
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
)

overtime_requests(
  id INTEGER PK,
  code TEXT UNIQUE NOT NULL,                      -- LBR-YYYY-NNNN, nomor urut per tahun
  requester_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('PERSONAL','GROUP')),
  work_date TEXT NOT NULL,                        -- YYYY-MM-DD (tanggal mulai lembur)
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, -- HH:MM; end <= start berarti lewat tengah malam
  activity TEXT NOT NULL,                         -- kegiatan, wajib, 10–2000 karakter
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','APPROVED','REJECTED','CANCELLED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)

overtime_participants(
  id INTEGER PK,
  request_id INTEGER NOT NULL REFERENCES overtime_requests(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  manager_approver_id INTEGER REFERENCES users(id), -- snapshot approver terdekat saat diajukan
  status TEXT NOT NULL CHECK(status IN ('WAITING_MANAGER','WAITING_HR','APPROVED','REJECTED')),
  manager_decided_by INTEGER REFERENCES users(id), manager_decided_at TEXT, manager_note TEXT,
  hr_decided_by INTEGER REFERENCES users(id), hr_decided_at TEXT, hr_note TEXT,
  actual_start TEXT, actual_end TEXT,              -- realisasi HH:MM
  realized_at TEXT,
  UNIQUE(request_id, user_id)
)

participant_chain(                                 -- snapshot rantai atasan saat diajukan
  participant_id INTEGER NOT NULL REFERENCES overtime_participants(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY(participant_id, user_id)
)

notifications(
  id INTEGER PK, user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, link TEXT, read_at TEXT, created_at TEXT NOT NULL
)

audit_log(
  id INTEGER PK, actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
  detail TEXT, created_at TEXT NOT NULL
)

sessions(sid TEXT PK, data TEXT NOT NULL, expires_at INTEGER NOT NULL)
```

Waktu disimpan sebagai teks ISO lokal (zona waktu server, diasumsikan WIB). Indeks dibuat pada `overtime_participants(status, manager_approver_id)`, `overtime_participants(user_id)`, dan `overtime_requests(work_date)`.

## 5. Aturan Bisnis

### 5.1 Pengajuan

- **Perorangan:** pesertanya hanya pengaju sendiri.
- **Kelompok:** pengaju memilih anggota lewat pencarian nama/username/NIK (user aktif, departemen mana pun). Pengaju otomatis ikut sebagai peserta. Minimal 2 peserta, maksimal 50.
- Peserta yang diundang **tidak perlu menerima undangan**. Mereka cukup mendapat notifikasi.
- Field wajib: tanggal, jam mulai, jam selesai, dan kegiatan.

### 5.2 Validasi waktu

- `work_date` paling lambat **3 hari ke belakang** dari hari ini (H+3), dan paling jauh 30 hari ke depan.
- `end_time == start_time` ditolak. `end_time < start_time` berarti lembur melewati tengah malam (selesai di hari berikutnya).
- Durasi minimal 30 menit, maksimal 12 jam.
- **Bentrok:** pengajuan ditolak kalau ada peserta yang sudah punya lembur aktif (peserta berstatus `WAITING_MANAGER`, `WAITING_HR`, atau `APPROVED`) dengan rentang waktu yang beririsan. Pesan error menyebut nama peserta yang bentrok.
- **Peringatan (tidak memblokir):** kalau total jam peserta melewati **4 jam pada hari itu** atau **18 jam pada minggu itu (Senin–Minggu)**, dihitung dari lembur aktif ditambah pengajuan baru. Peringatan tampil di form sebelum dikirim dan di halaman persetujuan.

### 5.3 Penentuan approver tahap Manager

Untuk setiap peserta P:
1. Telusuri `supervisor_id` dari P ke atas. Simpan seluruh rantai ke `participant_chain`.
2. `manager_approver_id` = orang pertama di rantai yang `level ≥ 3` dan aktif.
3. Kalau tidak ditemukan (misalnya rantai putus atau P adalah Presdir), tahap Manager **dilewati** dan peserta langsung berstatus `WAITING_HR`. Kejadian ini dicatat di audit log.

**Siapa boleh memutuskan tahap Manager untuk P:** user U yang aktif, `U.level ≥ 3`, U ada di `participant_chain` milik P, dan U ≠ P.

Konsekuensinya, Lead (level 2) selalu dilewati. Manager yang mengajukan lembur disetujui oleh atasannya. Atasan yang lebih tinggi di rantai boleh menggantikan approver terdekat.

### 5.4 Tahap HR

- Peserta masuk antrian HR segera setelah tahap Manager-nya disetujui, tanpa menunggu peserta lain.
- **Siapa boleh memutuskan:** user U yang aktif, `U.level ≥ 5`, dan U ≠ P.
- Tidak ada pembatasan departemen atau rantai.

### 5.5 Keputusan

- Setujui atau Tolak, per peserta. **Catatan wajib saat menolak**, dan opsional saat menyetujui.
- Aksi massal: checkbox per baris + "Pilih semua", lalu "Setujui yang dipilih" atau "Tolak yang dipilih" (satu catatan berlaku untuk semua yang ditolak).
- Aksi massal diproses dalam satu transaksi. Baris yang tidak boleh diputuskan oleh user tersebut, atau statusnya sudah berubah, **dilewati** dan dilaporkan ("3 disetujui, 1 dilewati karena sudah diproses").
- Keputusan bersifat final dan tidak bisa diubah.

### 5.6 Status

Peserta: `WAITING_MANAGER` → `WAITING_HR` → `APPROVED`, atau `REJECTED` di tahap mana pun.

Pengajuan (dihitung ulang setiap kali ada keputusan):
- `CANCELLED`: dibatalkan pengaju. Ini hanya boleh dilakukan selama **belum ada keputusan apa pun** pada semua pesertanya.
- `PROCESSING`: masih ada peserta yang berstatus `WAITING_*`.
- `APPROVED`: semua peserta sudah final dan minimal satu `APPROVED`.
- `REJECTED`: semua peserta `REJECTED`.

### 5.7 Realisasi

- Peserta berstatus `APPROVED` bisa mengisi jam realisasi (mulai–selesai) setelah waktu mulai lembur lewat. Peserta mengisi sendiri, atau pengaju mengisikan untuk semua peserta.
- Realisasi bisa diubah sampai **7 hari** setelah tanggal lembur, lalu terkunci.
- Rekap memakai jam realisasi kalau ada, dan jam rencana kalau tidak. Kolom "sumber" di rekap menunjukkan mana yang dipakai.

### 5.8 Notifikasi (di dalam aplikasi)

Notifikasi dikirim saat:
- pengajuan dibuat, ke approver tahap Manager tiap peserta dan ke anggota yang diundang;
- peserta disetujui manager, ke peserta dan pengaju;
- peserta disetujui atau ditolak HR, ke peserta dan pengaju;
- peserta ditolak manager, ke peserta dan pengaju.

Notifikasi untuk tahap HR tidak dikirim satu per satu ke semua HR+. Sebagai gantinya, badge jumlah antrian ditampilkan di menu. Jumlah notifikasi belum dibaca dihitung saat halaman dimuat, tanpa polling.

## 6. Halaman

| Halaman | Akses | Isi |
|---|---|---|
| Login | publik | username + password |
| Ganti Password | semua (wajib saat `must_change_password`) | password lama, baru (min 8 karakter), konfirmasi |
| Dashboard | semua | total jam lembur bulan ini, 5 pengajuan terakhir, badge "menunggu tindakan Anda" |
| Ajukan Lembur | semua | form + pencarian anggota (htmx) + peringatan batas jam (htmx) |
| Pengajuan Saya | semua | daftar pengajuan sebagai pengaju atau peserta, filter status, tombol batal dan isi realisasi |
| Detail Pengajuan | pengaju, peserta, orang di rantai atasan peserta, HR+ | info pengajuan, tabel peserta + status per tahap, timeline dari audit log |
| Persetujuan Manager | level ≥ 3 | default: peserta yang `manager_approver_id` = saya. Tab "Tim Saya": semua `WAITING_MANAGER` yang saya berhak putuskan |
| Persetujuan HR | level ≥ 5 | semua `WAITING_HR` kecuali milik sendiri, dengan filter departemen dan IT/Non-IT |
| Rekap | Manager (peserta di rantai bawahnya), HR+ (semua) | filter periode, departemen, IT/Non-IT, status. Total jam per orang dan per departemen. **Ekspor CSV** (UTF-8 BOM, pemisah `;`, agar langsung terbuka benar di Excel Indonesia) |
| Notifikasi | semua | daftar notifikasi, tandai dibaca |
| Admin: User | admin | daftar + cari, tambah/edit, reset password, aktif/nonaktif |
| Admin: Departemen | admin | CRUD departemen. Departemen yang masih punya user tidak bisa dihapus |
| Admin: Audit Log | admin | daftar aksi, dengan filter |

Semua daftar memakai pagination (25 baris per halaman).

### Validasi admin user

- Username unik, sesuai regex `^[a-z0-9._]{3,32}$` (disimpan dalam huruf kecil).
- Atasan tidak boleh diri sendiri dan tidak boleh membentuk siklus (dicek dengan menelusuri rantai ke atas).
- Hanya jabatan level 8 yang boleh tidak punya atasan. Peringatan ditampilkan kalau atasan berlevel lebih rendah dari bawahannya.
- Menonaktifkan user yang masih menjadi atasan aktif orang lain menampilkan peringatan berisi jumlah bawahannya. Aksi tetap boleh dilakukan, dan approver berikutnya di rantai bisa mengambil alih.
- Minimal harus selalu ada satu admin aktif.

## 7. Keamanan

- Password di-hash dengan bcrypt (cost 10). Login gagal menampilkan pesan generik.
- Rate limit login: 5 kali gagal per username+IP dalam 15 menit, lalu dikunci 15 menit (disimpan di memori).
- Session: cookie `httpOnly`, `sameSite=lax`, `secure` kalau `HTTPS=true`. Idle timeout 8 jam. Session ID diregenerasi setelah login.
- CSRF: token per session, dicek pada semua request non-GET (form hidden field dan header `HX-*` via `hx-headers`).
- Otorisasi diperiksa di server untuk setiap aksi, menggunakan fungsi di `services/approval.js`.
- SQL selalu memakai parameter. EJS memakai `<%= %>` (escape), dan `<%-` hanya untuk partial.
- Header keamanan dasar diset manual: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, dan CSP `default-src 'self'`.
- Semua aksi yang mengubah data dicatat ke `audit_log`.

## 8. Struktur Kode

```
lembur-app/
  package.json, .env.example, README.md
  src/
    app.js              -- membangun Express app (dipakai server & test)
    server.js           -- listen
    config.js
    db/
      schema.sql
      index.js          -- koneksi node:sqlite, PRAGMA foreign_keys/WAL, migrasi sederhana
      seed.js           -- admin awal + contoh departemen (opsional: data demo)
      session-store.js
    services/
      levels.js         -- konstanta jabatan
      time.js           -- durasi, lewat tengah malam, irisan rentang, minggu Senin–Minggu
      approval.js       -- chain, approver terdekat, canDecideManager/canDecideHr, hitung status
      overtime.js       -- buat pengajuan, validasi, bentrok, peringatan, keputusan, realisasi, batal
      users.js          -- CRUD user, validasi username & siklus atasan
      reports.js        -- rekap + CSV
      notifications.js, audit.js
    middleware/         -- requireLogin, requireLevel, requireAdmin, csrf, securityHeaders, rateLimit
    routes/             -- auth, dashboard, requests, approvals, hr, reports, notifications, admin
    views/              -- layout, partials, halaman
  public/               -- style.css, htmx.min.js, app.js kecil (pilih semua checkbox)
  test/                 -- unit (services) + integration (HTTP via app.js, DB in-memory)
  data/                 -- lembur.db (diabaikan git)
```

Service menerima objek `db` sebagai parameter dan tidak tahu-menahu soal Express, sehingga bisa dites dengan SQLite `:memory:`.

## 9. Penanganan Error

- Error validasi ditampilkan kembali di form dengan input user tetap terisi (HTTP 422). Untuk request htmx, yang dirender hanya fragmen error.
- Akses tanpa hak menghasilkan halaman 403. Data tidak ditemukan menghasilkan halaman 404.
- Error tak terduga dicatat ke console dengan stack trace, dan user melihat halaman 500 generik.
- Keputusan approval memakai transaksi plus pengecekan status saat update (`WHERE status = 'WAITING_…'`) untuk mencegah dua approver memutuskan peserta yang sama bersamaan.

## 10. Testing

**Unit (services):**
- Rantai atasan dan approver terdekat: Lead dilewati, pengaju Manager, pengaju HR, Presdir tanpa atasan, rantai berisi user nonaktif.
- `canDecideManager` / `canDecideHr`: atasan lebih tinggi boleh, bukan rantai tidak boleh, diri sendiri tidak boleh.
- Perhitungan status pengajuan untuk semua kombinasi status peserta.
- Validasi waktu: batas H+3, lewat tengah malam, durasi minimal dan maksimal, bentrok, peringatan 4 jam/hari dan 18 jam/minggu.
- Validasi username dan deteksi siklus atasan.

**Integration (HTTP):**
- Login, wajib ganti password, logout, rate limit.
- Alur perorangan: ajukan → Manager setujui → HR setujui → isi realisasi → muncul di rekap.
- Alur kelompok lintas 2 departemen: dua manager berbeda, approve massal sebagian, satu anggota ditolak, status akhir `APPROVED`.
- Otorisasi: Karyawan membuka halaman persetujuan (403), Manager menyetujui peserta di luar rantainya (ditolak), HR menyetujui milik sendiri (ditolak), request tanpa CSRF (403).
- Admin: tambah user, username duplikat, siklus atasan.

## 11. Deploy

- `npm install` → salin `.env.example` ke `.env` (`PORT`, `SESSION_SECRET`, `HTTPS`) → `npm run seed` → `npm start`.
- README berisi panduan menjalankan sebagai service di Windows (NSSM) dan Linux (systemd), serta panduan backup (salin `data/lembur.db` saat aplikasi berhenti, atau gunakan `VACUUM INTO` lewat `npm run backup`).
- `npm run seed -- --demo` mengisi data contoh (struktur organisasi lengkap) untuk mencoba aplikasi.

## 12. Deliverable Tambahan: Dokumen PRD

Setelah aplikasi selesai dan seluruh test lulus, buat dokumen **PRD (Product Requirements Document)** berbahasa Indonesia di folder terpisah dari project: `D:\Kerja\learning\TUGAS AI\document\`.

- File: `PRD-Aplikasi-Pengajuan-Lembur.docx` dan `PRD-Aplikasi-Pengajuan-Lembur.pdf`, dengan isi yang sama.
- Isi: latar belakang dan tujuan, ruang lingkup, pengguna dan role, kebutuhan fungsional (pengajuan, alur approval dua tahap, realisasi, rekap, admin), aturan bisnis, kebutuhan non-fungsional (performa ringan, keamanan, portabilitas), daftar halaman, alur status, di luar cakupan, serta panduan instalasi singkat.
- Isi PRD disusun berdasarkan aplikasi yang sudah jadi, sehingga tetap sesuai kalau ada penyesuaian saat implementasi.

## 13. Di Luar Cakupan

Notifikasi email/WhatsApp, perhitungan upah lembur, integrasi absensi, SSO/LDAP, aplikasi mobile, dan lampiran file. Semua bisa ditambahkan nanti.
