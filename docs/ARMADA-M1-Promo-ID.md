# ARMADA M.1 — Paket promo (Bahasa Indonesia)

Cetak flyer satu halaman A4. Skrip 6 slide sekitar 6–8 menit. Lengkapi dengan tangkapan layar Jobs, Dispatch Live, APK Field, dan Approve manajer.

---

## A. Ringkasan fitur (untuk website / proposal)

**ARMADA M.1** adalah lapisan kerja di atas pelacakan armada: merencanakan pekerjaan, menjalankannya di HP, dan membuktikan bahwa pekerjaan itu selesai.

Meja merencanakan. Lapangan mengeksekusi. Manajer menutup siklus.

### Dispatch — *Rencanakan hari. Tetapkan rute. Kirim dengan bukti.*

**Perencanaan**
- Kotak masuk order harian (pin peta, pencarian alamat / POI, atau formulir)
- Drop saja, pickup saja, atau pickup lalu drop
- Katalog barang (SKU, satuan, volume, berat, tampilan stok on-hand) dan baris kargo di order
- Cetak QR / barcode dan Write NFC di meja; Field scan untuk menambah atau mengonfirmasi kargo
- Serial / lot opsional, tag kendaraan, tag lokasi depo — Admin mengatur per peran Field
- Impor CSV untuk order dan barang
- Template rutin: harian, hari kerja, atau mingguan
- Order tersisa bisa dibawa ke hari berikutnya
- Depo, zona, kapasitas kendaraan (m³ / kg), opsi ganjil-genap saat merute

**Penugasan**
- Buat job di kendaraan Armada, set kapasitas, tetapkan pengemudi
- Assign manual dari kotak masuk, dengan cek kapasitas
- Auto-plan hari (CVRP): satu depo atau banyak, pratinjau lalu terapkan
- Pemulihan siang hari: sisa pekerjaan, pengecualian, tampilan SLA
- Optimasi urutan stop di jaringan jalan
- Tur multi-hari
- Setelah rute selesai, order tambahan menjadi **trip baru** untuk pengemudi yang sama — tidak menempel di job yang sudah selesai

**Eksekusi & bukti**
- Pengemudi bekerja per stop: navigasi, mulai, selesai
- Scan kargo di Field (kamera / ketik / NFC di APK) sesuai matriks Admin
- GPS HP dan GPS kendaraan tersimpan saat mulai dan selesai
- Foto bukti serah (POD) opsional sebelum selesai
- Skip / reschedule memakai **nomor order yang sama** di tanggal baru
- Job tertutup saat stop terakhir selesai
- WhatsApp saat job ditugaskan, saat rute mendapat stop baru, dan saat trip baru dibuat

**Dispatch Live**
- Kartu pengemudi: pending, dalam perjalanan, terkirim
- Manifest: waktu mulai/selesai, POD, koordinat HP vs rencana vs kendaraan
- Peta, linimasa, jejak HP dan trek kendaraan
- Sumber posisi dilabeli: HP pengemudi atau GPS kendaraan, plus jarak antara keduanya

### Maintenance — *Jadwalkan servis. Teknisi mengerjakan. Manajer mengunci.*

**Jadwal**
- Event servis di kendaraan: tanggal, interval kalender, km, dan/atau jam mesin
- Jendela “akan jatuh tempo” sebelum batas
- Katalog suku cadang / jasa / tenaga kerja (SKU, on-hand, cetak QR / Write NFC di meja)
- Setelah teknisi menandai Selesai, siklus berikutnya bisa dibuat otomatis

**Eksekusi**
- Assign teknisi → WhatsApp
- Field: Mulai (timer), catatan, odometer, baris katalog, foto
- Scan suku cadang (serial opsional); wajib scan sebelum Selesai jika Admin mengaktifkannya
- Draf bisa tersimpan di perangkat sampai dikirim
- Skip tanpa menyelesaikan; bisa dibuka ulang
- Selesai **bukan** penutup — menunggu manajer

**Penutupan**
- Manajer meninjau foto, baris, dan biaya
- **Setujui** mengunci job (terminal)
- Assign job siklus berikutnya, atau akhiri seri
- Pengingat: ditugaskan, akan jatuh tempo, terlambat, due berikutnya — WhatsApp, email, dan inbox

