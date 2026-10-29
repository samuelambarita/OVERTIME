# Aplikasi Pengajuan Lembur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikasi web internal pengajuan lembur (perorangan/kelompok) dengan approval dua tahap (Manager di rantai atasan → HR+), realisasi, rekap CSV, dan admin akun; plus dokumen PRD (docx + pdf).

**Architecture:** Express server-rendered (EJS) + htmx untuk aksi parsial; SQLite via `node:sqlite`. Logika bisnis murni di `src/services/*` (menerima `db`, tidak tahu Express) sehingga dites dengan DB `:memory:`; route tipis memanggil service.

**Tech Stack:** Node.js ≥ 22.13 (dev v24), Express 5, EJS 3, express-session, bcryptjs, dotenv, htmx 2 (file lokal), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-pengajuan-lembur-design.md` — baca bagian yang dirujuk tiap task.

## Global Constraints

- Root project: `D:\Kerja\learning\TUGAS AI\lembur-app` (repo git sudah ada). Semua path di bawah relatif ke root ini kecuali Task 13.
- CommonJS (`require`), `"engines": {"node": ">=22.13"}`.
- Dependency runtime HANYA: `express`, `ejs`, `express-session`, `bcryptjs`, `dotenv`. Dev dependency: tidak ada. htmx disalin ke `public/htmx.min.js` (unduh `https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js` sekali, commit filenya). Tidak ada CDN/font eksternal di halaman.
- Seluruh teks UI dan pesan error berbahasa Indonesia.
- Waktu: zona waktu lokal server. Tanggal `YYYY-MM-DD`, jam `HH:MM`, timestamp `YYYY-MM-DDTHH:MM:SS` (lokal, tanpa `Z`).
- Jabatan: 1 Karyawan, 2 Lead, 3 Manager, 4 Senior Manager, 5 HR, 6 Deputi, 7 Direktur, 8 Presdir. Approver Manager: level ≥ 3 di rantai atasan. Approver HR: level ≥ 5.
- Username: regex `^[a-z0-9._]{3,32}$`, disimpan lowercase. Password minimal 8 karakter. bcrypt cost 10.
- Pengajuan: tanggal ≥ hari ini − 3 hari dan ≤ hari ini + 30 hari; durasi 30 menit–12 jam; `end < start` = lewat tengah malam; `end == start` ditolak. Kelompok 2–50 peserta.
- Peringatan (tidak memblokir): > 4 jam/hari, > 18 jam/minggu (Senin–Minggu), dihitung per `work_date`.
- Realisasi bisa diubah sampai 7 hari setelah `work_date`.
- Pagination 25 baris. CSV: UTF-8 BOM, pemisah `;`.
- Session idle 8 jam; rate limit login 5 gagal / 15 menit per `username|ip`.
- Test: `npm test` = `node --test "test/**/*.test.js"`. Setiap task berakhir dengan `npm test` hijau dan commit; pesan commit diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Jangan push ke GitHub tanpa izin eksplisit user.

## Review Focus

1. Lembur lewat tengah malam (mis. Minggu 22:00–02:00): bentrok dihitung dari rentang waktu nyata; batas harian/mingguan dihitung pada `work_date` (hari mulai) — test di Task 2 & 5.
2. Dua approver memutuskan peserta yang sama / aksi massal berisi baris yang sudah diproses: baris dilewati dan dihitung `skipped`, tidak error, status tidak tertimpa — test di Task 6.
3. Approver terdekat nonaktif atau tidak ada: saat diajukan dilewati ke berikutnya; setelah diajukan, atasan lebih tinggi di rantai tetap bisa memutuskan — test di Task 4 & 6.
4. `memberIds` berisi pengaju sendiri / duplikat / user nonaktif / kelompok yang ternyata 1 orang: dedupe, pengaju selalu ikut, nonaktif ditolak, kelompok < 2 ditolak — test di Task 5.
5. Kegiatan berisi `;`, `"`, baris baru, atau diawali `=`,`+`,`-`,`@` (injeksi formula Excel) pada CSV: field dikutip dan diberi prefiks `'` — test di Task 7.

---

## File Structure

```
package.json  .env.example  .gitignore  README.md
src/
  config.js                 env → {port, sessionSecret, secureCookie, dbFile}
  errors.js                 ValidationError, ForbiddenError, NotFoundError
  app.js                    createApp({db, sessionSecret, secureCookie})
  server.js                 openDb + createApp + listen
  db/schema.sql  db/index.js  db/session-store.js  db/demo.js  db/seed.js  db/backup.js
  services/levels.js  time.js  users.js  departments.js  approval.js
           audit.js  notifications.js  overtime.js  decisions.js  queries.js  reports.js
  middleware/auth.js  csrf.js  security.js  rate-limit.js
  routes/auth.js  dashboard.js  requests.js  approvals.js  reports.js  notifications.js  admin.js
  views/layout.ejs  partials/*.ejs  <halaman>.ejs
public/style.css  htmx.min.js  app.js
test/helpers.js  test/unit/*.test.js  test/web/*.test.js
```

---

### Task 1: Scaffold, konfigurasi, DB & schema

**Files:**
- Create: `package.json`, `.env.example`, `src/config.js`, `src/errors.js`, `src/db/schema.sql`, `src/db/index.js`, `src/services/levels.js`
- Modify: `.gitignore` (tambah `backups/`)
- Test: `test/unit/db.test.js`

