# Bổ sung Random Sensors và LED cảnh báo

## 1. Các file đã thay đổi

| File | Nội dung |
| --- | --- |
| `firmware/code/code.ino` | Random trên ESP8266 mỗi 2 giây, thêm trường MQTT, LED D5–D7, tiếp tục gửi khi DHT lỗi, reconnect không có vòng chờ vô hạn. |
| `src/utils/sensors.js` | Khai báo tên, khóa payload và giới hạn 6 cảm biến dùng chung. |
| `src/utils/validation.js` | Validate từng trường; trường thiếu/sai không ngăn xử lý các trường hợp lệ khác. |
| `src/services/mqtt.js` | Tra ID theo tên trong `sensors`, lưu các giá trị hợp lệ cùng timestamp trong transaction, phát `sensor:update` sau commit. |
| `src/routes/sensors.js` | Mở rộng latest/chart/history; latest có `sensorRecordedAt` riêng cho từng cảm biến; mọi truy vấn lịch sử chỉ lấy danh sách sáu cảm biến hoạt động. |
| `scripts/migrations/001-random-sensors.sql` | Thêm tên cảm biến bằng ID còn trống, chạy lại không tạo trùng, không sửa dữ liệu cũ. |
| `scripts/migrate-random-sensors.js` | Kiểm tra schema trước khi chạy SQL, đọc cấu hình có sẵn từ `.env`. |
| `frontend/random-sensors.html` | Trang riêng với ba box và biểu đồ. |
| `frontend/js/random-sensors.js` | REST, Socket.IO, phần trăm, cảnh báo độc lập, lịch sử và STALE/OFFLINE. |
| `frontend/css/random-sensors.css` | Bố cục responsive, cảnh báo đỏ nhẹ, hỗ trợ reduced motion. |
| `frontend/dashboard.html` | Thêm liên kết Random Sensors vào sidebar. |
| `frontend/device-history.html` | Thêm liên kết Random Sensors vào sidebar. |
| `frontend/profile.html` | Thêm liên kết Random Sensors vào sidebar. |
| `frontend/sensor-data.html` | Thêm liên kết sidebar và bộ lọc Sensor 4–6. |
| `frontend/css/style.css` | Thanh điều hướng di động đủ 5 trang. |
| `package.json` | Thêm lệnh migration, kiểm tra database và test; không thêm dependency. |
| `scripts/check-random-sensors-db.js` | Kiểm tra handler, MySQL thật, HTTP API và file giao diện; rollback các bản ghi thử. |
| `scripts/check-random-sensors-layout.js` | Kiểm tra bằng Edge/Chrome headless: hai kích thước desktop, resize, mobile, màn hình thấp, trục/chú thích và lỗi JavaScript. |
| `scripts/check-live-sensor-data.js` | Đối chiếu đúng API trên backend đang chạy với MySQL, COUNT/phân trang, bộ lọc và file frontend đang được phục vụ. |
| `src/server.js` | Buộc các API/file Sensor Data và Random Sensors không lưu cache để nhận sửa đổi hiện tại. |
| `tests/validation.test.js` | Kiểm tra toàn bộ dải số nguyên, dữ liệu sai, thiếu trường, payload cũ. |
| `tests/mqtt.test.js` | Kiểm tra tra ID thực, transaction, rollback, emit và ACK thiết bị bằng các đối tượng mô phỏng. |
| `tests/random-sensors.test.js` | Kiểm tra logic UI, ngưỡng cảnh báo, STALE/OFFLINE và biểu đồ trong Node VM; không phải kiểm thử trình duyệt. |
| `RANDOM_SENSORS.md` | Hướng dẫn vận hành và các giới hạn kiểm thử. |

`.env` và `firmware/code/secrets.h` giữ nguyên. Device 1–3 vẫn dùng D1/D2/D3, DHT11 dùng D4, Light dùng A0. Logic EEPROM và giao thức điều khiển thiết bị được giữ lại.

CO2 đã ngừng sử dụng: không có bộ sinh số đo hay LED CO2 trong firmware hiện tại. Backend chỉ nhận sáu khóa cảm biến trong `src/utils/sensors.js`; payload chỉ có CO2 bị bỏ qua. Dashboard, chart, latest và toàn bộ bộ lọc lịch sử chỉ phục vụ sáu cảm biến này. Bản ghi CO2, dữ liệu đo cũ và bảng cấu hình cũ trong MySQL được giữ làm lịch sử, không được dùng để tạo cảnh báo. Không cần migration mới để ngừng sử dụng CO2 và không đổi ID Sensor 4–6.

