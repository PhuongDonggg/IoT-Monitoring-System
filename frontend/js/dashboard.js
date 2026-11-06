const chartCtx = document.getElementById('sensorChart');
let chart = null;
const chartLimit = 20;
const sensorSeries = { temperature: [], humidity: [], light: [] };
const deviceStates = new Map([[1, 'UNKNOWN'], [2, 'UNKNOWN'], [3, 'UNKNOWN']]);
const pendingDevices = new Set();
let mqttConnected = false;
let deviceErrorTimer = null;

function makeChart() {
  if (!window.Chart) {
    const label = document.querySelector('.chart-card .card-title');
    label.title = 'Không tải được Chart.js từ CDN. Kiểm tra kết nối Internet.';
    return;
  }
  chart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperature (°C)', data: [], borderColor: '#198c8f', backgroundColor: '#198c8f',
          tension: .25, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y'
        },
        {
          label: 'Humidity (%)', data: [], borderColor: '#2f7bc7', backgroundColor: '#2f7bc7',
          tension: .25, pointRadius: 0, borderWidth: 2.5, yAxisID: 'y'
        },
        {
          label: 'Light (lux)', data: [], borderColor: '#f0aa24', backgroundColor: '#f0aa24',
          tension: .25, pointRadius: 0, borderWidth: 2.5, yAxisID: 'yLight'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [],
      plugins: {
        legend: {
          position: 'top',
          labels: {
            boxWidth: 24, boxHeight: 4, padding: 16, color: '#17243b',
            font: context => ({ size: context.chart.width < 480 ? 12 : 14, weight: '500' })
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#f1f3f6' },
          ticks: {
            color: '#6b7688', font: { size: 12 }, maxTicksLimit: 7,
            maxRotation: 0, autoSkipPadding: 12, padding: 8
          }
        },
        y: {
          position: 'left', min: 0, max: 100,
          ticks: { stepSize: 25, color: '#6b7688', font: { size: 12 }, padding: 8 },
          grid: { color: '#edf1f4' }
        },
        yLight: {
          position: 'right', min: 0, grace: '10%',
          ticks: { color: '#a07828', font: { size: 11 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function drawSeries() {
  if (!chart) return;
  const allPoints = Object.values(sensorSeries).flat();
  const times = Array.from(new Set(allPoints.map(point => point.recordedAt || point.time)))
    .sort().slice(-chartLimit);
  chart.data.labels = times.map(time => {
    const point = allPoints.find(item => (item.recordedAt || item.time) === time);
    return (point?.time || time || '').slice(11, 19);
  });
  ['temperature', 'humidity', 'light'].forEach((key, index) => {
    const byTime = new Map(sensorSeries[key].map(point => [point.recordedAt || point.time, point.value]));
    chart.data.datasets[index].data = times.map(time => byTime.has(time) ? byTime.get(time) : null);
  });
  chart.update('none');
}

function updateCurrent(data) {
  const fields = [['tempNow', 'temperature', '°C'], ['humNow', 'humidity', '%'], ['lightNow', 'light', 'lux']];
  fields.forEach(([id, key, unit]) => {
    const element = document.getElementById(id);
    element.textContent = typeof data[key] === 'number' ? `${data[key]} ${unit}` : `-- ${unit}`;
  });
  document.querySelectorAll('.sensor-value .updated').forEach(element => {
    element.textContent = data.time ? `Updated ${data.time}` : 'No real sensor data yet';
  });
}

function appendSensor(data) {
  const time = data.recordedAt || data.time;
  if (!time) return;
  for (const key of ['temperature', 'humidity', 'light']) {
    if (typeof data[key] !== 'number') continue;
    const points = sensorSeries[key];
    // Không nhân đôi điểm khi REST và Socket.IO trả cùng dữ liệu.
    const index = points.findIndex(point => (point.recordedAt || point.time) === time);
    if (index !== -1) points.splice(index, 1);
    points.push({ time: data.time, recordedAt: time, value: data[key] });
    points.sort((a, b) => String(a.recordedAt || a.time).localeCompare(String(b.recordedAt || b.time)));
    if (points.length > chartLimit) points.splice(0, points.length - chartLimit);
  }
  updateCurrent(data);
  drawSeries();
}

function setDeviceState(card, status, busy = false) {
  const label = card.querySelector('.state');
  label.textContent = status;
  label.className = 'state ' + (status === 'ON' ? 'on' : status === 'OFF' ? 'off' : 'unknown');
  card.querySelector('.processing').textContent = busy ? 'PENDING...' : '';
  card.querySelectorAll('.device-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.action === status);
    button.disabled = busy || status === 'UNKNOWN' || !mqttConnected || button.dataset.action === status;
  });
}

function refreshDeviceCard(id) {
  const card = document.querySelector(`.device-card[data-device="${id}"]`);
  if (card) setDeviceState(card, deviceStates.get(id) || 'UNKNOWN', pendingDevices.has(id));
}

async function loadDevices() {
  try {
    const devices = await iotApi.request('/api/devices');
    devices.forEach(device => {
      deviceStates.set(device.id, device.status);
      refreshDeviceCard(device.id);
    });
  } catch (err) {
    console.warn('Device load:', err.message);
  }
}

async function loadSystem() {
  try {
    const system = await iotApi.request('/api/system/status');
    mqttConnected = Boolean(system.mqttConnected);
  } catch {
    mqttConnected = false;
  }
  for (const id of deviceStates.keys()) refreshDeviceCard(id);
}

function showDeviceError(id, action) {
  const title = document.querySelector('.device-panel .card-title');
  const name = document.querySelector(`.device-card[data-device="${id}"] .device-name`)?.textContent.trim() || `Device ${id}`;
  title.textContent = `Device Control — ${name}: Failed to turn ${action}`;
  clearTimeout(deviceErrorTimer);
  deviceErrorTimer = setTimeout(() => {
    title.textContent = 'Device Control';
  }, 6500);
}

async function controlDevice(id, action) {
  const status = deviceStates.get(id) || 'UNKNOWN';
  if (!mqttConnected || pendingDevices.has(id) || status === 'UNKNOWN' || action === status) return;
  pendingDevices.add(id);
  refreshDeviceCard(id);
  try {
    await iotApi.request(`/api/devices/${id}/control`, {
      method: 'POST',
      body: JSON.stringify({ action })
    });
    // Nếu Socket.IO rớt, bỏ PENDING cục bộ rồi đọc lại trạng thái đã lưu.
    setTimeout(() => {
      if (pendingDevices.has(id)) {
        pendingDevices.delete(id);
        loadDevices();
      }
    }, 6500);
  } catch {
    pendingDevices.delete(id);
    refreshDeviceCard(id);
    showDeviceError(id, action);
  }
}

document.querySelectorAll('.device-card').forEach(card => {
  const id = Number(card.dataset.device);
  refreshDeviceCard(id);
  card.querySelectorAll('.device-btn').forEach(button => {
    button.addEventListener('click', () => controlDevice(id, button.dataset.action));
  });
});

async function loadDashboard() {
  const results = await Promise.allSettled([
    iotApi.request('/api/sensor-data/latest'),
    iotApi.request(`/api/sensor-data/chart?limit=${chartLimit}`)
  ]);
  if (results[0].status === 'fulfilled') updateCurrent(results[0].value);
  if (results[1].status === 'fulfilled') {
    const chartData = results[1].value;
    ['temperature', 'humidity', 'light'].forEach(key => sensorSeries[key] = chartData[key] || []);
    drawSeries();
  }
}

makeChart();
loadDashboard();
Promise.all([loadSystem(), loadDevices()]);
const liveSocket = iotApi.socket();
if (liveSocket) {
  liveSocket.on('sensor:update', appendSensor);
  liveSocket.on('device:status', event => {
    deviceStates.set(Number(event.deviceId), event.status);
    refreshDeviceCard(Number(event.deviceId));
  });
  liveSocket.on('action:update', event => {
    if (event.status !== 'PENDING') {
      pendingDevices.delete(Number(event.deviceId));
      refreshDeviceCard(Number(event.deviceId));
      if (event.status === 'FAILED') showDeviceError(Number(event.deviceId), event.action);
    }
  });
  liveSocket.on('system:status', event => {
    mqttConnected = Boolean(event.mqttConnected);
    for (const id of deviceStates.keys()) refreshDeviceCard(id);
    refreshSystemIndicator();
  });
  liveSocket.on('connect', () => {
    loadDashboard();
    loadDevices();
    loadSystem();
  });
}
// Đồng bộ khi bỏ lỡ sự kiện hoặc sau sự cố mạng.
setInterval(() => {
  loadDevices();
  loadSystem();
}, 10000);
