# Linh kiện cộng đồng (kế hoạch, chưa làm)

Ghi chú để làm sau: biến ESP32 Lab thành sân chơi cho người đam mê tự thiết kế linh kiện theo một
chuẩn chung, chia sẻ được và chạy an toàn trên máy người khác. Viết ngày 2026-10-31.

Ý chính: **linh kiện không còn là code build sẵn vào app, mà là một gói dữ liệu theo chuẩn.** Ai
cũng tạo được, chia sẻ được, và gói chạy an toàn trên máy người khác.

## 1. Hiện trạng: thêm một linh kiện mới phải làm gì

Không có server nào giữ danh sách linh kiện. `packages/app/src/lib/catalog.ts` import cứng từng
thư mục trong `parts/`, nên thêm linh kiện tức là sửa code và phát hành bản mới.

Phía lập trình:
1. Viết `parts/<tên>/` theo [PART_AUTHORING.md](PART_AUTHORING.md): `part.json` (chân, cách cắm,
   props, ratings, `stock`, `plug`, `learn`), `index.ts`, hình SVG, `package.json`.
2. Đăng ký trong `catalog.ts` (import cộng một mục trong `PARTS`). Đây là chỗ duy nhất phải sửa
   trong app.
3. Nếu code Arduino của nó cần thư viện thì thêm vào `packages/lab-server/libraries.json`.
4. Viết test so với datasheet (`pnpm test`), nên có thêm một dự án mẫu dùng linh kiện đó, vì AI
   đọc dự án mẫu khi viết code mới.
5. Phát hành: web thì `vite build` rồi deploy; desktop thì `pnpm dist:mac` / `pnpm dist:win`.

Những phần tự nhận linh kiện mới: thư viện linh kiện, wizard tạo bàn, trợ lý AI và tạo bàn bằng AI
(`list_parts` / `get_part` đọc từ `PARTS`), kiểm tra mạch (`verify.ts`), kho và đối chiếu kho.

Phía người dùng: bản web chỉ cần tải lại trang. Bản desktop phải tải và cài bản mới, vì app chưa có
tự cập nhật (chưa dùng `electron-updater`).

Cẩn thận khi sửa linh kiện đã có. Dữ liệu người dùng (bàn đã lưu, kho) chỉ ghi theo tên, nên:
- đổi tên loại (vd `mosfet` → `mosfet-n`) làm bàn và món trong kho trỏ tới loại không còn tồn tại;
- đổi tên chân làm hỏng dây nối vào chân đó;
- đổi `stock` làm món trong kho không còn khớp, nên bảng đối chiếu báo thiếu.

App chưa có code chuyển dữ liệu cũ, nên hiện giờ chỉ nên thêm mới, không đổi tên.

## 2. Còn thiếu gì để mở cho cộng đồng

| Hiện giờ | Vấn đề |
|---|---|
| Linh kiện import cứng trong `catalog.ts` | Không nạp được linh kiện lúc app đang chạy |
| `create()` và `view()` là TypeScript chạy thẳng trong app | Code của người lạ đọc được API key, kho, dự án. SVG chèn bằng `{@html}` có thể mang theo script |
| Tên loại là chuỗi trơn (`mosfet`) | Trùng tên giữa các tác giả, không có phiên bản |
| Thư viện Arduino lấy từ `libraries.json` | Thư viện PlatformIO có thể chạy script lúc build trên server |

Phần đã sẵn sàng: `part.json` là JSON, và kiểm tra mạch, trợ lý AI, kho chỉ đọc manifest. Linh kiện
cộng đồng sẽ tự được AI hiểu, được kiểm tra mạch và đối chiếu kho.

## 3. Thiết kế đề xuất

### 3.1 Chuẩn gói linh kiện có phiên bản

JSON Schema, ví dụ `esp32lab-part/1.0`. Gói đóng thành file `.esp32part` (zip, giống `.fzpz` của
Fritzing):

```
@tác-giả/bmp280@1.2.0
  part.json      chân, footprint, props, ratings, stock, plug, learn, giao thức
  view.svg       hình tĩnh + chỗ gắn trạng thái
  behavior.*     khai báo, hoặc .wasm (mục 3.2)
  tests.json     các điểm đo phải khớp datasheet
  README.md, LICENSE, link datasheet
```

