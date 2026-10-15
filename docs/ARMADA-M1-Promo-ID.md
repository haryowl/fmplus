# ARMADA M.1 — Paket promo (Bahasa Indonesia)

*Terakhir diperbarui: 15 Okt 2026 — tema Modern, meja Cargo / Passenger / Sales, halaman Goods & Customers, CSV order berprofil, popup New stop, Live money & outcome sales.*

Cetak flyer satu halaman A4. Skrip 6 slide sekitar 6–8 menit. Lengkapi dengan tangkapan layar Jobs, Goods, Dispatch Live, APK Field, dan Approve manajer.

---

## A. Ringkasan fitur (untuk website / proposal)

**ARMADA M.1** adalah lapisan kerja di atas pelacakan armada: merencanakan pekerjaan, menjalankannya di HP, dan membuktikan bahwa pekerjaan itu selesai.

Meja merencanakan. Lapangan mengeksekusi. Manajer menutup siklus.

### Dispatch — *Rencanakan hari. Tetapkan rute. Kirim dengan bukti.*

**Perencanaan**
- Tiga meja di Jobs: **Cargo**, **Passenger**, **Sales** (kotak masuk sadar profil)
- Kotak masuk order harian (pin peta, pencarian alamat / POI, atau formulir)
- **New stop** membuka **popup di rail Orders** — papan tidak memanjang; peta tetap bisa di-pin
- Drop saja, pickup saja, atau pickup lalu drop
- Halaman khusus **Goods & Stock** dan **Customers** (tata letak master, kolom tengah)
- Katalog barang (SKU, satuan, volume, berat, harga, tampilan stok) dan baris kargo di order
- Stok per depo, truck day-close, tarif opex / fare
- Cetak QR / barcode dan Write NFC di meja; Field scan untuk menambah atau mengonfirmasi kargo
- Serial / lot opsional, tag kendaraan, tag lokasi depo — Admin mengatur per peran Field
- Impor **CSV order** untuk cargo, passenger (`passenger_count`, `luggage_kg`, `pickup_*`), dan sales (`profile=sales`)
- Impor CSV barang dan pelanggan
- Template rutin: harian, hari kerja, atau mingguan
- Order tersisa bisa dibawa ke hari berikutnya
- Depo, zona, kapasitas kendaraan (m³ / kg / kursi), opsi ganjil-genap saat merute
- Tema UI: Warm · Mono · **Modern** (ops teal)

**Penugasan**
- Buat job di kendaraan Armada, set kapasitas, tetapkan pengemudi
- Assign manual dari kotak masuk, dengan cek kapasitas / kursi
- Auto-plan hari (CVRP): satu depo atau banyak, pratinjau lalu terapkan
- Pemulihan siang hari: sisa pekerjaan, pengecualian, tampilan SLA
- Optimasi urutan stop di jaringan jalan
- Tur multi-hari
- Setelah rute selesai, order tambahan menjadi **trip baru** untuk pengemudi yang sama — tidak menempel di job yang sudah selesai

**Eksekusi & bukti**
- Pengemudi bekerja per stop: navigasi, mulai, selesai
- Alur cargo, penumpang, dan kunjungan sales di Field yang sama
- Scan kargo di Field (kamera / ketik / NFC di APK) sesuai matriks Admin
- GPS HP dan GPS kendaraan tersimpan saat mulai dan selesai
- Foto bukti serah (POD) opsional sebelum selesai
- Outcome kunjungan sales saat Finish
- Skip / reschedule memakai **nomor order yang sama** di tanggal baru
- Job tertutup saat stop terakhir selesai
- WhatsApp saat job ditugaskan (termasuk salinan fare / goods bila dipakai), saat rute mendapat stop baru, dan saat trip baru dibuat

**Dispatch Live**
- Kartu pengemudi: pending, dalam perjalanan, terkirim
- Manifest: waktu mulai/selesai, POD, koordinat HP vs rencana vs kendaraan
- Ringkasan uang dan outcome sales
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
- **Dispatch:** kalender bulan (titik pending / berjalan / selesai), job hari ini, mulai rute, navigasi, mulai/selesai tiap stop, scan kargo / kendaraan / lokasi, foto POD, skip/reschedule, catatan job, outcome sales
- **Maintenance:** mulai job, catatan, odometer, scan suku cadang, foto, Selesai atau Skip
- **Scan:** kamera barcode / QR, ketik kode, atau ketuk NFC (APK) — fungsi mengikuti matriks scan Admin per peran
- **Ambil foto** dari kamera, atau dari galeri
- **Bagikan lokasi saat bertugas:** GPS native meski layar mati atau aplikasi lain terbuka (notifikasi tetap tampil)
- Interval bisa diatur (bergerak vs parkir); Dispatch melihat jejak HP di Live
- Berbagi berhenti saat job selesai, atau jika aplikasi diusap keluar

