const randomDefinitions = [
  { key: 'sensor4', name: 'Sensor 4', max: 11, threshold: 5.5, color: '#198c8f' },
  { key: 'sensor5', name: 'Sensor 5', max: 101, threshold: 50.5, color: '#2f7bc7' },
  { key: 'sensor6', name: 'Sensor 6', max: 1001, threshold: 500.5, color: '#c27c12' }
];
const randomLatest = {};
const randomChartLimit = 20;
const randomSeries = Object.fromEntries(randomDefinitions.map(sensor => [sensor.key, []]));
const staleAfterMs = 10000;
let randomSystem = null;
let randomBackendReachable = false;
let randomChart = null;
let historyRequestId = 0;
let latestRequestId = 0;
let systemRequestId = 0;
const randomGrid = document.getElementById('randomCards');
randomGrid.innerHTML = randomDefinitions.map(sensor => `
  <article class="card random-card offline" id="${sensor.key}Card" aria-labelledby="${sensor.key}Name">
    <div class="random-card-head"><h2 id="${sensor.key}Name">${sensor.name}</h2><span class="random-state">OFFLINE</span></div>
    <div class="random-value">--</div><div class="random-range">Range 0–${sensor.max} · Warning &gt; ${sensor.threshold}</div>
    <div class="random-meter-label"><span>Percentage of maximum</span><strong class="random-percent">--%</strong></div>
    <progress max="100" value="0" aria-label="${sensor.name} percentage"></progress>
    <div class="random-updated">No sensor data received</div>
  </article>`).join('');

function randomIsValid(value, sensor) {
  return Number.isInteger(value) && value >= 0 && value <= sensor.max;
}

function randomLiveEnabled() {
  return document.getElementById('randomLive').checked;
}

function randomSensorState(point, sensor, online) {
  if (!online) return 'OFFLINE';
  if (!point || Date.now() - Date.parse(point.recordedAt) >= staleAfterMs) return 'STALE';
  return point.value > sensor.threshold ? 'WARNING' : 'SAFE';
}

function randomRender() {
  const online = randomBackendReachable && randomSystem?.mqttConnected && randomSystem?.sensorOnline;
  const fresh = randomDefinitions.every(sensor => {
    const point = randomLatest[sensor.key];
    return point && Date.now() - Date.parse(point.recordedAt) < staleAfterMs;
  });
  const badge = document.getElementById('randomConnection');
  badge.textContent = !online ? 'OFFLINE' : fresh ? 'LIVE' : 'STALE';
  badge.classList.toggle('connected', Boolean(online && fresh));
  randomDefinitions.forEach(sensor => {
    const card = document.getElementById(sensor.key + 'Card');
    const point = randomLatest[sensor.key];
    const percentage = point ? point.value / sensor.max * 100 : null;
    const state = randomSensorState(point, sensor, online);
    card.className = 'card random-card ' + state.toLowerCase();
    card.querySelector('.random-state').textContent = state;
    card.querySelector('.random-value').textContent = point ? String(point.value) : '--';
    card.querySelector('.random-percent').textContent = percentage === null ? '--%' : percentage.toFixed(1) + '%';
    card.querySelector('progress').value = percentage ?? 0;
    card.querySelector('.random-updated').textContent = point
      ? 'Last received: ' + (point.time || point.recordedAt)
      : 'No sensor data received';
  });
}

function randomApplyCurrent(data) {
  randomDefinitions.forEach(sensor => {
    const recordedAt = data.sensorRecordedAt ? data.sensorRecordedAt[sensor.key] : data.recordedAt;
    if (!randomIsValid(data[sensor.key], sensor) || !recordedAt || !Number.isFinite(Date.parse(recordedAt))) return;
    const previous = randomLatest[sensor.key];
    if (previous && Date.parse(previous.recordedAt) > Date.parse(recordedAt)) return;
    randomLatest[sensor.key] = {
      value: data[sensor.key],
      recordedAt,
      time: data.sensorRecordedAt
        ? new Date(recordedAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })
        : data.time
    };
  });
  randomRender();
}

function randomMergePoints(key, points) {
  const sensor = randomDefinitions.find(definition => definition.key === key);
  const byTime = new Map();
  // Chuẩn hóa thời điểm để REST và Socket.IO không tạo điểm trùng nhau.
  for (const point of [...randomSeries[key], ...points]) {
    if (randomIsValid(point.value, sensor) && Number.isFinite(Date.parse(point.recordedAt))) {
      const recordedAt = new Date(point.recordedAt).toISOString();
      byTime.set(recordedAt, { ...point, recordedAt });
    }
  }
  randomSeries[key] = [...byTime.values()]
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
    .slice(-randomChartLimit);
}