Cần chuẩn hoá:
- vai trò chân: dựa trên `PlugRole` (3v3, 5v, gnd, out, in, adc, sda, scl…), thêm spi, uart, pwm, 1-wire;
- giới hạn điện: `ratings` như hiện có;
- giao thức: địa chỉ I2C, chế độ SPI, tốc độ UART;
- tên có namespace và theo semver (`@tác-giả/tên@x.y.z`). Đổi chân hoặc `stock` phải tăng major và
  kèm cách chuyển dữ liệu.

### 3.2 Ba mức mô phỏng

1. **Chỉ khai báo, không có code** (giống modular components của SimulIDE). Ghép từ các khối có
   sẵn (điện trở, junction, công tắc, VCCS, tụ…) cùng các mô hình giao thức: cảm biến analog theo
   đường cong, cảm biến I2C theo bảng thanh ghi lấy giá trị từ `env.world`, thiết bị UART lệnh/đáp,
   dải LED kiểu WS2812. Phần lớn breakout cảm biến và module I2C vừa với mức này. An toàn tuyệt
   đối. **Làm mức này trước.**
2. **Hành vi bằng WebAssembly trong sandbox** (giống Custom Chips của Wokwi). Viết bằng C, Rust
   hoặc AssemblyScript, chạy trong Worker. Chỉ thấy API `part-sdk` (stamp, onSolved, onEvent,
   schedule), không có DOM, mạng hay localStorage, và bị giới hạn thời gian mỗi bước giải. Chọn
   WASM chứ không chọn QuickJS: sandbox có sẵn, nhanh hơn, không ép một ngôn ngữ, và tác giả chạy
   thử được trên máy mình.
3. **Linh kiện chính thức**: TypeScript như hiện giờ, chỉ dành cho linh kiện nằm trong repo.

Mạch tương tự: cân nhắc đọc mô hình SPICE (`.model` / `.subckt`) mà các hãng phát hành, thay vì
tự đặt chuẩn. Bộ giải MNA của app cùng nền tảng với SPICE.

Hình vẽ chỉ nhận SVG tĩnh: lọc bỏ `<script>`, `foreignObject`, `on*=`, link ra ngoài. Phần đổi theo
trạng thái (độ sáng LED, chữ trên màn hình) đi qua ràng buộc khai báo, không qua code.

### 3.3 Part Studio (trong app)

- Đặt chân trên lưới breadboard, nhập SVG, khai báo props và ratings, xem trước trực tiếp.
- Bàn thử tự sinh: tự ráp với ESP32 theo `plug`, chạy `verify.ts` và các điểm đo trong
  `tests.json` (vd ở 20 mA thì Vf = 2,0 V). Chưa qua thì chưa xuất gói được.
- AI viết bản nháp `part.json`, bảng thanh ghi và các điểm đo từ datasheet, rồi tự kiểm tra bằng
  mô phỏng. Chưa thấy nền tảng nào làm điều này; có thể là điểm khác biệt của ESP32 Lab.
- Phải làm tử tế và tài liệu theo kịp chuẩn. Part Editor bỏ dở của Fritzing là bài học xấu.

### 3.4 Chia sẻ và mức tin cậy

- **Bước đầu không cần server**, làm giống Arduino Library Manager: gói nằm ở repo GitHub của tác
  giả, còn registry chỉ là một file chỉ mục trên GitHub. Thêm gói bằng pull request, CI chạy
  schema, lọc SVG và `tests.json` (giống `fzp_checker.py` của Fritzing và quy tắc KLC của KiCad).
- Ba hạng: Chính thức (trong repo), Đã duyệt (có người review), Cộng đồng (sandbox, kèm cảnh báo).
- Gói được băm hoặc ký; app kiểm tra trước khi cài và lưu cache để dùng offline (IndexedDB ở web,
  thư mục dữ liệu ở desktop).
- Dự án ghi rõ phiên bản linh kiện (như lockfile) để bàn chia sẻ vẫn mở đúng.
- Thư viện Arduino chỉ chọn từ danh sách đã duyệt. Gói cộng đồng không được tự thêm thư viện.
- Giấy phép: gợi ý CC-BY-SA cho hình, MIT cho behavior. Ghi tác giả, cho remix.
- Tài khoản, đánh giá, kiểm duyệt riêng: chỉ làm khi cộng đồng đủ lớn.

