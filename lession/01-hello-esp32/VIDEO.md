# Kịch bản video Short – Bài 01: Hello ESP32

Định dạng: dọc 9:16, ~45–60 giây. 🎥 = bạn quay bằng camera, 🖥️ = Claude quay màn hình.
File quay màn hình lưu tại `lession/01-hello-esp32/recordings/` (1080x1920, 30fps, không tiếng).

## Trạng thái
| Shot | File | Trạng thái |
|------|------|-----------|
| 3 | `recordings/03-tim-cong.mp4` | ✅ 9.8s |
| 4 | `recordings/04-doc-code.mp4` | ✅ 14.3s |
| 5 | `recordings/05-nap-code.mp4` | ✅ 24.6s (nên tua nhanh x2–x3 đoạn Writing) |
| 8 | `recordings/08-serial-monitor.mp4` | ✅ 17s – dòng LED BAT/TAT chạy liên tục |
| 9 | `recordings/09-reset-en.mp4` | ⏳ quay đồng thời với camera |

| # | Loại | Nội dung | Thời lượng | Lời thoại gợi ý |
|---|------|----------|-----------|-----------------|
| 1 | 🎥 | Cận cảnh board ESP32 + cáp Type-C trên bàn, lật mặt trước/sau | 3–4s | "ESP32 – vi điều khiển có WiFi + Bluetooth, giá chỉ vài chục nghìn" |
| 2 | 🎥 | Cắm cáp vào board và Mac, LED đỏ sáng | 3s | "Cắm cáp, đèn đỏ sáng là có nguồn" |
| 3 | 🖥️ | Terminal: `ls /dev/cu.*` → hiện cổng usbserial | 4s | "Máy đã nhận cổng nạp" |
| 4 | 🖥️ | Terminal: `bat` hiển thị `setup()` rồi `loop()` (có tô màu) | 8s | "setup chạy 1 lần, loop chạy mãi mãi" |
| 5 | 🖥️ | Bấm Upload, log nạp chạy tới `SUCCESS` | 6s | "Bấm nạp code…" |
| 6 | 🎥 | (Nếu nạp lỗi) ngón tay giữ nút BOOT | 2s | "Kẹt Connecting? Giữ nút BOOT" |
| 7 | 🎥 | LED xanh nháy trên board | 4s | "Và LED đã nháy!" |
| 8 | 🖥️ | Serial Monitor hiện thông tin chip + `LED BAT/TAT` | 6s | "Serial cho ta biết chip 2 nhân, 240MHz" |
| 9 | 🎥 | Bấm nút EN – LED khởi động lại | 2s | "Nút EN để reset" |
| 10 | 🎥/🖥️ | Ghép màn hình chia đôi: LED nháy + Serial chạy đồng bộ | 4s | "Bài sau: nút bấm. Follow để học tiếp!" |

## Mẹo quay
- Camera: quay dọc, nền tối để LED nổi bật, khoá phơi sáng (chạm giữ trên iPhone) để không bị chói đèn LED.
- Shot 7 & 9 quay chậm 2–3 giây trước khi thao tác để dễ cắt.
