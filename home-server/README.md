# Home server: MQTT + Home Assistant trên RK3318 (Armbian)

Máy chủ trung tâm để kết nối và điều khiển các thiết bị ESP32 trong nhà.

```
ESP32 (Wi-Fi) ──MQTT──► Mosquitto ◄──► Home Assistant ◄── điện thoại / trình duyệt
                         (1883)          (8123)            (qua Tailscale khi ở ngoài)
```

- **Mosquitto**: broker MQTT. Mọi thiết bị gửi trạng thái và nhận lệnh qua đây.
- **Home Assistant** (bản Container): dashboard, app điện thoại, tự động hoá.
- **ESPHome**: chỉ bật khi cần, để làm thiết bị bằng YAML thay cho code.

## 1. Chuẩn bị box RK3318

RK3318 là chip của TV box: 4 nhân Cortex-A53, arm64. Bản Armbian cho nó do cộng đồng duy trì,
nên có vài điểm cần để ý:

- **RAM**: box này có 4 GB (`free -h` báo 3.9 GB), đủ cho Mosquitto, Home Assistant, và cả ESPHome
  hay Zigbee2MQTT sau này. ESPHome vẫn build firmware trên box được, chỉ chậm (mục 6).
- **Dùng dây Ethernet**, đừng dùng Wi-Fi. Driver Wi-Fi của các box này thường chập chờn trên Armbian.
- **Đặt IP cố định** cho box (DHCP reservation trên router), vì ESP32 sẽ trỏ thẳng tới IP này.
- **Giữ eMMC bền:**
  - Nếu có, cắm ổ USB SSD rồi để thư mục `home-server/` trên đó.
  - Giảm số lần ghi của Home Assistant (mục 4).
  - Mosquitto đã cấu hình ghi log ra Docker và chỉ lưu dữ liệu xuống đĩa 30 phút một lần.
- **Tản nhiệt**: TV box thường nóng. Xem nhiệt độ bằng `cat /sys/class/thermal/thermal_zone0/temp`
  (đơn vị là phần nghìn độ C). Trên khoảng 75 °C thì nên gắn tản hoặc quạt.
- **Cập nhật kernel cẩn thận.** Bản build cộng đồng có thể mất boot sau khi cập nhật kernel. Khi
  máy đã chạy ổn, vào `armbian-config` → System → Freeze kernel, rồi mới `apt upgrade`.

## 2. Cài Docker (chạy trên box)

```sh
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # đăng xuất rồi đăng nhập lại
docker compose version
```

Chép thư mục `home-server/` lên box, ví dụ `scp -r home-server user@<ip-box>:~/` hoặc `git clone`
repo này.

## 3. Tạo tài khoản MQTT và chạy

Mosquitto không nhận kết nối ẩn danh. Mỗi thiết bị dùng một tài khoản riêng, tên tài khoản cũng
chính là id thiết bị. File `acl` chỉ cho mỗi thiết bị ghi vào topic của chính nó (`home/<id>/...`).

```sh
cd ~/home-server
# Tài khoản đầu tiên (-c tạo file mới): cho Home Assistant và để bạn thử
docker run --rm -it -v ./mosquitto/config:/mosquitto/config eclipse-mosquitto:2 \
  mosquitto_passwd -c /mosquitto/config/passwd ha
# Mỗi thiết bị thêm một tài khoản (không có -c)
docker run --rm -it -v ./mosquitto/config:/mosquitto/config eclipse-mosquitto:2 \
  mosquitto_passwd /mosquitto/config/passwd esp32-den
# Broker chạy bằng user mosquitto (uid 1883): nó phải đọc được file mật khẩu và ACL
sudo chown 1883:1883 mosquitto/config/passwd mosquitto/config/acl
sudo chmod 0600 mosquitto/config/passwd mosquitto/config/acl

# Mật khẩu cho trang ESPHome. Docker Compose đòi biến này ngay cả khi chưa bật ESPHome
cp .env.example .env && chmod 600 .env
nano .env   # đổi change-me thành mật khẩu của bạn

docker compose up -d
docker compose logs -f mosquitto   # Ctrl+C để thoát
```

Broker chạy đúng thì `docker compose ps` hiện `Up` (không phải `Restarting`), và log có dòng
`Opening ipv4 listen socket on port 1883`.

Thêm thiết bị sau này (chạy ngay trong container nên file vẫn đúng chủ; sửa `acl` thì dùng `sudo`):

```sh
docker compose exec mosquitto mosquitto_passwd /mosquitto/config/passwd <id-thiết-bị>
docker compose restart mosquitto
```

## 4. Nối Home Assistant với MQTT

1. Mở `http://<ip-box>:8123` rồi tạo tài khoản quản trị. Lần đầu khởi động mất vài phút.
2. Vào Settings → Devices & services → Add integration → **MQTT**. Broker `127.0.0.1`, cổng
   `1883`, user `ha` cùng mật khẩu vừa tạo.