Riêng Random Sensors dùng Grid theo `100dvh` trên desktop từ 1100px ngang và 640px cao: header, ba box gọn nằm ngang, chart co giãn theo phần còn lại. Đã bỏ footer mô tả và dòng thông báo không có dữ liệu dưới chart, gồm cả logic render JavaScript; không còn hàng Grid hoặc khoảng trống dành cho chúng. Không dùng overflow để che nội dung. Mobile/màn hình thấp chuyển về bố cục tự cuộn. Các trang khác giữ nguyên layout.

## 2. Đấu 3 LED

Ngắt nguồn trước khi đấu. Mỗi LED dùng một điện trở 330Ω riêng:

| Cảm biến | LED | Chân NodeMCU | GPIO | Bật cảnh báo khi |
| --- | --- | --- | --- | --- |
| Sensor 4 | LED 1 | D5 | 14 | > 5.5, tức từ 6 |
| Sensor 5 | LED 2 | D6 | 12 | > 50.5, tức từ 51 |
| Sensor 6 | LED 3 | D7 | 13 | > 500.5, tức từ 501 |

Mỗi nhánh: **D5/D6/D7 → điện trở 330Ω → anode LED (chân dài) → cathode LED (chân ngắn/cạnh vát) → GND**. Dùng GND chung của NodeMCU. Cả ba chân này chưa được dùng trong source cũ; các thư viện hiện tại không cấu hình SPI trên chúng.

LED cảnh báo bật 500ms, tắt 500ms khi vượt ngưỡng; về an toàn thì tắt. Không dùng `delay()` để nhấp nháy. `serviceRandomSensors()` chạy trong `loop()` và tác vụ cooperative của core ESP8266 để tiếp tục cập nhật trong lúc TCP/MQTT chờ kết nối. Lớp `ResponsiveWiFiClient` phục vụ GPIO và `yield()` khi PubSubClient chờ CONNACK. Đây là cơ chế cooperative, cần đo trên mạch để xác nhận thời gian thực tế.

## 3. Chạy migration

Mở terminal ở thư mục gốc dự án:

```powershell
npm run migrate:random-sensors
```

Đã kiểm tra schema database hiện tại: `sensors.id` là INT không AUTO_INCREMENT, `name` có UNIQUE và `sensor_data.value` là DOUBLE. Không cần thay đổi kiểu cột để lưu 1001. Migration chỉ bổ sung các hàng còn thiếu, khóa registry trong transaction để cấp ID và có thể chạy lại.

Migration đã được chạy hai lần trong phiên làm việc này. Kết quả thực tế:

| Tên | ID |
| --- | --- |
| Temperature | 1 |
| Humidity | 2 |
| Light | 3 |
| CO2 (chỉ giữ lịch sử, không hoạt động) | 4 |
| Sensor 4 | 5 |
| Sensor 5 | 6 |
| Sensor 6 | 7 |

Backend tra ID theo tên, không dựa vào bảng ID minh họa này. Nếu chuyển sang database có schema khác, script sẽ dừng để kiểm tra thay vì tự sửa schema. Không chạy trực tiếp file SQL trên schema chưa được đối chiếu.

## 4. Nạp firmware bằng Arduino IDE

1. Mở `firmware/code/code.ino`; giữ file `secrets.h` hiện tại trong cùng thư mục.
2. Chọn **Tools → Board → ESP8266 Boards → NodeMCU 1.0 (ESP-12E Module)** và đúng cổng COM.
3. Dùng core ESP8266 hiện có (đã biên dịch với 3.1.2), PubSubClient, DHT sensor library và Adafruit Unified Sensor. EEPROM/Schedule/ESP8266WiFi có trong core; không cần thêm thư viện JSON.
4. Giữ thiết lập flash hiện có; chọn chế độ xóa **Only Sketch** để giữ vùng EEPROM chứa trạng thái Device 1–3.
5. Nhấn **Verify**, sau đó **Upload**. Mở Serial Monitor ở **115200 baud**.
6. Kiểm tra JSON có `sensor4`, `sensor5`, `sensor6`, cùng các trường cảm biến cũ khi đọc thành công. Khi DHT lỗi, trường lỗi được bỏ qua; Light và ba giá trị random vẫn gửi.

Firmware chỉ random trên ESP8266: `random(0,12)`, `random(0,102)`, `random(0,1002)`. Không có bộ sinh dữ liệu cảm biến trên web/backend.

## 5. Khởi động backend và frontend

Nếu backend đang chạy bản cũ, dừng tiến trình đó rồi khởi động lại sau khi migration hoàn tất:

```powershell
npm start
```

Hoặc dùng `npm run dev` khi cần tự khởi động lại theo thay đổi source. Node.js phải từ 20 trở lên như cấu hình hiện có. Dependencies đã có trong workspace; trên máy mới dùng `npm ci`.

