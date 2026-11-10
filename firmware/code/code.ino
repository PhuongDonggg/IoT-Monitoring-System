#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <EEPROM.h>
#include <Schedule.h>
#include "secrets.h"

// Giữ nguyên chân thiết bị và LED cảnh báo.
#define DEVICE1_PIN D1
#define DEVICE2_PIN D2
#define DEVICE3_PIN D3
#define DHTPIN D4
#define LIGHT_PIN A0
#define DHTTYPE DHT11
#define WARNING1_PIN D5
#define WARNING2_PIN D6
#define WARNING3_PIN D7

const uint8_t warningPins[3] = {WARNING1_PIN, WARNING2_PIN, WARNING3_PIN};
const float warningThresholds[3] = {5.5f, 50.5f, 500.5f};
int randomValues[3] = {0, 0, 0};
bool warningActive[3] = {false, false, false};
bool warningOn[3] = {false, false, false};
unsigned long warningChangedAt[3] = {0, 0, 0};
unsigned long lastRandomAt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
const unsigned long SAMPLE_INTERVAL = 2000;
const unsigned long BLINK_INTERVAL = 500;

// Khai báo kiểu trước hàm đầu tiên để Arduino tạo prototype đúng thứ tự.
struct StoredState {
  uint32_t magic;
  uint8_t state[3];
  uint8_t check;
};

// Chỉ xử lý random/GPIO, không chờ mạng hoặc đọc DHT trong tác vụ này.
void serviceRandomSensors() {
  const unsigned long now = millis();
  if (now - lastRandomAt >= SAMPLE_INTERVAL) {
    lastRandomAt = now;
    randomValues[0] = random(0, 12);
    randomValues[1] = random(0, 102);
    randomValues[2] = random(0, 1002);
  }
  // So sánh giá trị với ngưỡng cảnh báo, quyết định bật, tắt hay nháy LED
  for (int i = 0; i < 3; i++) {
    const bool active = randomValues[i] > warningThresholds[i];
    if (!active) {
      warningOn[i] = false;
    } else if (!warningActive[i]) {
      warningOn[i] = true;
      warningChangedAt[i] = now;
    } else {
      const unsigned long steps = (now - warningChangedAt[i]) / BLINK_INTERVAL;
      if (steps > 0) {
        if (steps % 2 != 0) {
          warningOn[i] = !warningOn[i];
        }
        warningChangedAt[i] += steps * BLINK_INTERVAL;
      }
    }
    warningActive[i] = active;
    digitalWrite(warningPins[i], warningOn[i] ? HIGH : LOW);
  }
}

// Tiếp tục cập nhật LED khi PubSubClient chờ CONNACK từ broker.
class ResponsiveWiFiClient : public WiFiClient {
 public:
  int available() override {
    serviceRandomSensors();
    yield();
    return WiFiClient::available();
  }
};

const int mqtt_port = 2005;
const char* TOPIC_SENSOR = "iot/sensors/data";
const char* TOPIC_COMMAND = "iot/devices/command";
const char* TOPIC_STATUS = "iot/devices/status";

DHT dht(DHTPIN, DHTTYPE);
ResponsiveWiFiClient espClient;
PubSubClient client(espClient);

const uint8_t devicePins[3] = {
  DEVICE1_PIN, DEVICE2_PIN, DEVICE3_PIN
};

uint8_t deviceState[3] = {0, 0, 0};
unsigned long lastMsg = 0;

const uint32_t STATE_MAGIC = 0x494F5431UL;
const int EEPROM_SIZE = 64;

uint8_t stateCheck(const StoredState& stored) {
  return (uint8_t)(
    0xA5 ^ stored.state[0] ^
    (stored.state[1] << 1) ^
    (stored.state[2] << 2)
  );
}

// Chỉ xác nhận lệnh sau khi lưu trạng thái thành công.
bool writeStatesToFlash(const uint8_t values[3]) {
  StoredState stored;
  stored.magic = STATE_MAGIC;

  for (int i = 0; i < 3; i++) {
    stored.state[i] = values[i];
  }

  stored.check = stateCheck(stored);
  EEPROM.put(0, stored);

  return EEPROM.commit();
}

// Khôi phục ON/OFF từ Flash sau khi mất nguồn.
void restoreStatesFromFlash() {
  EEPROM.begin(EEPROM_SIZE);

  StoredState stored;
  EEPROM.get(0, stored);

  bool valid = (
    stored.magic == STATE_MAGIC &&
    stored.state[0] <= 1 &&
    stored.state[1] <= 1 &&
    stored.state[2] <= 1 &&
    stored.check == stateCheck(stored)
  );

  for (int i = 0; i < 3; i++) {
    deviceState[i] = valid ? stored.state[i] : 0;

    digitalWrite(
      devicePins[i],
      deviceState[i] ? HIGH : LOW
    );
  }

  if (valid) {
    Serial.println("Restored ON/OFF from flash");
  } else {
    Serial.println("No saved state, default OFF");
  }
}

void setup_wifi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  lastWifiAttempt = millis();
}

// Backend dùng bản tin này để xác nhận trạng thái thiết bị.
void publishDeviceState(int id) {
  String payload =
    "{\"device\":" + String(id) +
    ",\"status\":\"" +
    (deviceState[id - 1] ? "ON" : "OFF") +
    "\"}";

  if (!client.publish(
    TOPIC_STATUS,
    payload.c_str(),
    false
  )) {
    Serial.println("Cannot publish device status");
  }
}