**Interfaces:**
- Produces:
  - `openDb(file = config.dbFile): DatabaseSync` — buat folder induk bila bukan `':memory:'`; `PRAGMA foreign_keys = ON`; `PRAGMA journal_mode = WAL` (bukan memory); jalankan `schema.sql` (semua `CREATE TABLE/INDEX IF NOT EXISTS`).
  - `tx(db, fn): any` — `BEGIN IMMEDIATE` → `fn()` → `COMMIT`, `ROLLBACK` + rethrow saat error.
  - `config = {port: Number(PORT||3000), sessionSecret: SESSION_SECRET, secureCookie: HTTPS==='true', dbFile: DB_FILE||'data/lembur.db'}`; `server.js` menolak start bila `sessionSecret` kosong.
  - `class ValidationError extends Error { errors: string[] }` (message = errors.join('; ')), `ForbiddenError`, `NotFoundError`.
  - `levels.js`: `LEVELS = {KARYAWAN:1, LEAD:2, MANAGER:3, SENIOR_MANAGER:4, HR:5, DEPUTI:6, DIREKTUR:7, PRESDIR:8}`, `LEVEL_NAMES = {1:'Karyawan',2:'Lead',3:'Manager',4:'Senior Manager',5:'HR',6:'Deputi',7:'Direktur',8:'Presdir'}`, `MIN_MANAGER = 3`, `MIN_HR = 5`.
  - `schema.sql`: persis tabel di spec §4 (`departments`, `users`, `overtime_requests`, `overtime_participants`, `participant_chain`, `notifications`, `audit_log`, `sessions`) + indeks spec §4.
  - `package.json` scripts: `start: node src/server.js`, `test: node --test "test/**/*.test.js"`, `seed: node src/db/seed.js`, `backup: node src/db/backup.js`.

- [ ] **Step 1: `npm init -y`, set `engines`, scripts; `npm install express ejs express-session bcryptjs dotenv`.**
- [ ] **Step 2: Write failing test** `test/unit/db.test.js`:
  - `openDb(':memory:')` → `SELECT name FROM sqlite_master WHERE type='table'` memuat ke-8 tabel.
  - `PRAGMA foreign_keys` → 1.
  - insert user dengan `department_id` 999 → throws.
  - `tx(db, () => { insert dept; throw new Error('x') })` → throws dan dept tidak tersimpan.
- [ ] **Step 3: Run `npm test`** → FAIL (module tidak ada).
- [ ] **Step 4: Implement file-file di atas.**
- [ ] **Step 5: Run `npm test`** → PASS.
- [ ] **Step 6: Commit** `feat: scaffold project, schema SQLite, koneksi db`.

---

### Task 2: Utilitas waktu (`services/time.js`)

**Files:** Create `src/services/time.js`; Test `test/unit/time.test.js`

**Interfaces:**
- Produces:
  - `parseHM(s: string): number` — menit dari tengah malam; throw `ValidationError(['Format tanggal/jam tidak valid.'])` bila bukan `HH:MM` 00–23/00–59.
  - `durationMinutes(startHM, endHM): number` — `(end - start + 1440) % 1440` (sama → 0).
  - `toRange(workDate, startHM, endHM): {start: Date, end: Date}` — end di hari berikutnya bila `end <= start`.
  - `overlaps(a, b): boolean` — rentang setengah-terbuka `a.start < b.end && b.start < a.end`.
  - `formatDate(d: Date): string`, `addDays(dateStr, n): string`, `nowIso(d = new Date()): string`.
  - `weekBounds(dateStr): {from, to}` — Senin s.d. Minggu yang memuat tanggal.
  - `validateSchedule({workDate, startTime, endTime}, now = new Date()): string[]` — pesan persis:
    `'Format tanggal/jam tidak valid.'`, `'Tanggal lembur paling lambat 3 hari ke belakang.'`, `'Tanggal lembur paling jauh 30 hari ke depan.'`, `'Jam selesai tidak boleh sama dengan jam mulai.'`, `'Durasi lembur minimal 30 menit.'`, `'Durasi lembur maksimal 12 jam.'`

- [ ] **Step 1: Write failing tests** (pakai `now = new Date(2026, 9, 29, 10, 0)`):
  - `durationMinutes('22:00','02:00') === 240`; `durationMinutes('08:00','08:00') === 0`.
  - `toRange('2026-11-01','22:00','02:00').end` = 2026-11-02 02:00 lokal.
  - `overlaps(toRange('2026-11-01','22:00','02:00'), toRange('2026-11-02','01:00','03:00')) === true`; `overlaps(range 18–20, range 20–22) === false`.
  - `weekBounds('2026-11-01')` (Minggu) → `{from:'2026-10-26', to:'2026-11-01'}`; `weekBounds('2026-11-02')` → `{from:'2026-11-02', to:'2026-11-08'}`.
  - `validateSchedule` dengan `now`: `'2026-10-26'` → `[]`; `'2026-10-25'` → memuat pesan 3 hari; `'2026-11-29'` → `[]`; `'2026-11-30'` → memuat pesan 30 hari; `08:00–08:00` → pesan sama; `08:00–08:20` → minimal; `06:00–18:01` → maksimal; `06:00–18:00` → `[]`; `'2026-13-01'` / `'25:00'` → format.