3. Giảm số lần ghi xuống eMMC: thêm vào `homeassistant/configuration.yaml` rồi khởi động lại
   (`docker compose restart homeassistant`):
   ```yaml
   recorder:
     purge_keep_days: 7
     commit_interval: 30
   ```

## 5. Nạp ESP32 mẫu

Sketch trong `esp32-mqtt/` biến LED trên board (GPIO2) thành một công tắc. Home Assistant tự nhận
công tắc này qua MQTT discovery, không cần cấu hình gì thêm. Nút BOOT cũng bật tắt LED được, và
trạng thái trong Home Assistant đổi theo.

1. Chép `esp32-mqtt/secrets.example.h` thành `esp32-mqtt/secrets.h`, rồi điền Wi-Fi, IP của box,
   tài khoản và mật khẩu thiết bị. `secrets.h` không được commit.
2. Trong PlatformIO chọn môi trường **`mqtt_demo`**, rồi Upload và mở Monitor.
3. Monitor hiện `MQTT connecting... ok`. Trong Home Assistant sẽ có thiết bị `esp32-den` kèm công
   tắc **LED**.

Topic mà sketch dùng:

| Topic | Ai gửi | Nội dung |
|---|---|---|
| `home/esp32-den/led/state` | ESP32 (retained) | `ON` / `OFF` |
| `home/esp32-den/led/set` | Home Assistant | `ON` / `OFF` |
| `home/esp32-den/availability` | ESP32, hoặc broker khi ESP32 mất kết nối (Last Will) | `online` / `offline` |
| `homeassistant/switch/esp32-den/led/config` | ESP32 (retained) | cấu hình discovery |

Thử bằng dòng lệnh trên box:

```sh
# Xem mọi tin nhắn
docker compose exec mosquitto mosquitto_sub -u ha -P '<mật khẩu ha>' -t 'home/#' -v
# Bật LED
docker compose exec mosquitto mosquitto_pub -u ha -P '<mật khẩu ha>' -t home/esp32-den/led/set -m ON
```

## 6. ESPHome (khi cần)

```sh
cp .env.example .env   # rồi đặt ESPHOME_PASSWORD
docker compose --profile esphome up -d esphome   # http://<ip-box>:6052
docker compose stop esphome                      # tắt khi xong cho nhẹ máy
```

Build firmware trên box chậm (A53, ít RAM). Có thể cài ESPHome trên Mac (`pip install esphome`) để
build và nạp, còn box chỉ chạy Home Assistant.

## 7. Loa Bluetooth cho Home Assistant

Home Assistant bản Container không tự phát tiếng được. Trình phát MPD chạy trên box sẽ phát tiếng,
PipeWire đẩy tiếng qua Bluetooth sang loa, còn Home Assistant chỉ ra lệnh cho MPD.

```
Home Assistant ──► MPD (127.0.0.1:6600) ──► PipeWire ──Bluetooth──► loa
```

Chip Bluetooth gắn sẵn trên box (BCM4330) dùng được, không cần mua dongle. Loa đang dùng là
iCutes M818, địa chỉ MAC `FC:58:FA:5F:E3:28`.

**1. Cài bộ âm thanh.** Phải cài trước khi ghép đôi loa. Nếu chưa cài, `connect` báo
`br-connection-profile-unavailable`.

```sh
sudo apt install -y bluez rfkill pipewire pipewire-pulse pipewire-alsa wireplumber \
  libspa-0.2-bluetooth pulseaudio-utils alsa-utils mpd mpc
sudo systemctl enable --now bluetooth
sudo loginctl enable-linger $USER     # box không có màn hình: dịch vụ âm thanh tự chạy khi khởi động
systemctl --user enable --now pipewire pipewire-pulse wireplumber
```

WirePlumber 0.5 chỉ bật âm thanh Bluetooth khi có người đăng nhập trên màn hình. Box không có màn
hình nên phải tắt điều kiện đó. Tạo file
`~/.config/wireplumber/wireplumber.conf.d/80-headless-bluetooth.conf` với nội dung sau, rồi chạy
`systemctl --user restart wireplumber`:

```
wireplumber.profiles = {
  main = {
    monitor.bluez.seat-monitoring = disabled
  }
}
```

**2. Ghép đôi loa.** Bật loa ở chế độ ghép đôi, chạy `bluetoothctl`, rồi gõ lần lượt:

```
agent on
default-agent
scan on              # đợi thấy tên loa, ghi lại MAC
scan off
pair <MAC>
trust <MAC>          # để loa tự kết nối lại khi bật lên
connect <MAC>
quit
```

