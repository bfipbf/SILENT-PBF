# SILENT-PBF — Salesforce DX

Repository ini menggunakan struktur **Salesforce DX (SFDX)** untuk menyimpan Salesforce metadata dalam source format. Integrasi GitHub Actions yang sudah ada tetap dipertahankan.

## Struktur

- `sfdx-project.json` — konfigurasi proyek Salesforce DX, root package `force-app`.
- `force-app/main/default/` — lokasi source metadata Salesforce (Flow, objects, classes, LWC, permissions, dan lain-lain).
- `.github/workflows/` dan `.github/mjs/` — workflow dan skrip gateway yang sudah ada; tidak dipindah atau diubah oleh inisialisasi ini.

## Menjalankan secara lokal

1. Install Salesforce CLI (`sf`) dan buka repository di VS Code + Salesforce Extension Pack.
2. Jalankan `sf project list` untuk memastikan konfigurasi proyek terbaca.
3. Jika perlu menghubungkan org, lakukan autentikasi secara lokal sesuai kebijakan akses dan pilih target org secara eksplisit. Jangan commit token atau file `.sf` / `.sfdx`.
4. Simpan metadata yang sudah di-review di bawah `force-app/main/default/`.

**Penting:** inisialisasi ini tidak menarik metadata dari org, tidak melakukan deploy/DML, dan tidak mengubah alur `jim.yaml` atau `sf.yaml`. Eksekusi Salesforce/External Services otomatis mengikuti gateway resmi `bfipbf/GPT-PBF`, bukan menjadikan repo ini endpoint eksekusi baru.