- [ ] **Step 2: Run** `node --test test/unit/time.test.js` → FAIL.
- [ ] **Step 3: Implement.** Bandingkan tanggal sebagai string `YYYY-MM-DD` terhadap `addDays(formatDate(now), -3)` dan `+30`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: utilitas waktu dan validasi jadwal lembur`.

---

### Task 3: User, departemen, audit, data demo

**Files:**
- Create: `src/services/users.js`, `src/services/departments.js`, `src/services/audit.js`, `src/db/demo.js`
- Test: `test/unit/users.test.js`, `test/unit/departments.test.js`

**Interfaces:**
- Consumes: `openDb`, `tx`, `ValidationError`, `LEVELS`, `nowIso`.
- Produces:
  - `audit.log(db, actorId|null, action: string, entity: string, entityId|null, detail?: object)` — `detail` disimpan JSON.
  - `departments.js`: `listDepartments(db): {id,name,category,userCount}[]`; `createDepartment(db, actor, {name, category}): number`; `updateDepartment(db, actor, id, {name, category})`; `deleteDepartment(db, actor, id)` — throw `ValidationError(['Departemen masih memiliki user.'])` bila ada user. Nama unik → `'Nama departemen sudah dipakai.'`; category ∈ `IT|NON_IT`.
  - `users.js`:
    - `validateUsername(u): string|null` (pesan `'Username 3–32 karakter: huruf kecil, angka, titik, garis bawah.'`).
    - `createUser(db, actor, data): {id, warnings: string[]}` — `data = {username, password, name, nik?, email?, level, departmentId, supervisorId?, isAdmin?}`; username di-lowercase; `must_change_password = 1`. Error: `'Username sudah dipakai.'`, `'NIK sudah dipakai.'`, `'Password minimal 8 karakter.'`, `'Atasan wajib diisi kecuali Presdir.'`, `'Atasan tidak boleh diri sendiri.'`, `'Atasan membentuk siklus.'`. Warning: `'Jabatan atasan lebih rendah dari bawahan.'`.
    - `updateUser(db, actor, id, data)` — field sama kecuali password; validasi siklus memakai rantai atasan calon.
    - `resetPassword(db, actor, id, newPassword)` → set `must_change_password = 1`.
    - `setActive(db, actor, id, active: boolean): {subordinates: number}` — throw `'Minimal harus ada satu admin aktif.'` bila menonaktifkan admin aktif terakhir; `subordinates` = jumlah user aktif dengan `supervisor_id = id`.
    - `authenticate(db, username, password): user|null` — hanya user aktif.
    - `changePassword(db, userId, oldPw, newPw)` — error `'Password lama salah.'` / minimal 8; set `must_change_password = 0`.
    - `getUser(db, id): user|undefined`; `listUsers(db, {q, page}): {rows, total}`; `searchUsers(db, q, limit = 10): {id,name,username,department}[]` (aktif, cocok nama/username/NIK).
    - `supervisorChain(db, userId): user[]` — dari atasan langsung ke atas, berhenti bila id berulang.
    - Semua mutasi menulis audit (`user.create`, `user.update`, `user.reset_password`, `user.activate`/`user.deactivate`, `department.*`).
    - Objek user dikembalikan dengan nama kolom DB (snake_case) tanpa `password_hash` kecuali di `authenticate` internal.
  - `demo.js`: `buildDemoOrg(db, password = 'Password123'): Record<string, number>` — membuat departemen `IT` (IT), `Finance` (NON_IT) dan user (`must_change_password = 0`), username → atasan:
    `presdir`(8,—), `direktur`(7,presdir), `deputi`(6,presdir), `hr`(5,direktur), `smit`(4,direktur), `mgrit`(3,smit), `leadit`(2,mgrit), `budi`(1,leadit), `andi`(1,leadit), `mgrfin`(3,direktur), `sari`(1,mgrfin), `admin`(1,mgrit, isAdmin). Departemen: IT untuk `smit,mgrit,leadit,budi,andi,admin`; Finance untuk lainnya. Insert langsung via SQL (tidak lewat `createUser`) agar cepat. Dipakai seed `--demo` dan semua test.

- [ ] **Step 1: Write failing tests**: buat user valid → `must_change_password=1`, `authenticate` berhasil, username `'Budi'` tersimpan `'budi'`; duplikat username (beda case) → error; level 1 tanpa atasan → error; level 8 tanpa atasan → OK; siklus (`updateUser(mgrit, supervisorId: budi)` pada org demo) → `'Atasan membentuk siklus.'`; `supervisorChain(budi)` → usernames `['leadit','mgrit','smit','direktur','presdir']`; `setActive(admin,false)` saat satu-satunya admin → error; `setActive(mgrit,false)` → `{subordinates: 2}` (leadit, admin); user nonaktif → `authenticate` null; `changePassword` salah lama → error; `deleteDepartment` IT → error; audit_log bertambah setelah `createUser`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: layanan user, departemen, audit, data demo`.

---

### Task 4: Aturan approval (`services/approval.js`)

**Files:** Create `src/services/approval.js`; Test `test/unit/approval.test.js`

**Interfaces:**
- Consumes: `supervisorChain`, `MIN_MANAGER`, `MIN_HR`.
- Produces:
  - `nearestManager(chain: user[]): user|null` — pertama yang `is_active` dan `level >= 3`.
  - `canDecideManager(db, actor, participant): boolean` — `actor.is_active`, `actor.level >= 3`, `actor.id !== participant.user_id`, `participant.status === 'WAITING_MANAGER'`, dan ada baris `participant_chain(participant.id, actor.id)`.
  - `canDecideHr(actor, participant): boolean` — aktif, `level >= 5`, bukan dirinya, status `WAITING_HR`.
  - `computeRequestStatus(participantStatuses: string[]): 'PROCESSING'|'APPROVED'|'REJECTED'` — ada `WAITING_*` → PROCESSING; semua REJECTED → REJECTED; selain itu APPROVED. (`CANCELLED` ditangani pemanggil.)

