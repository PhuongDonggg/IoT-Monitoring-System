// Ten trong database la dinh danh; khong suy ra sensor_id tu so thu tu.
const sensors = [
  {key:'temperature', name:'Temperature', min:-40, max:125},
  {key:'humidity', name:'Humidity', min:0, max:100},
  {key:'light', name:'Light', min:0, max:1023, integer:true},
  {key:'sensor4', name:'Sensor 4', min:0, max:11, integer:true},
  {key:'sensor5', name:'Sensor 5', min:0, max:101, integer:true},
  {key:'sensor6', name:'Sensor 6', min:0, max:1001, integer:true}
];
module.exports = sensors;