Field di peramban tetap jalan. APK untuk pengemudi yang butuh kamera + GPS latar + NFC baca. Bukan listing Play Store / iOS, dan tidak melacak jika tidak ada job berjalan. Field tidak menulis NFC; penyesuaian stok depo adalah aksi meja terpisah (bukan auto-kurangi saat scan).

### Platform bersama

- Multi-tenant: tiap pelanggan punya kunci, modul, dan pengguna Field
- WhatsApp (Wablas) dengan tautan langsung ke Field
- Daftar kendaraan Armada, posisi live, dan trek harian di job yang sama
- Peran: meja, lapangan, manajer
- Tema: Warm · Mono · Modern
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
| Rencanakan rute, kunjungan, penumpang, dan job bengkel | Kerjakan dengan GPS dan kamera | Setujui dan kunci catatan |

### Dispatch — *Rencanakan hari. Tetapkan rute. Kirim dengan bukti.*

Kotak masuk → job di kendaraan → WhatsApp ke pengemudi → mulai / selesai tiap stop → job lengkap

- Tiga meja: Cargo · Passenger · Sales
- Order harian: drop, pickup, atau pickup lalu drop; New stop sebagai popup
- CSV massal untuk cargo, penumpang, dan kunjungan sales
- Halaman Goods & Customers: katalog, harga, stok depo, titik kirim
- Cetak QR / barcode dan Write NFC di meja; scan kargo di Field
- Tag kendaraan dan depo opsional — Admin mengatur per peran
- Auto-plan armada (CVRP) atau assign manual
- Papan live: status, uang, outcome sales
- Bukti: GPS HP, GPS kendaraan, foto POD opsional
- Tema Warm · Mono · Modern
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
- Alur cargo, penumpang, dan sales di Field yang sama
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
Satu platform · Meja + Lapangan + Manajer · Warm / Mono / Modern

**Ucapkan**  
ARMADA M.1 bukan peta GPS lain. Anda sudah tahu di mana kendaraannya. Ini lapisan kerjanya: apa yang harus dikirim, siapa yang dikunjungi, siapa yang dijemput, apa yang harus diservis, siapa yang mengerjakan, dan buktinya ketika selesai. Tiga permukaan: meja merencanakan, aplikasi Android Field mengeksekusi, manajer menutup siklus. Tema UI bisa Warm, Mono, atau Modern — tampilan ops teal yang lebih bersih — tanpa mengubah alur kerja.

---

### Slide 2 — Siapa yang memakai (60 detik)

**Di slide**  
Meja merencanakan. Lapangan mengeksekusi. Manajer menutup siklus.

| Peran | Tempat | Tugas |
|-------|--------|--------|
| Dispatcher | Jobs + Dispatch Live | Rencanakan hari |
| Katalog / titik | Goods · Customers | Stok dan titik kirim |
| Meja maintenance | Maintenance | Jadwalkan servis |
| Pengemudi / teknisi | Aplikasi Field `/m` | Kerjakan |
| Manajer | Manager `/mm` | Setujui dan kunci |

**Ucapkan**  
Setiap pelanggan hanya mendapat modul yang dibeli — Dispatch, Maintenance, atau keduanya. Di dalam Dispatch Anda bisa mengaktifkan Cargo, Passenger, Sales, atau campuran; papan Jobs yang sama berganti mode meja. Staf lapangan melihat kedua tab di satu HP jika keduanya diaktifkan. Manajer tidak memakai login pengemudi; mereka punya layar Setujui sendiri. Itu cara merencanakan, mengeksekusi, dan menandatangani tetap terpisah.

---

### Slide 3 — Dispatch (90 detik)

**Di slide**  
Rencanakan hari. Tetapkan rute. Kirim dengan bukti.

Kotak masuk → Job di kendaraan → WhatsApp → MULAI / SELESAI → Job lengkap

- Meja Cargo · Passenger · Sales · popup New stop · CSV berprofil
- Halaman Goods & Customers · stok depo · day-close · tarif
- Auto-plan atau assign manual · kapasitas / kursi
- Scan kargo · cetak QR · NFC meja · Live uang & outcome sales
- GPS + foto POD opsional · tema Modern opsional