- [ ] **Step 1: Write failing tests** (org demo): `nearestManager(chain budi)` → `mgrit` (Lead dilewati); chain `mgrit` → `smit`; chain `hr` → `direktur`; chain `presdir` → `null`; `mgrit` dinonaktifkan → chain budi → `smit`. Untuk `canDecideManager` sisipkan participant + `participant_chain` manual: `smit` (lebih tinggi di rantai) → true; `mgrfin` (luar rantai) → false; `leadit` (level 2) → false; peserta itu sendiri → false; status `WAITING_HR` → false. `canDecideHr`: `hr` → true, `deputi` → true, `smit` → false, `hr` untuk peserta `hr` → false. `computeRequestStatus`: `['APPROVED','WAITING_HR']`→PROCESSING, `['REJECTED','REJECTED']`→REJECTED, `['APPROVED','REJECTED']`→APPROVED.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: aturan approval berbasis rantai atasan`.

---

### Task 5: Membuat & membatalkan pengajuan, notifikasi

**Files:**
- Create: `src/services/notifications.js`, `src/services/overtime.js`
- Test: `test/unit/overtime-create.test.js`, `test/unit/notifications.test.js`

**Interfaces:**
- Consumes: `validateSchedule`, `toRange`, `overlaps`, `durationMinutes`, `weekBounds`, `supervisorChain`, `nearestManager`, `computeRequestStatus`, `audit.log`, `tx`.
- Produces:
  - `notifications.js`: `notify(db, userId, message, link)`; `listNotifications(db, userId, page)`; `unreadCount(db, userId): number`; `markRead(db, userId, id|'all')`.
  - `overtime.js`:
    - `findConflicts(db, userIds, {workDate, startTime, endTime}, excludeRequestId = null): string[]` — nama user yang punya partisipasi aktif (`WAITING_MANAGER|WAITING_HR|APPROVED`, request bukan CANCELLED) dengan rentang beririsan; cukup cek `work_date` di [tanggal−1, tanggal+1].
    - `checkWarnings(db, userIds, {workDate, startTime, endTime}, excludeRequestId = null): string[]` — format persis `` `${name}: total ${jam} jam pada ${workDate} (batas 4 jam/hari)` `` dan `` `${name}: total ${jam} jam pada minggu ${from} s.d. ${to} (batas 18 jam/minggu)` ``; `jam` = menit/60 dibulatkan 1 desimal, koma desimal (`4,5`), tanpa `,0`. Durasi pakai realisasi bila ada, selain itu rencana.
    - `createRequest(db, actor, input, now = new Date()): {id, code, warnings}` — `input = {type, workDate, startTime, endTime, activity, memberIds?: number[]}`. Dalam satu `tx`: validasi (`validateSchedule`; activity di-trim 10–2000 → `'Kegiatan wajib diisi (10–2000 karakter).'`; type valid); peserta = dedupe(`[actor.id, ...memberIds]`) untuk GROUP, `[actor.id]` untuk PERSONAL; peserta nonaktif/tidak ada → `'Peserta tidak valid.'`; GROUP < 2 → `'Pengajuan kelompok minimal 2 peserta.'`; > 50 → `'Pengajuan kelompok maksimal 50 peserta.'`; bentrok → `` `Jadwal bentrok dengan lembur lain: ${names.join(', ')}.` ``. Kode `LBR-${tahun}-${NNNN}` (urut per tahun dari `created_at`, 4 digit). Per peserta: simpan `participant_chain` (seluruh `supervisorChain`), `manager_approver_id = nearestManager(chain)?.id`; bila null → status `WAITING_HR` + audit `participant.skip_manager`; selain itu `WAITING_MANAGER`. Notifikasi: tiap approver manager (sekali per approver) `` `Pengajuan lembur ${code} menunggu persetujuan Anda.` `` link `/persetujuan`; tiap anggota undangan selain pengaju `` `${actor.name} mengajak Anda lembur (${code}).` `` link `/pengajuan/${id}`. Audit `request.create`. Status request dihitung `computeRequestStatus`.
    - `cancelRequest(db, actor, requestId)` — hanya pengaju; hanya bila semua peserta `manager_decided_at IS NULL AND hr_decided_at IS NULL` dan status PROCESSING → status `CANCELLED`; jika tidak: `ForbiddenError` / `ValidationError(['Pengajuan tidak bisa dibatalkan karena sudah ada keputusan.'])`.

- [ ] **Step 1: Write failing tests** (org demo, `now = new Date(2026, 9, 29, 10, 0)`):
  - PERSONAL budi 2026-10-30 18:00–21:00 → kode `LBR-2026-0001`, 1 peserta `WAITING_MANAGER`, `manager_approver_id = mgrit`, `participant_chain` berisi 5 baris, mgrit dapat 1 notifikasi.
  - GROUP oleh budi dengan `memberIds [budi, sari, sari]` → 2 peserta (dedupe), approver budi=mgrit, sari=mgrfin; sari dapat notifikasi ajakan.
  - GROUP `memberIds []` → `'Pengajuan kelompok minimal 2 peserta.'`; member nonaktif → `'Peserta tidak valid.'`.
  - Pengajuan presdir → peserta langsung `WAITING_HR`.
  - Bentrok lewat tengah malam: budi 2026-11-01 22:00–02:00 lalu 2026-11-02 01:00–03:00 → error memuat `'Budi'`; pengajuan pertama yang CANCELLED tidak dihitung bentrok.
  - `checkWarnings` budi: sudah ada 3 jam pada 2026-10-30, baru 2 jam → memuat `'total 5 jam pada 2026-10-30 (batas 4 jam/hari)'`; total minggu 19 jam → pesan 18 jam/minggu.
  - Kode kedua → `LBR-2026-0002`.
  - `cancelRequest` oleh non-pengaju → ForbiddenError; setelah ada keputusan → ValidationError; sebelum → status CANCELLED.
  - notifications: `unreadCount` turun setelah `markRead(…, 'all')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: pembuatan dan pembatalan pengajuan lembur`.

---

### Task 6: Keputusan Manager/HR & realisasi (`services/decisions.js`)

**Files:** Create `src/services/decisions.js`; Modify `src/services/overtime.js` (tambah realisasi); Test `test/unit/decisions.test.js`

**Interfaces:**
- Consumes: `canDecideManager`, `canDecideHr`, `computeRequestStatus`, `notify`, `audit.log`, `tx`.
- Produces:
  - `decideManager(db, actor, participantIds: number[], decision: 'APPROVE'|'REJECT', note = ''): {done: number, skipped: number}` — REJECT tanpa note (trim) → `ValidationError(['Catatan wajib diisi saat menolak.'])`. Dalam satu `tx`, per id: lewati (skipped++) bila tidak ada atau `!canDecideManager`; `UPDATE … SET status = ?, manager_decided_by, manager_decided_at, manager_note WHERE id = ? AND status = 'WAITING_MANAGER'` (changes 0 → skipped). APPROVE → `WAITING_HR`; REJECT → `REJECTED`. Lalu hitung ulang status tiap request yang tersentuh (`updated_at`). Notifikasi ke peserta & pengaju (sekali per orang per request): approve `` `Lembur ${code} disetujui manager, menunggu HR.` ``, tolak `` `Lembur ${code} ditolak manager: ${note}` ``. Audit `participant.manager_approve|reject`.
  - `decideHr(db, actor, participantIds, decision, note = '')` — sama; status `WAITING_HR` → `APPROVED|REJECTED`; kolom `hr_*`; pesan `` `Lembur ${code} disetujui HR.` `` / `` `Lembur ${code} ditolak HR: ${note}` ``.
  - `overtime.saveRealization(db, actor, participantId, {actualStart, actualEnd}, now = new Date())` — actor = peserta atau pengaju; peserta `APPROVED`; `now >= toRange(...).start`; `formatDate(now) <= addDays(work_date, 7)`; jam valid & tidak sama, durasi ≤ 12 jam. Pesan: `'Realisasi hanya untuk peserta yang disetujui.'`, `'Realisasi bisa diisi setelah lembur dimulai.'`, `'Realisasi sudah terkunci (lewat 7 hari).'`. Set `realized_at`. Audit `participant.realize`.

- [ ] **Step 1: Write failing tests** (pengajuan GROUP budi+sari dibuat lewat `createRequest`):
  - `decideManager(mgrit, [pBudi, pSari], 'APPROVE')` → `{done:1, skipped:1}` (sari bukan bawahan mgrit); pBudi `WAITING_HR`; request PROCESSING.
  - `decideManager(smit, [pBudi], …)` setelah sudah diproses → `{done:0, skipped:1}` (Review Focus #2).
  - `smit` (lebih tinggi di rantai) bisa menyetujui peserta yang approver terdekatnya mgrit (Review Focus #3).
  - REJECT tanpa catatan → ValidationError.
  - `decideManager(mgrfin, [pSari], 'REJECT', 'Tidak mendesak')` → pSari REJECTED, notifikasi ke sari & budi memuat `'ditolak manager: Tidak mendesak'`.
  - `decideHr(hr, [pBudi], 'APPROVE')` → APPROVED; request APPROVED (satu disetujui, satu ditolak).
  - `decideHr(hr, …)` untuk peserta `hr` sendiri → skipped.
  - Realisasi: sebelum mulai → error; `now` = work_date + 8 hari → terkunci; valid → tersimpan.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: keputusan manager/HR massal dan realisasi`.

