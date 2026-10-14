#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <EEPROM.h>
#include "secrets.h"

// GIU NGUYEN CHAN KET NOI
#define DEVICE1_PIN D1
#define DEVICE2_PIN D2
#define DEVICE3_PIN D3
#define DHTPIN D4
#define LIGHT_PIN A0
#define DHTTYPE DHT11

// MQTT
const int mqtt_port = 2005;
const char* TOPIC_SENSOR = "iot/sensors/data";
const char* TOPIC_COMMAND = "iot/devices/command";
const char* TOPIC_STATUS = "iot/devices/status";

DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);

const uint8_t devicePins[3] = {
  DEVICE1_PIN, DEVICE2_PIN, DEVICE3_PIN
};

uint8_t deviceState[3] = {0, 0, 0};
unsigned long lastMsg = 0;

// LUU TRANG THAI VAO FLASH
const uint32_t STATE_MAGIC = 0x494F5431UL;
const int EEPROM_SIZE = 64;

struct StoredState {
  uint32_t magic;
  uint8_t state[3];
  uint8_t check;
};

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
  delay(10);

  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
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
    delay(20);
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
  while (!client.connected()) {

    if (WiFi.status() != WL_CONNECTED) {
      setup_wifi();
    }

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
      delay(5000);
    }
  }
}

// SETUP
void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 3; i++) {
    pinMode(devicePins[i], OUTPUT);
    digitalWrite(devicePins[i], LOW);
  }

  // LAY TRANG THAI CU TU FLASH
  restoreStatesFromFlash();

  dht.begin();
  setup_wifi();

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

// LOOP
void loop() {
  if (!client.connected()) {
    reconnect();
  }

  client.loop();

  unsigned long now = millis();

  // GUI DU LIEU CAM BIEN MOI 2 GIAY
  if (now - lastMsg >= 2000) {
    lastMsg = now;

    float h = dht.readHumidity();
    float t = dht.readTemperature();
    int light = analogRead(LIGHT_PIN);

    if (isnan(h) || isnan(t)) {
      Serial.println("DHT11 read failed");
      return;
    }

    String payload =
      "{\"temperature\":" + String(t) +
      ",\"humidity\":" + String(h) +
      ",\"light\":" + String(light) + "}";

    if (client.publish(
      TOPIC_SENSOR,
      payload.c_str()
    )) {
      Serial.println(payload);
    } else {
      Serial.println("Sensor MQTT publish failed");
    }
  }
}