Frontend được Express phục vụ trực tiếp, không có lệnh build/start riêng. Mở `http://127.0.0.1:<PORT>` với `PORT` lấy từ `.env` (mặc định 3000), đăng nhập bằng tài khoản đang dùng, chọn **Random Sensors**. Không mở HTML bằng `file://` hay Live Server khác cổng vì API và Socket.IO dùng cùng origin với backend.

Biểu đồ chuẩn hóa 0–100%; tooltip giữ nguyên giá trị gốc. Chọn Last 20/60/200 để tải lịch sử MySQL. Bỏ chọn Live updates để giữ biểu đồ lịch sử cố định; các box vẫn phản ánh số đo hiện tại. Dùng Sensor Data để tra toàn bộ lịch sử bằng bộ lọc và phân trang sẵn có. Chart.js vẫn dùng CDN giống Dashboard; nếu CDN không tải được, có thông báo và box cảm biến vẫn hoạt động.

## 6. Kiểm tra MySQL và API

Chạy trong MySQL Workbench hoặc phiên MySQL đang chọn đúng database của `.env`:

```sql
SELECT id, name, unit FROM sensors ORDER BY id;

SELECT sd.id, s.name, sd.value, sd.created_at
FROM sensor_data sd
JOIN sensors s ON s.id = sd.sensor_id
WHERE s.name IN ('Sensor 4', 'Sensor 5', 'Sensor 6')
ORDER BY sd.created_at DESC, sd.id DESC
LIMIT 30;

SELECT s.name, MIN(sd.value) AS minimum, MAX(sd.value) AS maximum,
       COUNT(sd.id) AS samples
FROM sensors s LEFT JOIN sensor_data sd ON sd.sensor_id = s.id
WHERE s.name IN ('Sensor 4', 'Sensor 5', 'Sensor 6')
GROUP BY s.id, s.name;
```

`created_at` lưu UTC như trước. Giao diện hiển thị giờ Việt Nam (UTC+7). Không cần giả định một giá trị biên sẽ xuất hiện trong vài mẫu random; Sensor 6 có 1002 khả năng.

Các API vẫn yêu cầu `Authorization: Bearer <token đăng nhập>`:

```text
GET /api/sensor-data/latest
GET /api/sensor-data/chart?limit=60
GET /api/sensor-data/history?type=Sensor%204&page=1&size=10
GET /api/sensor-data/history?type=Sensor%205&page=1&size=10
GET /api/sensor-data/history?type=Sensor%206&page=1&size=10
```

Sự kiện `sensor:update` giữ nguyên tên và thêm các trường mới có dữ liệu hợp lệ. `/latest` trả thêm `sensorRecordedAt` để không dùng timestamp của cảm biến khác làm mới cảm biến đã ngừng gửi.

Kiểm tra tự động:

```powershell
npm test
npm run check:random-sensors-db
```

Trong sandbox Windows của phiên làm việc này, Node bị chặn tạo tiến trình con (`spawn EPERM`). Đã chạy thành công bộ test hiện tại (15 test, gồm việc bỏ qua CO2) bằng Node 24:

```powershell
node --test --test-isolation=none
```

Lệnh `check:random-sensors-db` dùng MySQL thật, tạo dữ liệu thử trong transaction và rollback; không kết nối broker, không gửi lệnh thiết bị, không giữ số đo thử trong database. AUTO_INCREMENT của `sensor_data` có thể có khoảng trống sau rollback; đó là hành vi bình thường của MySQL. Test cũng xác nhận All Sensors/Time/search không trả về CO2, bộ lọc CO2 bị từ chối, latest/chart không có CO2.

Kiểm tra layout cần Node 22+ và Edge/Chrome headless riêng chạy với `--remote-debugging-port=9231`, dùng profile tạm riêng (không dùng phiên trình duyệt cá nhân). Chạy `node scripts/check-random-sensors-layout.js --live` để kiểm tra trực tiếp backend đang chạy ở PORT trong `.env`, gồm cả bảng/dropdown Sensor Data và số bản ghi mà API của trang trả về. Bỏ `--live` để dùng server kiểm tra tạm. Fixture chỉ tồn tại trong bộ nhớ trình duyệt để kiểm tra số dài và biểu đồ; không gửi MQTT hoặc ghi database.

Đã xác minh nguyên nhân CO2 còn xuất hiện trước lần sửa cuối: backend cũ ở cổng 3000 trả 5812 bản ghi (gồm 565 CO2), dù HTML/JS khớp workspace. Sau khi chạy backend mã mới, đúng `/api/sensor-data/history` trả 5247 bản ghi hoạt động, 525 trang ở size=10; tìm CO2 trả 0. Kiểm tra bằng `node scripts/check-live-sensor-data.js`. Khi sửa backend cần khởi động lại Node; browser dùng Ctrl+F5 một lần để nạp trang hiện tại. API và các file frontend liên quan hiện trả `Cache-Control: no-store`.