**Ucapkan**  
Dispatcher menyusun kotak masuk hari ini — pin peta, buka New stop di popup agar papan tidak memanjang, impor CSV untuk cargo, penumpang, atau kunjungan sales, atau generate rutin harian. Order naik ke job kendaraan dengan kapasitas kubikasi, kilo, atau kursi. Goods dan Customers punya halaman meja sendiri di tengah layar: katalog, harga, stok depo, day-close truk. Barang punya SKU: cetak QR atau barcode di meja, atau tulis NFC dari Chrome Android. Di Field pengemudi bisa scan untuk menambah kargo, mengonfirmasi checklist, atau mencatat serial — Admin memilih fungsi per peran. Assign pengemudi, mereka dapat WhatsApp berisi tautan ke Field — termasuk salinan fare atau goods bila dipakai. Di HP mereka navigasi, mulai, dan selesaikan tiap stop. GPS HP dan kendaraan tersimpan; foto bisa diwajibkan. Kunjungan sales mencatat outcome saat Finish. Ketika stop terakhir selesai, job tertutup. Jika ada order baru, Anda mulai trip baru — rute yang sudah selesai tidak dibuka lagi. Ops melihat Dispatch Live: status, ringkasan uang, dan outcome sales.

**Demo jika ada waktu:** tema Modern → popup New stop dengan barang katalog → atau impor CSV passenger/sales singkat → assign → selesaikan di Field.

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
| Satuan | Job + stop (cargo / passenger / sales) | Event servis |
| Selesai berarti | Pengemudi menyelesaikan rute / kunjungan | Teknisi selesai; manajer menyetujui |
| Scan | Tambah / konfirmasi / serial kargo · kendaraan · depo | Tambah / serial suku cadang · kendaraan · wajib sebelum Selesai |
| Label | Cetak QR · Write NFC di meja | Sama di katalog suku cadang |
| Pengulangan | Template rutin | Due berikutnya setelah Selesai |
| Tidak selesai | Skip / reschedule order yang sama | Skip / buka ulang |
| Notifikasi | Assign · WhatsApp fare / goods | Assign + pengingat jatuh tempo |
| HP | Mulai / selesai + POD + scan | Mulai / Selesai + foto + scan |

**Ucapkan**  
Inilah alasan pelanggan membeli keduanya. Satu aplikasi Android, dua tab, satu matriks scan per peran — pengemudi, operator, worker, field. Pengemudi yang mengirim, jemput penumpang, kunjungan sales, dan teknisi di bengkel tidak belajar dua produk. Kamera, ketik kode, atau ketuk NFC di APK menuju katalog yang sama. Bedanya adalah tata kelola: pengiriman atau kunjungan bisa ditutup di lapangan; job servis menunggu manajer. Itu kalimat yang ingin Anda tinggalkan di ruangan.

---

### Slide 6 — Tutup / mulai pakai (60 detik)

**Di slide**  
Hidupkan minggu ini.

Aktifkan: modul · cargo / passenger / sales · pengguna Field · nomor WhatsApp  
Minggu pertama: 1 depo, 5 order (atau CSV), 1 job · 1 job servis, Selesai, Setujui · konfirmasi WhatsApp

**ARMADA M.1 — dari rencana ke bukti.**

**Ucapkan**  
Kami mengaktifkan Dispatch, Maintenance, atau keduanya untuk tenant Anda — plus profil Dispatch yang Anda butuhkan. Kami menambah pengguna Field beserta nomor WhatsApp. Minggu pertama kami jalankan jalur tipis: lima order di satu kendaraan — pin manual atau CSV — dan satu job bengkel sampai Setujui. Jika dua jalur itu jalan, sisanya adalah volume. Dari rencana ke bukti.

**Penutup opsional:** QR ke Field, atau URL meja untuk Jobs, Goods, Customers, dan Maintenance.

---

## Catatan desain

- Flyer: wordmark + dua tangkapan layar kecil (papan Jobs tema Modern, Field selesai). Jangan taruh tabel perbandingan di halaman cetak.
- Slide: teks di slide besar; detail ada di skrip. Utamakan screenshot tema Modern untuk tampilan produk terkini.
- Jangan klaim Play Store, iOS, atau pelacakan saat tidak ada job berjalan.
- Jangan klaim Field menulis NFC, scan menyelesaikan job sendiri, atau scan mengurangi stok — Write NFC hanya di meja; Require job hanya gerbang; penyesuaian stok depo adalah aksi meja terpisah.
- Detail teknis scan: `docs/ARMADA-M1-Scan-Phases.md`.