---

### Task 7: Query daftar, detail, rekap & CSV

**Files:** Create `src/services/queries.js`, `src/services/reports.js`; Test `test/unit/queries.test.js`, `test/unit/reports.test.js`

**Interfaces:**
- Produces (`queries.js`):
  - `getRequestDetail(db, actor, id): {request, participants, timeline}` — `NotFoundError` bila tak ada; akses: pengaju, peserta, actor ada di `participant_chain` salah satu peserta, atau `actor.level >= 5`, selain itu `ForbiddenError`. `participants` memuat nama, departemen, status, nama pemutus, catatan, realisasi. `timeline` = audit_log entitas request & pesertanya, urut waktu.
  - `listMyRequests(db, userId, {status?, page = 1}): {rows, total}` — sebagai pengaju atau peserta, terbaru dulu.
  - `listManagerQueue(db, actor, {scope: 'mine'|'team', page}): {rows, total}` — `WAITING_MANAGER`; `mine`: `manager_approver_id = actor.id`; `team`: actor ada di `participant_chain`; selalu kecuali peserta = actor. Baris memuat `warnings` dari `checkWarnings` untuk peserta itu.
  - `listHrQueue(db, actor, {departmentId?, category?, page}): {rows, total}` — `WAITING_HR`, `user_id != actor.id`.
  - `pendingCounts(db, actor): {manager: number, hr: number}` — manager = jumlah `team` scope (0 bila level < 3), hr (0 bila level < 5).
  - `dashboardData(db, actor, now = new Date()): {monthMinutes, recent, pending}` — `monthMinutes` dari partisipasi APPROVED actor bulan berjalan (realisasi bila ada).
- Produces (`reports.js`):
  - `recap(db, actor, {from, to, departmentId?, category?, status = 'APPROVED'}): row[]` — `row = {code, workDate, name, username, department, category, start, end, minutes, source: 'Realisasi'|'Rencana', status}`; cakupan: level ≥ 5 semua; level 3–4 hanya peserta yang rantainya memuat actor; level < 3 → `ForbiddenError`.
  - `summarize(rows): {totalMinutes, perUser: {name, department, minutes}[], perDepartment: {department, category, minutes}[]}` urut menit menurun.
  - `row` juga memuat `activity`.
  - `toCsv(rows): string` — `'\uFEFF'` + header persis `Kode;Tanggal;Nama;Username;Departemen;Kategori;Mulai;Selesai;Durasi (jam);Sumber;Status;Kegiatan` + baris dipisah `\r\n`; durasi koma desimal 2 angka (`2,50`); field yang mengandung `;`, `"`, `\r`, `\n` dikutip dengan `"` digandakan; field yang diawali `=`,`+`,`-`,`@` diberi prefiks `'`. Status dalam Bahasa Indonesia (`Diproses`, `Disetujui`, `Ditolak`, `Dibatalkan`, `Menunggu Manager`, `Menunggu HR`) — ekspor `STATUS_LABELS` dari `queries.js` untuk dipakai view juga.