## 7. Demo với giáo viên

1. Khởi động broker, backend, nạp firmware và mở Random Sensors.
2. Chờ số đo random vượt ngưỡng: Sensor 4 từ 6, Sensor 5 từ 51, Sensor 6 từ 501. LED tương ứng nhấp nháy, box tương ứng báo WARNING và nền đỏ nhấp nháy. Các cảnh báo chạy độc lập; pha nhấp nháy web không cần trùng chính xác với pha LED.
3. Khi số đo giảm về dưới ngưỡng, LED tắt và box chuyển SAFE.
4. Di chuột vào biểu đồ để đối chiếu giá trị gốc/phần trăm. Mở Sensor Data, lọc từng cảm biến; chạy SELECT ở trên để chứng minh dữ liệu đã lưu.
5. Tắt Wi-Fi/broker: LED trên mạch phải tiếp tục theo random mới; web dừng nhấp nháy và báo OFFLINE hoặc STALE chậm nhất sau khoảng 10 giây cộng độ trễ kiểm tra kết nối. Nếu chỉ một cảm biến ngừng cập nhật, riêng box đó phải STALE.
6. Khôi phục mạng: MQTT phải reconnect, báo lại trạng thái Device 1–3, tiếp tục lưu dữ liệu. Thử ON/OFF ba Device từ Dashboard và khởi động lại ESP để kiểm tra khôi phục trạng thái EEPROM.
7. Có thể ngắt dây dữ liệu DHT sau khi ngắt nguồn để kiểm tra lỗi DHT; sau khi cấp nguồn lại, Light và random phải tiếp tục. Kết nối lại theo sơ đồ ban đầu để kết thúc demo.

## 8. Kết quả kiểm tra và giới hạn

Đã thực hiện:

- Biên dịch firmware thật bằng Arduino CLI, FQBN `esp8266:esp8266:nodemcuv2`, core 3.1.2; thành công. RAM tĩnh khoảng 36%, flash khoảng 24% theo báo cáo compiler.
- 15 test tự động đạt: toàn bộ dải số nguyên gồm 0/11/101/1001, payload sai/thiếu/cũ, bỏ qua CO2, ID không tuần tự, transaction/rollback, ACK, cảnh báo độc lập, dữ liệu cũ, lịch sử và giá trị gốc tooltip.
- Kiểm tra cú pháp toàn bộ JavaScript.
- Migration chạy hai lần trên MySQL thật, không tạo trùng; CO2 giữ ID 4.
- Handler lưu 6 giá trị và giá trị 1001 trên MySQL thật trong transaction thử; API latest/chart/history, authentication và truy vấn không hợp lệ được kiểm tra qua HTTP. Dữ liệu thử đã rollback.
- HTML của cả năm trang và file JS/CSS mới trả HTTP 200, sidebar có liên kết mới.
- Edge headless kết nối trực tiếp backend cổng 3000 xác nhận không cuộn dọc/ngang ở viewport 1366×768 và 1920×1080, ba box nằm ngang, trục/chú thích không bị cắt, Chart.js resize khi chuyển kích thước. Sau khi bỏ chữ thừa, canvas lần lượt khoảng 1116×360 và 1638×666. Mobile 390×844 và màn hình thấp 1366×600 cuộn dọc, không tràn ngang hay cắt box. Sensor Data hiện “Showing 1 to 10 of 5247 records”; dropdown và các dòng hiển thị không có CO2. Không ghi nhận exception JavaScript trong trình duyệt.

Chưa xác nhận trên môi trường thực:

- Lần kết nối MQTT đọc thử không kết nối được broker; chưa có kiểm tra luồng ESP8266 → broker → backend → Socket.IO → trình duyệt với số đo từ phần cứng mới.
- Chưa upload lên ESP8266, chưa đo GPIO/nhịp LED, chưa thử mất mạng hoặc lỗi DHT trên mạch thật.
- Layout đã kiểm tra tự động bằng Edge headless; cần xem trực tiếp độ dễ đọc/hiệu ứng nhấp nháy trên trình duyệt và màn hình đang sử dụng.
- ACK được kiểm tra bằng đối tượng mô phỏng; điều khiển ON/OFF, reboot và reconnect với phần cứng cần thực hiện theo kịch bản demo.

Đây là các giới hạn kiểm thử, không được coi là đã PASS phần cứng/MQTT thực tế.
