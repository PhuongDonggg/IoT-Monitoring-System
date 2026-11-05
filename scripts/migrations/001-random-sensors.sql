-- Schema verified on the existing MySQL database:
-- sensors(id INT PRIMARY KEY, name VARCHAR(100) UNIQUE, unit VARCHAR(20))
-- sensor_data.value DOUBLE already supports 1001. No schema/data reset needed.
-- Lock the registry before allocating unused IDs (id is NOT AUTO_INCREMENT).
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
START TRANSACTION;
SELECT id FROM sensors ORDER BY id FOR UPDATE;

INSERT INTO sensors(id,name,unit)
SELECT next_id,'Sensor 4','' FROM (SELECT COALESCE(MAX(id),0)+1 AS next_id FROM sensors) AS allocation
WHERE NOT EXISTS (SELECT 1 FROM sensors WHERE name='Sensor 4');

INSERT INTO sensors(id,name,unit)
SELECT next_id,'Sensor 5','' FROM (SELECT COALESCE(MAX(id),0)+1 AS next_id FROM sensors) AS allocation
WHERE NOT EXISTS (SELECT 1 FROM sensors WHERE name='Sensor 5');

INSERT INTO sensors(id,name,unit)
SELECT next_id,'Sensor 6','' FROM (SELECT COALESCE(MAX(id),0)+1 AS next_id FROM sensors) AS allocation
WHERE NOT EXISTS (SELECT 1 FROM sensors WHERE name='Sensor 6');
COMMIT;