Papan meja: perhatian, akan datang, jatuh tempo, terlambat, selesai. Tampilan biaya dan hasil servis.

### Aplikasi Android Field (APK ARMADA Field)

Situs Field yang sama (`/m`), sebagai aplikasi HP. Tab Dispatch dan Maintenance dalam satu tempat.

- Masuk sebagai pengguna lapangan (peran: operator, driver, dispatcher, manager, worker1/2, field1/2)
- **Dispatch:** kalender bulan (titik pending / berjalan / selesai), job hari ini, mulai rute, navigasi, mulai/selesai tiap stop, scan kargo / kendaraan / lokasi, foto POD, skip/reschedule, catatan job
- **Maintenance:** mulai job, catatan, odometer, scan suku cadang, foto, Selesai atau Skip
- **Scan:** kamera barcode / QR, ketik kode, atau ketuk NFC (APK) — fungsi mengikuti matriks scan Admin per peran
- **Ambil foto** dari kamera, atau dari galeri
- **Bagikan lokasi saat bertugas:** GPS native meski layar mati atau aplikasi lain terbuka (notifikasi tetap tampil)
- Interval bisa diatur (bergerak vs parkir); Dispatch melihat jejak HP di Live
- Berbagi berhenti saat job selesai, atau jika aplikasi diusap keluar

Field di peramban tetap jalan. APK untuk pengemudi yang butuh kamera + GPS latar + NFC baca. Bukan listing Play Store / iOS, dan tidak melacak jika tidak ada job berjalan. Field tidak menulis NFC; stok on-hand hanya tampilan (belum dikurangi saat scan).

### Platform bersama

- Multi-tenant: tiap pelanggan punya kunci, modul, dan pengguna Field
- WhatsApp (Wablas) dengan tautan langsung ke Field
- Daftar kendaraan Armada, posisi live, dan trek harian di job yang sama
- Peran: meja, lapangan, manajer
- Dasbor armada opsional (trip, peta live, pengecualian, tempat, rencana rute) jika menjual suite ARMADA penuh

**Kalimat penutup:** *ARMADA M.1 — dari rencana ke bukti.*

---

## B. Flyer satu halaman

**ARMADA M.1**  
Dispatch & Maintenance — dari rencana ke bukti

Meja merencanakan. Lapangan mengeksekusi. Manajer menutup siklus.

**Satu platform, tiga peran**

| Meja | Lapangan (Android) | Manajer |
|------|--------------------|---------|
| Rencanakan rute dan job bengkel | Kerjakan dengan GPS dan kamera | Setujui dan kunci catatan |

### Dispatch — *Rencanakan hari. Tetapkan rute. Kirim dengan bukti.*

Kotak masuk → job di kendaraan → WhatsApp ke pengemudi → mulai / selesai tiap stop → job lengkap

- Order harian: drop, pickup, atau pickup lalu drop
- Katalog barang (SKU, on-hand), kapasitas (m³ / kg), impor CSV, rutin harian / mingguan
- Cetak QR / barcode dan Write NFC di meja; scan kargo di Field (tambah / konfirmasi / serial opsional)
- Tag kendaraan dan depo opsional — Admin mengatur per peran
- Auto-plan armada (CVRP) atau assign manual
- Papan live: siapa pending, dalam rute, atau terkirim
- Bukti: GPS HP, GPS kendaraan, foto POD opsional
- Order tambahan jadi **trip baru** — tidak menempel di job yang sudah selesai

### Maintenance — *Jadwalkan servis. Teknisi mengerjakan. Manajer mengunci.*

Buat jatuh tempo → assign teknisi (WhatsApp) → Mulai → Selesai → Setujui

- Jadwal berdasarkan tanggal, kilometer, dan/atau jam mesin
- Katalog suku cadang: SKU, on-hand, cetak QR / Write NFC
- Scan suku cadang di Field; wajib scan sebelum Selesai jika diaktifkan
- Suku cadang, tenaga kerja, foto, dan odometer di job
- Siklus servis berikutnya bisa terbuka otomatis setelah Selesai
- Pengingat: akan jatuh tempo, terlambat, due berikutnya — WhatsApp dan email
- **Selesai belum tertutup** sampai manajer menyetujui