Thử tiếng: `pactl get-default-sink` phải ra `bluez_output...`, và
`paplay /usr/share/sounds/alsa/Front_Center.wav` phải làm loa kêu.

**3. MPD chạy dưới user của bạn.** Bản MPD chạy toàn hệ thống không phát qua PipeWire được, nên tắt
nó đi:

```sh
sudo systemctl disable --now mpd.service mpd.socket
mkdir -p ~/.config/mpd/playlists ~/music
nano ~/.config/mpd/mpd.conf
```

Nội dung `mpd.conf`:

```
music_directory    "~/music"
playlist_directory "~/.config/mpd/playlists"
db_file            "~/.config/mpd/database"
state_file         "~/.config/mpd/state"
bind_to_address    "127.0.0.1"
port               "6600"

audio_output {
  type "pulse"
  name "Loa Bluetooth"
}
```

Sau đó chạy `systemctl --user enable --now mpd`, rồi `mpc status` để kiểm tra.

**4. Thêm vào Home Assistant:**
- Thêm integration **Music Player Daemon (MPD)**: host `127.0.0.1`, cổng `6600`. Loa sẽ hiện thành
  `media_player.music_player_daemon`.
- Thêm integration **Google Translate text-to-speech**, ngôn ngữ `vi`. Bấm nút **+ Add
  integration** ở góc dưới bên phải rồi tìm `google translate`.
- Vào **Settings → System → Network**, đặt **Local network URL** là `http://192.168.1.251:8123`.
  MPD tải file giọng đọc từ địa chỉ này.
- **Tắt integration Bluetooth** của Home Assistant (Settings → Devices & services → Bluetooth →
  Disable), và bỏ qua thông báo đòi thêm quyền NET_ADMIN. Nếu để Home Assistant quét BLE trên cùng
  chip với loa, loa sẽ khó kết nối lại (lỗi `br-connection-page-timeout`). Muốn dùng cảm biến BLE
  thì cho ESP32 làm Bluetooth proxy (ESPHome) hoặc cắm thêm một dongle riêng.

Thử ở **Developer tools → Actions**, chọn **Text-to-speech (TTS): Speak**, target
`tts.google_translate_vi_com`, media player **Music Player Daemon**. YAML tương ứng:

```yaml
action: tts.speak
target:
  entity_id: tts.google_translate_vi_com
data:
  media_player_entity_id: media_player.music_player_daemon
  message: "Xin chào"
```

Dấu tích xanh chỉ có nghĩa là Home Assistant đã nhận lệnh. Nếu loa im, xem
`docker compose logs homeassistant` có dòng `Referenced entities ... are missing` không (sai tên
entity), và chạy `mpc playlist` xem MPD có nhận được file nào không.

Loa tắt lâu rồi bật lại mà không tự kết nối: chạy `bluetoothctl connect <MAC>`.

## 8. Khi box bị treo

`box-debug.sh` làm hai việc. Nó bật watchdog phần cứng: hệ thống không phản hồi quá 30 giây thì box
tự khởi động lại. Nó cũng tạm cho log ghi xuống eMMC, vì mặc định Armbian chỉ giữ log trong RAM
(`armbian-ramlog`), mất điện là mất log. Chạy một lần (script tự khởi động lại box):

```sh
sudo sh ~/home-server/box-debug.sh
```

Lần sau box treo, xem chuyện gì xảy ra ngay trước lúc treo:

```sh
journalctl -b -1 -p warning --no-pager | tail -50
```

Khi đã tìm ra nguyên nhân, bật lại ramlog để eMMC đỡ bị ghi: sửa `ENABLED=true` trong
`/etc/default/armbian-ramlog`, xoá `/etc/systemd/journald.conf.d/persistent.conf`, rồi khởi động
lại.

Box đang chạy bản Armbian `trunk` (bản build hằng đêm). Nếu box còn treo nhiều lần, nên cài lại
bằng bản ổn định của Armbian community cho RK3318.

## 9. Điều khiển khi ở ngoài nhà

**Đừng mở cổng 1883 hay 8123 trên router.** Thay vào đó cài Tailscale (VPN, miễn phí cho cá nhân)
lên box và điện thoại:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Rồi mở Home Assistant bằng IP Tailscale của box.

## 10. Thêm sau này

- **Zigbee**: cắm USB dongle (vd Sonoff ZBDongle-E) vào box, thêm container Zigbee2MQTT. Thiết bị
  Zigbee cũng hiện ra qua MQTT như trên.
- **ESP-NOW**: cho ESP32 chạy pin hoặc ở xa router. Một ESP32 làm gateway chuyển sang MQTT.
- **TLS (cổng 8883)**: khi MQTT phải đi qua mạng không tin cậy.
- **Mạng riêng cho IoT** (VLAN hoặc Wi-Fi khách) nếu router hỗ trợ.