## 4. Lộ trình

| Giai đoạn | Việc | Cần server? |
|---|---|---|
| 1 | JSON Schema. Bỏ import cứng trong `catalog.ts`, chuyển sang danh sách nạp lúc chạy. Lọc SVG. Nhập/xuất `.esp32part`. | Không |
| 2 | Khối khai báo và mô hình giao thức (I2C thanh ghi, analog, UART). Chuyển vài linh kiện có sẵn sang dạng khai báo để kiểm chứng chuẩn. | Không |
| 3 | Part Studio, bàn thử tự sinh, AI viết nháp từ datasheet. | Không |
| 4 | Hành vi WASM trong sandbox. | Không |
| 5 | Chỉ mục trên GitHub + CI kiểm tra, ký gói, lockfile phiên bản trong dự án. | Không (GitHub) |
| 6 | Registry riêng và cộng đồng: tài khoản, trang tác giả, bộ sưu tập, cuộc thi. | Có |

Giai đoạn 1–3 đủ để chia sẻ linh kiện qua file và đo xem cộng đồng có dùng thật không, trước khi
đầu tư registry.

Việc nhỏ hơn làm được trước: **tự cập nhật cho desktop** (`electron-updater` cùng một chỗ host bản
phát hành), để người dùng nhận linh kiện mới mà không phải tự tải bản cài.

## 5. Thế giới đã làm thế nào

| Nền tảng | Định dạng | Hành vi | Chia sẻ | Bài học |
|---|---|---|---|---|
| **Wokwi** Custom Chips | `x.chip.json` (chân) + `x.chip.wasm` | WASM, viết C theo `wokwi-api.h`, hoặc Rust/AssemblyScript; Verilog thử nghiệm. API còn beta | GitHub (fork repo mẫu, build bằng Actions/Docker) | WASM là cách chạy code lạ an toàn trên trình duyệt |
| **Fritzing** | `.fzpz` = zip của `.fzp` (XML) + 4 SVG (breadboard, sơ đồ, PCB, icon) | Không mô phỏng | Export/Open file; thư viện chính qua PR vào `fritzing-parts`, có `fzp_checker.py` | Thiếu công cụ tốt và tài liệu thì linh kiện cộng đồng kém chất lượng |
| **SimulIDE** | XML (modular), thêm script `.as` (scripted) | Ghép khối có sẵn (IO, UART/SPI/TWI) + script đọc chân, đặt áp, ngắt. Chưa có ở bản 1.0.0 | Repo GitHub `SimulIDE-Components` | Giống hướng "khai báo trước, script sau" |
| **SPICE** * | `.model` / `.subckt` | Mô hình điện | Hãng phát hành cùng datasheet | Dùng chuẩn có sẵn cho mạch tương tự |
| **KiCad** * | Thư viện symbol/footprint | Không | Merge request, quy tắc KLC, script kiểm tra | Quy tắc rõ + kiểm tra tự động giữ thư viện đồng đều |
| **Arduino Library Manager / PlatformIO** * | `library.properties` / `library.json` + tag | Không | Chỉ mục chung trỏ tới repo tác giả, thêm bằng PR | Registry ban đầu chỉ cần một file chỉ mục |
| **Tinkercad, Proteus** * | Đóng | Proteus: DLL | Không / gắn với phần mềm | Thư viện đóng thì nghèo, đó là khoảng trống |

\* Theo hiểu biết chung, chưa đối chiếu nguồn.

Nguồn:
- [Wokwi: Getting Started with the Custom Chips C API](https://docs.wokwi.com/chips-api/getting-started)
- [Wokwi: Custom chips to WASM](https://docs.wokwi.com/guides/custom-chips-to-wasm)
- [Fritzing: Creating custom parts](https://fritzing.org/learning/tutorials/creating-custom-parts/)
- [fritzing-parts (GitHub)](https://github.com/fritzing/fritzing-parts)
- [Fritzing forum: Part editor](https://forum.fritzing.org/t/part-editor-dragging-disabled/14823/2)
- [.FZPZ file extension](https://fileinfo.com/extension/fzpz)
- [SimulIDE: Scripted components](https://simulide.com/p/scripted/)
- [SimulIDE: Components](https://simulide.com/p/component/)
- [SimulIDE-Components (GitHub)](https://github.com/eeTools/SimulIDE-Components)