### Aplikasi Android Field

Satu aplikasi untuk pengemudi dan teknisi.

- Tab Dispatch dan Maintenance
- Kalender bulan dengan titik pending / berjalan / selesai
- Navigasi, mulai, selesai, skip / reschedule
- Scan: kamera barcode / QR, ketik kode, atau NFC (APK) — sesuai matriks peran Admin
- Kamera atau galeri untuk foto bukti
- Bagikan lokasi saat bertugas — GPS tetap jalan saat layar mati
- Berbagi berhenti ketika job selesai

**ARMADA M.1 — dari rencana ke bukti.**

---

## C. Skrip pembicara 6 slide (~6–8 menit)

### Slide 1 — Judul (45 detik)

**Di slide**  
ARMADA M.1  
Dispatch & Maintenance — rencanakan, kerjakan, tutup  
Satu platform · Meja + Lapangan + Manajer

**Ucapkan**  
ARMADA M.1 bukan peta GPS lain. Anda sudah tahu di mana kendaraannya. Ini lapisan kerjanya: apa yang harus dikirim, apa yang harus diservis, siapa yang mengerjakan, dan buktinya ketika selesai. Tiga permukaan: meja merencanakan, aplikasi Android Field mengeksekusi, manajer menutup siklus.

---

### Slide 2 — Siapa yang memakai (60 detik)

**Di slide**  
Meja merencanakan. Lapangan mengeksekusi. Manajer menutup siklus.

| Peran | Tempat | Tugas |
|-------|--------|--------|
| Dispatcher | Jobs + Dispatch Live | Rencanakan hari |
| Meja maintenance | Maintenance | Jadwalkan servis |
| Pengemudi / teknisi | Aplikasi Field `/m` | Kerjakan |
| Manajer | Manager `/mm` | Setujui dan kunci |

**Ucapkan**  
Setiap pelanggan hanya mendapat modul yang dibeli — Dispatch, Maintenance, atau keduanya. Staf lapangan melihat kedua tab di satu HP jika keduanya diaktifkan. Manajer tidak memakai login pengemudi; mereka punya layar Setujui sendiri. Itu cara merencanakan, mengeksekusi, dan menandatangani tetap terpisah.

---

### Slide 3 — Dispatch (90 detik)

**Di slide**  
Rencanakan hari. Tetapkan rute. Kirim dengan bukti.

Kotak masuk → Job di kendaraan → WhatsApp → MULAI / SELESAI → Job lengkap

- Pool per tanggal · rutin · bawa sisa · barang · pickup/drop
- Auto-plan atau assign manual · sadar kapasitas
- Scan kargo: tambah, konfirmasi, serial opsional · tag kendaraan & depo
- Cetak QR / barcode · Write NFC di meja · on-hand (tidak auto-kurangi)
- GPS + foto POD opsional · Live: pending, dalam rute, terkirim

**Ucapkan**  
Dispatcher menyusun kotak masuk hari ini — pin peta, impor CSV, atau generate rutin harian. Order itu naik ke job kendaraan, dengan kapasitas kubikasi dan kilo. Barang punya SKU: cetak QR atau barcode di meja, atau tulis NFC dari Chrome Android. Di Field pengemudi bisa scan untuk menambah kargo, mengonfirmasi checklist, atau mencatat serial — Admin memilih fungsi per peran. Tag kendaraan dan depo juga tersedia. Assign pengemudi, mereka dapat WhatsApp berisi tautan ke Field. Di HP mereka navigasi, mulai, dan selesaikan tiap stop. GPS HP dan kendaraan tersimpan; foto bisa diwajibkan. Ketika stop terakhir selesai, job tertutup. Jika ada order baru, Anda mulai trip baru untuk pengemudi yang sama — rute yang sudah selesai tidak dibuka lagi. Ops melihat Dispatch Live: siapa masih pending, siapa dalam rute, siapa sudah terkirim.

**Demo jika ada waktu:** tambah satu stop dengan barang katalog → cetak atau scan SKU di Field → assign → selesaikan stop.

---

### Slide 4 — Maintenance (90 detik)

**Di slide**  
Jadwalkan servis. Teknisi mengerjakan. Manajer mengunci.

Buat jatuh tempo → Assign (WhatsApp) → Mulai → Selesai → Setujui

