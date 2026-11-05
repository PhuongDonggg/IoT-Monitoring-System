#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <EEPROM.h>
#include <Schedule.h>
#include "secrets.h"

// GIU NGUYEN CHAN KET NOI
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

// Khai bao kieu truoc ham dau tien de Arduino tao prototype dung thu tu.
struct StoredState {
  uint32_t magic;
  uint8_t state[3];
  uint8_t check;
};

// Chi xu ly random/GPIO: khong MQTT, DHT, delay hay cap phat bo nho.
void serviceRandomSensors() {
  const unsigned long now = millis();
  if (now - lastRandomAt >= SAMPLE_INTERVAL) {
    lastRandomAt = now;
    randomValues[0] = random(0, 12);
    randomValues[1] = random(0, 102);
    randomValues[2] = random(0, 1002);
  }
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
        if (steps % 2 != 0) warningOn[i] = !warningOn[i];
        warningChangedAt[i] += steps * BLINK_INTERVAL;
      }
    }
    warningActive[i] = active;
    digitalWrite(warningPins[i], warningOn[i] ? HIGH : LOW);
  }
}

// PubSubClient cho CONNACK bang available() trong mot vong lap dong bo.
// Cho ESP8266 xu ly WiFi va cac tac vu millis trong luc doi broker.
class ResponsiveWiFiClient : public WiFiClient {
 public:
  int available() override {
    serviceRandomSensors();
    yield();
    return WiFiClient::available();
  }
};

// MQTT
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

// LUU TRANG THAI VAO FLASH
const uint32_t STATE_MAGIC = 0x494F5431UL;
const int EEPROM_SIZE = 64;

uint8_t stateCheck(const StoredState& s) {
  return (uint8_t)(
    0xA5 ^ s.state[0] ^
    (s.state[1] << 1) ^
    (s.state[2] << 2)
  );
}

// GHI TRANG THAI VAO FLASH
bool writeStatesToFlash(const uint8_t values[3]) {
  StoredState s;
  s.magic = STATE_MAGIC;

  for (int i = 0; i < 3; i++) {
    s.state[i] = values[i];
  }

  s.check = stateCheck(s);
  EEPROM.put(0, s);

  return EEPROM.commit();
}

// KHOI PHUC TRANG THAI SAU KHI MAT NGUON
void restoreStatesFromFlash() {
  EEPROM.begin(EEPROM_SIZE);

  StoredState s;
  EEPROM.get(0, s);

  bool valid = (
    s.magic == STATE_MAGIC &&
    s.state[0] <= 1 &&
    s.state[1] <= 1 &&
    s.state[2] <= 1 &&
    s.check == stateCheck(s)
  );

  for (int i = 0; i < 3; i++) {
    deviceState[i] = valid ? s.state[i] : 0;

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

// KET NOI WIFI
void setup_wifi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  lastWifiAttempt = millis();
}

// GUI TRANG THAI THIET BI QUA MQTT
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

// DONG BO 3 THIET BI KHI MQTT KET NOI
void publishAllDeviceStates() {
  for (int id = 1; id <= 3; id++) {
    publishDeviceState(id);
    client.loop();
  }
}

// NHAN LENH DIEU KHIEN
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

  // Dinh dang: 1:ON, 2:OFF, 3:ON...
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

  // CHI GHI FLASH KHI TRANG THAI THAY DOI
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

  // THUC HIEN LENH
  digitalWrite(
    devicePins[id - 1],
    newValue ? HIGH : LOW
  );

  // PHAN HOI TRANG THAI THUC TE
  publishDeviceState(id);

  Serial.println(
    "Device " + String(id) + " -> " + action
  );
}

// KET NOI LAI MQTT
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

      // GUI TRANG THAI DA KHOI PHUC
      publishAllDeviceStates();

    } else {
      Serial.print("Failed rc=");
      Serial.println(client.state());
    }
  }
}

// SETUP
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
  // Core ESP8266 da co san Schedule.h. TCP/DNS cho mang se yield(),
  // nen random va LED van cap nhat khi cac ham ket noi dang doi.
  if (!schedule_recurrent_function_us([]() {
    serviceRandomSensors();
    return true;
  }, 10000)) {
    Serial.println("Cannot schedule background warning service");
  }

  // LAY TRANG THAI CU TU FLASH
  restoreStatesFromFlash();

  dht.begin();
  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setSocketTimeout(1);
  if (!client.setBufferSize(384)) Serial.println("Cannot resize MQTT buffer");
  lastMqttAttempt = millis() - 5000UL;
}

// LOOP
void loop() {
  serviceRandomSensors();
  if (!client.connected()) {
    reconnect();
  }

  if (WiFi.status() == WL_CONNECTED && client.connected()) client.loop();

  unsigned long now = millis();

  // GUI DU LIEU CAM BIEN MOI 2 GIAY
  if (now - lastMsg >= SAMPLE_INTERVAL) {
    lastMsg = now;

    float h = dht.readHumidity();
    float t = dht.readTemperature();
    int light = 1023 - analogRead(LIGHT_PIN);

    char temperature[32] = "";
    char humidity[32] = "";
    if (!isnan(t)) snprintf(temperature, sizeof(temperature), ",\"temperature\":%.2f", t);
    if (!isnan(h)) snprintf(humidity, sizeof(humidity), ",\"humidity\":%.2f", h);
    if (isnan(h) || isnan(t)) Serial.println("DHT11 read failed; publishing other sensors");

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
  serviceRandomSensors();
}
