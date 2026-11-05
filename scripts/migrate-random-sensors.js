const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
const {db}=require('../src/config');

(async()=>{
  let conn;
  try {
    conn=await mysql.createConnection({...db,multipleStatements:true,connectTimeout:5000});
    // Refuse a different schema before executing the additive SQL migration.
    const [columns]=await conn.query('SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?)',[db.database,'sensors','sensor_data']);
    const column=(table,name)=>columns.find(c=>c.TABLE_NAME===table&&c.COLUMN_NAME===name);
    const id=column('sensors','id');
    const value=column('sensor_data','value');
    if(id?.DATA_TYPE!=='int'||id.EXTRA.includes('auto_increment')||
       column('sensors','name')?.DATA_TYPE!=='varchar'||column('sensors','unit')?.DATA_TYPE!=='varchar'||
       value?.DATA_TYPE!=='double') throw new Error('Schema khác schema đã kiểm tra. Kiểm tra SHOW CREATE TABLE sensors/sensor_data trước khi chạy migration.');
    const [indexes]=await conn.query("SELECT INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='sensors' AND NON_UNIQUE=0 GROUP BY INDEX_NAME",[db.database]);
    if(!indexes.some(i=>i.cols==='name')||!indexes.some(i=>i.INDEX_NAME==='PRIMARY'&&i.cols==='id')) throw new Error('sensors cần PRIMARY KEY(id) và UNIQUE(name).');
    await conn.query(fs.readFileSync(path.join(__dirname,'migrations','001-random-sensors.sql'),'utf8'));
    const [rows]=await conn.query("SELECT id,name,unit FROM sensors WHERE name IN ('Sensor 4','Sensor 5','Sensor 6') ORDER BY name");
    console.log('Migration hoàn tất (có thể chạy lại an toàn):');
    console.table(rows);
  } catch(err) {
    if(conn) await conn.rollback();
    console.error('Migration thất bại:',err.message);
    process.exitCode=1;
  } finally {if(conn) await conn.end();}
})();
