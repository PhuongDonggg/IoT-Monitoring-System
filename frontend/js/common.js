if (!sessionStorage.getItem('iotToken')) window.location.replace('index.html');

function setActivePage() {
  const currentFile = decodeURIComponent(window.location.pathname).split('/').pop().toLowerCase();
  document.querySelectorAll('.nav a').forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === currentFile);
  });
}

setActivePage();

function logout() {
  sessionStorage.removeItem('iotToken');
  sessionStorage.removeItem('iotUser');
  window.location.href = 'index.html';
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeCopyButton(time) {
  const value = escapeHtmlAttribute(time);
  return `<button type="button" class="copy-time" data-copy-time="${value}" aria-label="Copy time" data-tooltip="Copy time"><svg class="copy-time-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="11" height="13" rx="1"></rect><rect x="4" y="8" width="11" height="13" rx="1"></rect></svg><svg class="copy-time-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg></button>`;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(input);
  input.select();
  input.setSelectionRange(0, input.value.length);
  const copied = document.execCommand('copy');
  input.remove();
  return copied;
}

document.addEventListener('click', async event => {
  const button = event.target.closest('.copy-time');
  if (!button) return;
  const copied = await writeClipboardText(button.dataset.copyTime);
  if (!copied) return;
  clearTimeout(button.copyResetTimer);
  button.classList.add('copied');
  button.setAttribute('aria-label', 'Copied!');
  button.dataset.tooltip = 'Copied!';
  button.copyResetTimer = setTimeout(() => {
    button.classList.remove('copied');
    button.setAttribute('aria-label', 'Copy time');
    button.dataset.tooltip = 'Copy time';
  }, 1500);
});

function renderPagination(containerId, pages, current, onSelect) {
  const count = Math.max(1, pages);
  const pageNumbers = new Set([1, count]);
  for (let page = Math.max(1, current - 2); page <= Math.min(count, current + 2); page++) {
    pageNumbers.add(page);
  }
  const ordered = [...pageNumbers].sort((a, b) => a - b);
  const buttons = [];
  let previous = 0;
  ordered.forEach(page => {
    if (page - previous > 1) buttons.push('<span class="page-dots">…</span>');
    buttons.push(`<button class="page-btn ${page === current ? 'active' : ''}" data-p="${page}">${page}</button>`);
    previous = page;
  });
  document.getElementById(containerId).innerHTML = `<button class="page-btn" data-p="prev" ${current === 1 ? 'disabled' : ''}>‹</button>${buttons.join('')}<button class="page-btn" data-p="next" ${current === count ? 'disabled' : ''}>›</button>`;
  document.querySelectorAll('#' + containerId + ' .page-btn').forEach(button => {
    button.onclick = () => {
      let next;
      if (button.dataset.p === 'prev') next = Math.max(1, current - 1);
      else if (button.dataset.p === 'next') next = Math.min(count, current + 1);
      else next = Number(button.dataset.p);
      if (next !== current) onSelect(next);
    };
  });
}

async function refreshSystemIndicator() {
  const markers = document.querySelectorAll('.online, .live-badge');
  if (!markers.length) return;
  try {
    const info = await iotApi.request('/api/system/status');
    const online = Boolean(info.mqttConnected && info.sensorOnline);
    markers.forEach(marker => {
      const label = marker.classList.contains('live-badge')
        ? (online ? 'LIVE' : 'OFFLINE')
        : (online ? 'System Online' : 'System Offline');
      marker.innerHTML = '<span class="dot"></span>' + label;
      marker.style.opacity = online ? '1' : '.65';
    });
  } catch {
    markers.forEach(marker => {
      marker.innerHTML = '<span class="dot"></span>Offline';
      marker.style.opacity = '.65';
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  refreshSystemIndicator();
  if (document.querySelector('.online, .live-badge')) setInterval(refreshSystemIndicator, 10000);
});
