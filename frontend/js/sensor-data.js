let sensorPage = 1;
let sensorPageSize = Number(document.getElementById('sensorLines').value);
let activeSensorFilter = { type: 'All Sensors', value: '' };
let sensorRequestId = 0;

function formatSensorValue(sensor) {
  const unit = { Temperature: '°C', Humidity: '%', Light: 'lux' }[sensor.type];
  return unit ? `${sensor.value} ${unit}` : String(sensor.value);
}

function renderSensorPages(pages) {
  renderPagination('sensorPages', pages, sensorPage, next => {
    sensorPage = next;
    loadSensor();
  });
}

async function loadSensor() {
  const requestId = ++sensorRequestId;
  const tbody = document.getElementById('sensorRows');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Loading...</td></tr>';
  const params = new URLSearchParams({
    ...activeSensorFilter,
    page: String(sensorPage),
    size: String(sensorPageSize)
  });
  try {
    const result = await iotApi.request('/api/sensor-data/history?' + params.toString());
    // Bỏ phản hồi cũ nếu người dùng đã tìm kiếm hoặc đổi trang lần nữa.
    if (requestId !== sensorRequestId) return;
    const escape = iotApi.escape;
    tbody.innerHTML = result.content.length
      ? result.content.map(sensor => `<tr><td><strong>${escape(sensor.id)}</strong></td><td>${escape(sensor.type)}</td><td><strong>${escape(formatSensorValue(sensor))}</strong></td><td><span class="time-value">${escape(sensor.time)}</span>${timeCopyButton(sensor.time)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="4">No matching sensor data.</td></tr>';
    const first = result.totalElements ? (sensorPage - 1) * sensorPageSize + 1 : 0;
    const last = Math.min(sensorPage * sensorPageSize, result.totalElements);
    document.getElementById('sensorRecords').textContent = `Showing ${first} to ${last} of ${result.totalElements} records`;
    renderSensorPages(result.totalPages);
  } catch (err) {
    if (requestId !== sensorRequestId) return;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${iotApi.escape(err.message)}</td></tr>`;
    document.getElementById('sensorRecords').textContent = 'Cannot load data';
    document.getElementById('sensorPages').innerHTML = '';
  }
}

document.getElementById('sensorSearch').onclick = () => {
  activeSensorFilter = {
    type: document.getElementById('sensorType').value,
    value: document.getElementById('sensorValue').value.trim()
  };
  sensorPage = 1;
  loadSensor();
};
document.getElementById('sensorLines').onchange = event => {
  sensorPageSize = Number(event.target.value);
  sensorPage = 1;
  loadSensor();
};
document.getElementById('sensorReset').onclick = () => {
  document.getElementById('sensorType').value = 'All Sensors';
  document.getElementById('sensorValue').value = '';
  activeSensorFilter = { type: 'All Sensors', value: '' };
  sensorPage = 1;
  loadSensor();
};
document.getElementById('sensorValue').addEventListener('keydown', event => {
  if (event.key === 'Enter') document.getElementById('sensorSearch').click();
});
loadSensor();