// Gửi lại cả ba trạng thái sau mỗi lần MQTT kết nối.
void publishAllDeviceStates() {
  for (int id = 1; id <= 3; id++) {
    publishDeviceState(id);
    client.loop();
  }
}

void callback(
  char* topic,
  byte* payload,
  unsigned int length
) {
  if (String(topic) != TOPIC_COMMAND) {
    return;
  }

  if (length < 4 || length > 5) {
    Serial.println("Invalid command length");
    return;
  }

  String message = "";

  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  // Định dạng lệnh: 1:ON, 2:OFF, 3:ON...
  if (
    message.length() < 4 ||
    message.charAt(1) != ':' ||
    message.charAt(0) < '1' ||
    message.charAt(0) > '3'
  ) {
    Serial.println("Invalid device command");
    return;
  }

  String action = message.substring(2);

  if (action != "ON" && action != "OFF") {
    Serial.println("Action must be ON or OFF");
    return;
  }

  int id = message.charAt(0) - '0';
  uint8_t newValue = (action == "ON") ? 1 : 0;

  // Chỉ ghi Flash khi ON/OFF thay đổi để hạn chế số lần ghi.
  if (deviceState[id - 1] != newValue) {
    uint8_t nextStates[3] = {
      deviceState[0],
      deviceState[1],
      deviceState[2]
    };

    nextStates[id - 1] = newValue;

    if (!writeStatesToFlash(nextStates)) {
      Serial.println("Flash save failed");
      return;
    }

    deviceState[id - 1] = newValue;
  }

  digitalWrite(
    devicePins[id - 1],
    newValue ? HIGH : LOW
  );

  publishDeviceState(id);

  Serial.println(
    "Device " + String(id) + " -> " + action
  );
}

void reconnect() {
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttempt >= 10000) {
      lastWifiAttempt = now;
      WiFi.reconnect();
    }
    return;
  }
  if (!client.connected() && now - lastMqttAttempt >= 5000) {
    lastMqttAttempt = now;

    Serial.print("Connecting to MQTT... ");

    if (client.connect(
      "ESP8266Client",
      mqtt_user,
      mqtt_pass
    )) {
      Serial.println("Connected!");

      client.subscribe(TOPIC_COMMAND);

      publishAllDeviceStates();

    } else {
      Serial.print("Failed rc=");
      Serial.println(client.state());
    }
  }
}

// Đọc DHT lỗi vẫn gửi Light và ba cảm biến random.
void publishSensorData() {
  float humidityValue = dht.readHumidity();
  float temperatureValue = dht.readTemperature();
  int light = 1023 - analogRead(LIGHT_PIN);

  char temperature[32] = "";
  char humidity[32] = "";
  if (!isnan(temperatureValue)) {
    snprintf(temperature, sizeof(temperature), ",\"temperature\":%.2f", temperatureValue);
  }
  if (!isnan(humidityValue)) {
    snprintf(humidity, sizeof(humidity), ",\"humidity\":%.2f", humidityValue);
  }
  if (isnan(humidityValue) || isnan(temperatureValue)) {
    Serial.println("DHT11 read failed; publishing other sensors");
  }

  char payload[192];
  const int length = snprintf(payload, sizeof(payload),
    "{\"light\":%d,\"sensor4\":%d,\"sensor5\":%d,\"sensor6\":%d%s%s}",
    light, randomValues[0], randomValues[1], randomValues[2], temperature, humidity);
  if (length < 0 || (size_t)length >= sizeof(payload)) {
    Serial.println("Sensor payload buffer too small");
  } else if (client.connected() && client.publish(TOPIC_SENSOR, payload)) {
    Serial.println(payload);
  } else {
    Serial.println("Sensor MQTT publish failed");
  }
}
// Chương trình bắt đầu chạy từ setup() 
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 3; i++) {
    pinMode(devicePins[i], OUTPUT);
    digitalWrite(devicePins[i], LOW);
    pinMode(warningPins[i], OUTPUT);
    digitalWrite(warningPins[i], LOW);
  }

  randomSeed(ESP.getCycleCount() ^ micros());
  lastRandomAt = millis() - SAMPLE_INTERVAL;
  serviceRandomSensors();
  // TCP/DNS có yield(): tác vụ nền tiếp tục cập nhật LED lúc chờ mạng.
  if (!schedule_recurrent_function_us([]() {
    serviceRandomSensors();
    return true;
  }, 10000)) {
    Serial.println("Cannot schedule background warning service");
  }

  restoreStatesFromFlash();

  dht.begin();
  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setSocketTimeout(1);
  if (!client.setBufferSize(384)) {
    Serial.println("Cannot resize MQTT buffer");
  }
  lastMqttAttempt = millis() - 5000UL;
}

void loop() {
  serviceRandomSensors();
  if (!client.connected()) {
    reconnect();
  }

  if (WiFi.status() == WL_CONNECTED && client.connected()) {
    client.loop();
  }

  unsigned long now = millis();

  // Giữ chu kỳ gửi dữ liệu 2 giây, độc lập với nhấp nháy LED.
  if (now - lastMsg >= SAMPLE_INTERVAL) {
    lastMsg = now;

    publishSensorData();
  }
  serviceRandomSensors();
}