function randomDrawChart() {
  if (!randomChart) return;
  const times = [...new Set(Object.values(randomSeries).flatMap(series => series.map(point => point.recordedAt)))]
    .sort().slice(-randomChartLimit);
  randomChart.data.labels = times.map(time => new Date(time).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false
  }));
  randomDefinitions.forEach((sensor, index) => {
    const values = new Map(randomSeries[sensor.key].map(point => [point.recordedAt, point.value]));
    const dataset = randomChart.data.datasets[index];
    dataset.data = times.map(time => values.has(time) ? values.get(time) / sensor.max * 100 : null);
  });
  randomChart.update('none');
}

function randomMakeChart() {
  if (!window.Chart) {
    document.getElementById('randomError').textContent = 'Cannot load Chart.js from CDN. Check your Internet connection; sensor cards remain available.';
    return;
  }
  randomChart = new Chart(document.getElementById('randomChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: randomDefinitions.map(sensor => ({
        label: sensor.name,
        data: [],
        borderColor: sensor.color,
        backgroundColor: sensor.color,
        tension: .2,
        borderWidth: 2,
        spanGaps: false
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [],
      elements: { point: { radius: 0, hoverRadius: 0 } },
      interaction: { mode: 'none', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: { enabled: false }
      },
      scales: {
        y: {
          min: 0, max: 100,
          title: { display: true, text: 'Percentage of maximum (%)' },
          ticks: { callback: value => value + '%' }
        },
        x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } }
      }
    }
  });
}

async function randomLoadHistory() {
  const requestId = ++historyRequestId;
  try {
    const data = await iotApi.request('/api/sensor-data/chart?limit=' + randomChartLimit);
    if (requestId !== historyRequestId || !randomLiveEnabled()) return;
    randomDefinitions.forEach(sensor => randomMergePoints(sensor.key, data[sensor.key] || []));
    randomDrawChart();
    if (randomChart) document.getElementById('randomError').textContent = '';
  } catch (err) {
    if (requestId === historyRequestId) document.getElementById('randomError').textContent = err.message;
  }
}

async function randomLoadLatest() {
  const requestId = ++latestRequestId;
  try {
    const data = await iotApi.request('/api/sensor-data/latest');
    if (requestId !== latestRequestId) return;
    randomApplyCurrent(data);
  } catch {
    // Thời điểm từng cảm biến và system polling quyết định STALE/OFFLINE.
  }
}

async function randomLoadSystem() {
  const requestId = ++systemRequestId;
  try {
    const data = await iotApi.request('/api/system/status');
    if (requestId !== systemRequestId) return;
    randomSystem = data;
    randomBackendReachable = true;
  } catch {
    if (requestId === systemRequestId) randomBackendReachable = false;
  }
  randomRender();
}

document.getElementById('randomLive').onchange = () => {
  // Hủy hiệu lực snapshot đang chờ để tắt Live cũng chặn phản hồi REST đến muộn.
  ++historyRequestId;
  if (randomLiveEnabled()) randomLoadHistory();
};
randomMakeChart();
randomRender();
randomLoadHistory();
randomLoadLatest();
randomLoadSystem();
const randomSocket = iotApi.socket();
if (randomSocket) {
  randomSocket.on('sensor:update', data => {
    randomBackendReachable = true;
    randomApplyCurrent(data);
    if (!randomLiveEnabled()) return;
    randomDefinitions.forEach(sensor => {
      if (randomIsValid(data[sensor.key], sensor)) {
        randomMergePoints(sensor.key, [{ value: data[sensor.key], recordedAt: data.recordedAt, time: data.time }]);
      }
    });
    randomDrawChart();
  });
  randomSocket.on('system:status', data => {
    ++systemRequestId;
    randomSystem = data;
    randomBackendReachable = true;
    randomRender();
  });
  randomSocket.on('connect', () => {
    randomLoadSystem();
    randomLoadLatest();
    if (randomLiveEnabled()) randomLoadHistory();
  });
  const disconnected = () => {
    ++systemRequestId;
    randomBackendReachable = false;
    randomRender();
  };
  randomSocket.on('disconnect', disconnected);
  randomSocket.on('connect_error', disconnected);
}
setInterval(randomRender, 1000);
setInterval(() => {
  randomLoadSystem();
  randomLoadLatest();
  if (!randomSocket?.connected && randomLiveEnabled()) randomLoadHistory();
}, 5000);
