CREATE DATABASE IF NOT EXISTS iot_monitoring
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE iot_monitoring;

CREATE TABLE IF NOT EXISTS users (
  id INT NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensors (
  id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sensors_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensor_data (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sensor_id INT NOT NULL,
  value DOUBLE NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sensor_data_latest (sensor_id, created_at DESC, id DESC),
  KEY idx_sensor_data_time (created_at DESC, id DESC),
  CONSTRAINT fk_sensor_data_sensor FOREIGN KEY (sensor_id) REFERENCES sensors (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS devices (
  id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  status ENUM('ON','OFF','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS action_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  device_id INT NOT NULL,
  action ENUM('ON','OFF') NOT NULL,
  status ENUM('PENDING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  error_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_action_device_time (device_id, created_at DESC, id DESC),
  KEY idx_action_time (created_at DESC, id DESC),
  KEY idx_action_user_time (user_id, created_at DESC),
  CONSTRAINT fk_action_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_action_device FOREIGN KEY (device_id) REFERENCES devices (id)
) ENGINE=InnoDB;

INSERT INTO sensors (id, name, unit) VALUES
 (1, 'Temperature', '°C'), (2, 'Humidity', '%'), (3, 'Light', 'lux')
ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit);

INSERT INTO devices (id, name, status) VALUES
 (1, 'Device 1', 'UNKNOWN'), (2, 'Device 2', 'UNKNOWN'), (3, 'Device 3', 'UNKNOWN')
ON DUPLICATE KEY UPDATE name = VALUES(name);

SELECT 'users' AS table_name, COUNT(*) AS count_rows FROM users
UNION ALL SELECT 'sensors', COUNT(*) FROM sensors
UNION ALL SELECT 'sensor_data', COUNT(*) FROM sensor_data
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'action_history', COUNT(*) FROM action_history;