- [ ] **Step 1: Write failing tests**: akses detail (budi ✓, mgrit ✓, hr ✓, andi ✗ Forbidden, id 999 NotFound); `listManagerQueue(mgrit,'mine')` hanya peserta IT; `team` untuk smit memuat budi; `listHrQueue(hr)` tak memuat milik hr; `pendingCounts(budi)` → `{manager:0, hr:0}`; `recap` oleh mgrfin tidak memuat budi, oleh hr memuat semua, oleh budi Forbidden; realisasi 18:00–20:30 → `source 'Realisasi'`, minutes 150; `toCsv` diawali BOM, header persis, durasi `2,50`; kegiatan `'Deploy; "hotfix"\nmalam'` → `"Deploy; ""hotfix""\nmalam"`; kegiatan `'-rollback'` → `'-rollback`; nama `=SUM(A1)` → `'=SUM(A1)` (Review Focus #5).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: query daftar/detail, rekap dan ekspor CSV`.

---

### Task 8: Fondasi web — app, session, keamanan, login

**Files:**
- Create: `src/app.js`, `src/server.js`, `src/db/session-store.js`, `src/middleware/{auth,csrf,security,rate-limit}.js`, `src/routes/auth.js`, `src/views/layout.ejs`, `src/views/partials/{nav,flash,errors,pagination}.ejs`, `src/views/{login,change-password,error}.ejs`, `public/style.css`, `public/htmx.min.js`, `public/app.js`
- Test: `test/helpers.js`, `test/web/auth.test.js`

**Interfaces:**
- Produces:
  - `createApp({db, sessionSecret, secureCookie = false}): express.Application` — urutan: `security`, static `public/`, `express.urlencoded({extended:false})`, session (`SqliteStore`, cookie `httpOnly`, `sameSite:'lax'`, `secure`, `maxAge` 8 jam, `rolling: true`, `name: 'lembur.sid'`), `loadUser` (set `req.user`, `res.locals.user`, `res.locals.unread`, `res.locals.pending`, `res.locals.LEVEL_NAMES`, `STATUS_LABELS`), `csrf`, routes, 404, error handler (ValidationError→422 render ulang oleh route; ForbiddenError→403 `error.ejs`; NotFoundError→404; lainnya→500 + `console.error`). `app.locals.db = db`.
  - `SqliteStore(db)` extends `session.Store`: `get/set/destroy/touch`; hapus sesi kedaluwarsa saat `get`.
  - `requireLogin` (redirect `/login`; bila `must_change_password` dan path ≠ `/ganti-password`/`/logout` → redirect `/ganti-password`), `requireLevel(min)`, `requireAdmin` (403).
  - `csrf`: `req.session.csrf` (32 byte hex) → `res.locals.csrfToken`; non-GET wajib `req.body._csrf === token` atau header `x-csrf-token` → selain itu 403.
  - `security`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'`.
  - `rate-limit.js`: `createLoginLimiter({max = 5, windowMs = 15*60*1000}) → {isBlocked(key), fail(key), reset(key)}`.
  - Routes: `GET/POST /login`, `POST /logout`, `GET/POST /ganti-password`. Login gagal → `'Username atau password salah.'`; terblokir → `'Terlalu banyak percobaan. Coba lagi dalam 15 menit.'` (429). Sukses → `req.session.regenerate` → redirect `/`.
  - `layout.ejs`: `<meta name="htmx-config" content='{"includeIndicatorStyles":false}'>` (CSP tanpa inline style), `<body hx-headers='{"x-csrf-token":"<%= csrfToken %>"}'>`, nav sesuai level (Persetujuan ≥3 dengan badge `pending.manager`, Persetujuan HR ≥5 badge `pending.hr`, Rekap ≥3, Admin bila admin), lonceng dengan `unread`. Tidak ada `<script>`/`style=` inline.
  - `public/app.js`: checkbox `[data-select-all]` mengatur semua `input[name=ids]` dalam form yang sama.
  - `style.css`: ≤ 12 KB, responsif (tabel scroll horizontal di layar sempit), font sistem.
  - `test/helpers.js`: `startApp(): Promise<{db, ids, base, close}>` (DB `:memory:`, `buildDemoOrg`, `listen(0)`); `class Client {constructor(base); get(path, {htmx}={}); post(path, fields, {htmx}={}) }` — simpan cookie, `redirect: 'manual'`, ambil CSRF dari HTML terakhir (`name="_csrf" value="…"` atau `x-csrf-token":"…"`), otomatis `GET` halaman sebelum POST bila belum punya token; kembalikan `{status, headers, text}`; `login(base, username, password = 'Password123'): Promise<Client>`.

- [ ] **Step 1: Write failing tests** `test/web/auth.test.js`: `GET /` tanpa login → 302 `/login`; login benar → 302 `/`, lalu `GET /` 200 memuat nama user; login salah → 200 memuat pesan; 6× salah → 429; user `must_change_password=1` → `GET /` 302 `/ganti-password`, ganti sukses → `/` 200; POST tanpa `_csrf` → 403; respons memuat header CSP & `X-Frame-Options`; logout → `GET /` 302.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (route `/` sementara render placeholder dashboard; diganti di Task 9).
- [ ] **Step 4: Run** → PASS; jalankan juga `SESSION_SECRET=x npm start` dan buka `http://localhost:3000/login` — halaman tampil, tidak ada error CSP di console.
- [ ] **Step 5: Commit** `feat: fondasi web, session, csrf, login`.

---

### Task 9: Halaman karyawan — dashboard, ajukan, daftar, detail, realisasi, notifikasi

**Files:**
- Create: `src/routes/{dashboard,requests,notifications}.js`, `src/views/{dashboard,request-new,request-list,request-detail,notifications}.ejs`, `src/views/partials/{member-results,warnings}.ejs`
- Test: `test/web/requests.test.js`

**Interfaces:**
- Consumes: `createRequest`, `cancelRequest`, `saveRealization`, `checkWarnings`, `searchUsers`, `queries.*`, `notifications.*`.
- Produces routes:
  - `GET /` dashboard (`dashboardData`).
  - `GET /pengajuan/baru`; `POST /pengajuan` → sukses: flash `` `Pengajuan ${code} terkirim.` `` + redirect `/pengajuan/${id}`; ValidationError → 422 render form dengan input & error.
  - `GET /pengajuan/cari-anggota?q=` (htmx, min 2 huruf) → `member-results.ejs`: tombol yang menambah `<input type=hidden name=memberIds>` + chip (lewat `public/app.js`, tanpa inline script).
  - `POST /pengajuan/cek` (htmx, `hx-trigger="change"` pada field waktu & anggota) → `warnings.ejs` dari `checkWarnings` + `findConflicts`.
  - `GET /pengajuan?status=&page=` daftar saya.
  - `GET /pengajuan/:id` detail; `POST /pengajuan/:id/batal`; `POST /pengajuan/peserta/:pid/realisasi` (`actualStart`, `actualEnd`) → redirect ke detail dengan flash.
  - `GET /notifikasi`; `POST /notifikasi/:id/baca`; `POST /notifikasi/baca-semua`.
  - Flash: `req.session.flash = {type, message}` dibaca sekali di `loadUser`.

- [ ] **Step 1: Write failing tests**: budi kirim PERSONAL valid → 302 ke `/pengajuan/<id>`, detail 200 memuat `LBR-2026-` dan kegiatan; kegiatan kosong → 422 memuat `'Kegiatan wajib diisi'` dan tanggal yang diisi tetap ada; GROUP budi + sari (`memberIds` sari) → detail memuat `Sari` & `Menunggu Manager`; `GET /pengajuan/cari-anggota?q=sar` dengan header `HX-Request` → memuat `sari` dan bukan `<html`; andi buka detail pengajuan budi → 403; budi batal → status `Dibatalkan`; `/notifikasi` mgrit memuat kode pengajuan; kegiatan `<script>alert(1)</script>` tampil ter-escape (`&lt;script&gt;`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Field tanggal `type=date`, jam `type=time`; tanggal dihitung di server memakai `new Date()` (route tidak menerima `now`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: halaman pengajuan, detail, realisasi, notifikasi`.

---

### Task 10: Halaman Persetujuan Manager & HR

**Files:**
- Create: `src/routes/approvals.js`, `src/views/{approvals-manager,approvals-hr}.ejs`, `src/views/partials/approval-table.ejs`
- Test: `test/web/approvals.test.js`

**Interfaces:**
- Consumes: `decideManager`, `decideHr`, `listManagerQueue`, `listHrQueue`.
- Produces routes:
  - `GET /persetujuan?tab=mine|team&page=` (`requireLevel(3)`); `POST /persetujuan` body `ids` (satu atau banyak), `decision` (`APPROVE|REJECT`), `note`.
  - `GET /persetujuan-hr?departmentId=&category=&page=` (`requireLevel(5)`); `POST /persetujuan-hr` body sama.
  - Tabel: dikelompokkan per kode pengajuan; kolom checkbox, nama, departemen, tanggal, jam, durasi, kegiatan (dipotong 120 karakter, tooltip `title`), peringatan (kuning); tombol per baris (form kecil dengan `ids` tunggal) + toolbar "Setujui yang dipilih" / "Tolak yang dipilih" + textarea catatan. Hasil → flash `` `${done} diproses, ${skipped} dilewati.` `` (bagian "dilewati" hanya bila > 0) dan redirect ke halaman yang sama. ValidationError (catatan kosong) → flash error, redirect.

- [ ] **Step 1: Write failing tests**: budi `GET /persetujuan` → 403; mgrit `/persetujuan` memuat budi, tidak memuat sari; mgrit POST `ids=[pBudi,pSari]&decision=APPROVE` → flash `'1 diproses, 1 dilewati.'`; mgrfin tolak sari tanpa catatan → flash memuat `'Catatan wajib'`, status tetap; mgrit `GET /persetujuan-hr` → 403; hr `/persetujuan-hr` memuat budi; hr approve → detail budi `Disetujui`; POST `/persetujuan` tanpa CSRF → 403.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Normalisasi `ids`: `[].concat(req.body.ids || []).map(Number).filter(Number.isInteger)`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: halaman persetujuan manager dan HR dengan aksi massal`.

---

### Task 11: Rekap & Admin

**Files:**
- Create: `src/routes/reports.js`, `src/routes/admin.js`, `src/views/{report,admin-users,admin-user-form,admin-departments,admin-audit}.ejs`
- Test: `test/web/reports.test.js`, `test/web/admin.test.js`

**Interfaces:**
- Produces routes:
  - `GET /rekap?from=&to=&departmentId=&category=&status=` (`requireLevel(3)`; default `from` = tanggal 1 bulan ini, `to` = hari ini) → tabel `summarize` + detail (paginated 25). `GET /rekap.csv?…` → `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="rekap-lembur-${from}-${to}.csv"`.
  - Admin (`requireAdmin`): `GET /admin/users?q=&page=`, `GET /admin/users/baru`, `POST /admin/users`, `GET /admin/users/:id/edit`, `POST /admin/users/:id`, `POST /admin/users/:id/reset-password` (password baru dari form), `POST /admin/users/:id/status` (`active=1|0`; flash memuat jumlah bawahan bila > 0: `` `User dinonaktifkan. ${n} bawahan masih menunjuk user ini sebagai atasan.` ``), `GET/POST /admin/departemen`, `POST /admin/departemen/:id`, `POST /admin/departemen/:id/hapus`, `GET /admin/audit?action=&page=`.
  - Form user: pilihan atasan = semua user aktif (nama — jabatan — departemen), jabatan dari `LEVEL_NAMES`; warnings dari `createUser/updateUser` tampil sebagai flash kuning.

- [ ] **Step 1: Write failing tests**: budi `/rekap` → 403; hr `/rekap.csv` → 200, header `text/csv`, body diawali BOM + header CSV; mgrfin `/rekap` tidak memuat budi; budi `/admin/users` → 403; admin buat user `rina` → login `rina` diarahkan ke `/ganti-password`; buat `Rina` lagi → 422 `'Username sudah dipakai.'`; admin nonaktifkan mgrit → flash memuat `'2 bawahan'`; admin hapus departemen IT → pesan `'Departemen masih memiliki user.'`; `/admin/audit` memuat `user.create`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: rekap dengan ekspor CSV dan halaman admin`.

---

### Task 12: Seed, backup, README, alur end-to-end

**Files:**
- Create: `src/db/seed.js`, `src/db/backup.js`, `README.md`, `.env.example` (lengkapi)
- Test: `test/web/e2e.test.js`

**Interfaces:**
- Produces:
  - `npm run seed -- --username <u> --password <p>` (fallback env `ADMIN_USERNAME`, `ADMIN_PASSWORD`): buat departemen `Umum` (NON_IT) bila belum ada departemen; buat user admin (level 1, tanpa atasan, `is_admin=1`, `must_change_password=1`) bila belum ada admin; idempoten (jalan kedua mencetak `Admin sudah ada, dilewati.`). `--demo` memanggil `buildDemoOrg` bila tabel users kosong lalu mencetak daftar username + password `Password123`.
  - `npm run backup` → `VACUUM INTO 'backups/lembur-YYYYMMDD-HHMMSS.db'`, cetak path.
  - README (Bahasa Indonesia): fitur, kebutuhan (Node ≥ 22.13), instalasi (`npm install`, salin `.env.example`, `npm run seed`, `npm start`), data demo, role & alur approval ringkas, menjalankan sebagai service Windows (NSSM: `nssm install LemburApp "C:\Program Files\nodejs\node.exe" src\server.js` + set AppDirectory) dan Linux (contoh unit systemd), backup & restore, HTTPS lewat reverse proxy (set `HTTPS=true`), menjalankan test.

- [ ] **Step 1: Write failing test** `e2e.test.js`: alur penuh lewat HTTP — budi ajukan GROUP (budi, andi, sari) tanggal **kemarin** 18:00–21:00 (agar realisasi bisa diisi) → mgrit approve massal budi+andi → mgrfin tolak sari dengan catatan → hr approve semua yang dipilih → detail status `Disetujui`, sari `Ditolak` → budi isi realisasi 18:00–20:30 → hr `/rekap.csv` memuat baris budi `2,50` `Realisasi`.
- [ ] **Step 2: Run** → FAIL bila ada celah; perbaiki di file terkait.
- [ ] **Step 3: Implement seed/backup/README.** Uji manual: hapus `data/`, `npm run seed -- --demo`, `npm start`, login `budi`/`Password123`, jalankan alur di browser (cek tampilan layar lebar & sempit 375 px).
- [ ] **Step 4: Run** `npm test` → semua PASS.
- [ ] **Step 5: Commit** `feat: seed, backup, README, test end-to-end`.

---

### Task 13: Dokumen PRD (docx + pdf)

**Files:**
- Create: `D:\Kerja\learning\TUGAS AI\document\PRD-Aplikasi-Pengajuan-Lembur.docx`, `…\PRD-Aplikasi-Pengajuan-Lembur.pdf`
- Alat bantu pembuatan (script generator) di scratchpad sesi, BUKAN di folder project maupun `document\`.

**Isi (spec §12, Bahasa Indonesia):** sampul (judul, versi 1.0, tanggal), riwayat dokumen, 1 Latar belakang & tujuan, 2 Ruang lingkup, 3 Pengguna & role (tabel jabatan + admin), 4 Kebutuhan fungsional (pengajuan, alur approval dua tahap, realisasi, notifikasi, rekap/CSV, admin) dengan ID `FR-01…`, 5 Aturan bisnis (angka persis dari Global Constraints), 6 Diagram/ tabel alur status peserta & pengajuan, 7 Kebutuhan non-fungsional (ringan, keamanan, portabilitas) `NFR-01…`, 8 Daftar halaman & hak akses, 9 Di luar cakupan, 10 Panduan instalasi singkat. Isi diselaraskan dengan aplikasi yang sudah jadi (cek README & route aktual).

- [ ] **Step 1:** Gunakan skill `anthropic-skills:docx` untuk membuat `.docx` (heading bertingkat, tabel, daftar isi).
- [ ] **Step 2:** Hasilkan `.pdf` dengan isi sama: ekspor dari docx via Microsoft Word COM bila Word terpasang; bila tidak, gunakan skill `anthropic-skills:pdf`.
- [ ] **Step 3: Verifikasi:** kedua file ada, PDF terbuka dan jumlah halaman > 3, headings 1–10 ada di keduanya (ekstrak teks dan cek).
- [ ] **Step 4:** Tidak di-commit ke repo project (folder di luar repo). Laporkan path kedua file.

---

### Task 14: Siapkan remote GitHub (tanpa push)

- [ ] **Step 1:** `git remote add origin https://github.com/samuelambarita/OVERTIME.git` (bila belum ada); `git status` bersih.
- [ ] **Step 2:** Tanyakan user sebelum `git push -u origin <branch>`; push hanya setelah izin eksplisit.