- Tanggal / km / jam mesin
- Katalog suku cadang: SKU, cetak QR / NFC, on-hand
- Scan suku cadang · serial opsional · wajib scan sebelum Selesai (opsional)
- Siklus berikutnya setelah Selesai · pengingat jatuh tempo

**Ucapkan**  
Maintenance adalah event servis di kendaraan, bukan stop pengiriman. Anda jadwalkan lewat kalender, odometer, jam mesin, atau ketiganya. Suku cadang memakai fondasi scan yang sama dengan barang: cetak di meja, scan di HP. Admin bisa mewajibkan setiap suku cadang katalog di-scan sebelum Selesai — bip tidak pernah menyelesaikan job sendiri. Assign teknisi — WhatsApp lagi. Mereka mulai job, isi catatan, suku cadang, tenaga, odometer, dan foto. Ketika mereka menekan Selesai, itu belum berakhir. Manajer meninjau dan menyetujui. Kunci itu adalah jejak audit. Jika job punya siklus, due berikutnya bisa dibuat otomatis, dan kami mengingatkan meja sebelum terlambat.

**Kalimat pembeda:** Dispatch selesai ketika pengemudi menyelesaikan rute. Maintenance selesai ketika manajer menyetujui.

---

### Slide 5 — Satu aplikasi Field, dua jenis kerja (75 detik)

**Di slide**

| | Dispatch | Maintenance |
|--|----------|-------------|
| Satuan | Job + stop | Event servis |
| Selesai berarti | Pengemudi menyelesaikan rute | Teknisi selesai; manajer menyetujui |
| Scan | Tambah / konfirmasi / serial kargo · kendaraan · depo | Tambah / serial suku cadang · kendaraan · wajib sebelum Selesai |
| Label | Cetak QR · Write NFC di meja | Sama di katalog suku cadang |
| Pengulangan | Template rutin | Due berikutnya setelah Selesai |
| Tidak selesai | Skip / reschedule order yang sama | Skip / buka ulang |
| Notifikasi | Assign + update rute | Assign + pengingat jatuh tempo |
| HP | Mulai / selesai + POD + scan | Mulai / Selesai + foto + scan |

**Ucapkan**  
Inilah alasan pelanggan membeli keduanya. Satu aplikasi Android, dua tab, satu matriks scan per peran — pengemudi, operator, worker, field. Pengemudi yang mengirim dan teknisi di bengkel tidak belajar dua produk. Kamera, ketik kode, atau ketuk NFC di APK menuju katalog yang sama. Bedanya adalah tata kelola: pengiriman bisa ditutup di lapangan; job servis menunggu manajer. Itu kalimat yang ingin Anda tinggalkan di ruangan.

---

### Slide 6 — Tutup / mulai pakai (60 detik)

**Di slide**  
Hidupkan minggu ini.

Aktifkan: modul · pengguna Field · nomor WhatsApp  
Minggu pertama: 1 depo, 5 order, 1 job · 1 job servis, Selesai, Setujui · konfirmasi WhatsApp

**ARMADA M.1 — dari rencana ke bukti.**

**Ucapkan**  
Kami mengaktifkan Dispatch, Maintenance, atau keduanya untuk tenant Anda. Kami menambah pengguna Field beserta nomor WhatsApp. Minggu pertama kami jalankan jalur tipis: lima order di satu kendaraan, satu job bengkel sampai Setujui. Jika dua jalur itu jalan, sisanya adalah volume. Dari rencana ke bukti.

**Penutup opsional:** QR ke Field, atau URL meja untuk Jobs dan Maintenance.

---

## Catatan desain

- Flyer: wordmark + dua tangkapan layar kecil (papan Jobs, Field selesai). Jangan taruh tabel perbandingan di halaman cetak.
- Slide: teks di slide besar; detail ada di skrip.
- Jangan klaim Play Store, iOS, atau pelacakan saat tidak ada job berjalan.
- Jangan klaim Field menulis NFC, scan menyelesaikan job sendiri, atau scan mengurangi stok — Write NFC hanya di meja; Require job hanya gerbang; on-hand hanya tampilan.
- Detail teknis scan: `docs/ARMADA-M1-Scan-Phases.md`.
