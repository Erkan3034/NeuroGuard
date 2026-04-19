/**
 * ═══════════════════════════════════════════════════════════
 * NEUROGUARD — App Controller
 * PC Yönetim & Tehdit Tespit Sistemi
 * ═══════════════════════════════════════════════════════════
 */

// ─── Configuration ───
const CONFIG = {
  API_BASE: 'http://localhost:8777',
  POLL_INTERVAL: 3000,
  NETWORK_HISTORY_SIZE: 60,
  GAUGE_CIRCUMFERENCE: 314.16,  // 2 * PI * 50
  MAX_TABLE_ROWS: 500,
};

// ─── State ───
const state = {
  stats: null,
  processes: [],
  threats: [],
  startups: [],
  actionLog: [],
  largeFiles: null,
  sysInfo: null,
  connections: [],
  networkHistory: { sent: [], recv: [] },
  sortField: 'memMB',
  sortDirection: 'desc',
  fileSortField: 'sizeMB',
  fileSortDirection: 'desc',
  fileFilter: 'all',
  fileSearchQuery: '',
  processFilter: 'all',
  searchQuery: '',
  connected: false,
  pollTimer: null,
  modalCallback: null,
};

// ═══════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initNetworkChart();
  startPolling();
  fetchSysInfo();
  fetchLargeFiles();
  updateClock();
  setInterval(updateClock, 1000);

  // Hide loading screen after first data
  setTimeout(() => {
    document.getElementById('loadingScreen').classList.add('hidden');
  }, 2000);
});

// ─── Clock ───
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('headerTime').textContent = timeStr;
}

// ═══════════════════════════════════════════
// DATA POLLING
// ═══════════════════════════════════════════
function startPolling() {
  fetchAll();
  state.pollTimer = setInterval(fetchAll, CONFIG.POLL_INTERVAL);
}

async function fetchAll() {
  try {
    const [statsRes, procsRes, threatsRes, startupRes, logRes, connRes] = await Promise.all([
      fetch(`${CONFIG.API_BASE}/api/stats`).then(r => r.json()).catch(() => null),
      fetch(`${CONFIG.API_BASE}/api/processes`).then(r => r.json()).catch(() => []),
      fetch(`${CONFIG.API_BASE}/api/threats`).then(r => r.json()).catch(() => []),
      fetch(`${CONFIG.API_BASE}/api/startup`).then(r => r.json()).catch(() => []),
      fetch(`${CONFIG.API_BASE}/api/actionlog`).then(r => r.json()).catch(() => []),
      fetch(`${CONFIG.API_BASE}/api/connections`).then(r => r.json()).catch(() => []),
    ]);

    setConnected(true);

    if (statsRes && !statsRes.error) {
      state.stats = statsRes;
      renderStats(statsRes);
    }

    if (Array.isArray(procsRes)) {
      state.processes = procsRes;
      renderProcesses();
    }

    if (Array.isArray(threatsRes)) {
      state.threats = threatsRes;
      renderThreats();
    }

    if (Array.isArray(startupRes)) {
      state.startups = startupRes;
      renderStartups();
    }

    if (Array.isArray(logRes)) {
      state.actionLog = logRes;
      renderActionLog();
    }

    if (Array.isArray(connRes)) {
      state.connections = connRes;
      renderConnections();
    }

    // Hide loading screen
    document.getElementById('loadingScreen').classList.add('hidden');

  } catch (err) {
    setConnected(false);
    console.warn('NeuroGuard: Veri çekme hatası', err);
  }
}

async function fetchSysInfo() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/sysinfo`);
    const data = await res.json();
    if (data && !data.error) {
      state.sysInfo = data;
      renderSysInfo();
    }
  } catch (e) { console.warn('SysInfo fetch error', e); }
}

async function fetchLargeFiles() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/largefiles`);
    const data = await res.json();
    if (data && !data.error) {
      state.largeFiles = data;
      renderDiskAnalysis();
    }
  } catch (e) { console.warn('LargeFiles fetch error', e); }
}

function refreshAll() {
  fetchAll();
  showToast('Veriler yenileniyor...', 'info');
}

function setConnected(isConnected) {
  state.connected = isConnected;
  const led = document.getElementById('connectionLed');
  const text = document.getElementById('connectionText');
  if (isConnected) {
    led.classList.remove('offline');
    text.textContent = 'Bağlı';
  } else {
    led.classList.add('offline');
    text.textContent = 'Bağlantı Yok';
  }
}

// ═══════════════════════════════════════════
// RENDER: STATS & GAUGES
// ═══════════════════════════════════════════
function renderStats(stats) {
  // Health score
  const healthEl = document.getElementById('healthScore');
  healthEl.textContent = stats.healthScore;
  healthEl.className = 'header__health-value';
  if (stats.healthScore < 30) healthEl.classList.add('critical');
  else if (stats.healthScore < 50) healthEl.classList.add('danger');
  else if (stats.healthScore < 70) healthEl.classList.add('warning');

  // System bar
  if (stats.uptime) {
    document.getElementById('uptime').textContent =
      `${stats.uptime.days}g ${stats.uptime.hours}s ${stats.uptime.minutes}d`;
  }
  document.getElementById('processCount').textContent = stats.processCount || '--';

  const threatCountEl = document.getElementById('threatCount');
  threatCountEl.textContent = stats.threatCount || 0;
  threatCountEl.style.color = stats.threatCount > 0 ? 'var(--orange-warn)' : 'var(--green-safe)';
  if (stats.threatCount > 5) threatCountEl.style.color = 'var(--red-danger)';

  if (stats.memory) {
    document.getElementById('ramSummary').textContent =
      `${stats.memory.usedGB.toFixed(1)} / ${stats.memory.totalGB.toFixed(1)} GB`;
  }

  document.getElementById('lastUpdate').textContent = stats.timestamp ? stats.timestamp.split(' ')[1] : '--';

  // CPU Gauge
  updateGauge('cpuGauge', 'cpuValue', 'cpuCard', stats.cpu?.percent || 0);
  document.getElementById('cpuDetail').textContent = `İşlemci Kullanımı`;

  // RAM Gauge
  const ramPct = stats.memory?.percent || 0;
  updateGauge('ramGauge', 'ramValue', 'ramCard', ramPct);
  document.getElementById('ramDetail').textContent =
    `${stats.memory?.usedGB?.toFixed(1) || 0} / ${stats.memory?.totalGB?.toFixed(1) || 0} GB`;

  // Disk Gauge
  const diskPct = stats.disks?.[0]?.percent || 0;
  updateGauge('diskGauge', 'diskValue', 'diskCard', diskPct);
  const diskInfo = stats.disks?.[0];
  if (diskInfo) {
    document.getElementById('diskDetail').textContent =
      `${diskInfo.drive} ${diskInfo.usedGB?.toFixed(0)}/${diskInfo.totalGB?.toFixed(0)} GB`;
  }

  // Network
  const sent = stats.network?.totalSentKBps || 0;
  const recv = stats.network?.totalRecvKBps || 0;
  document.getElementById('netSent').textContent = sent.toFixed(1);
  document.getElementById('netRecv').textContent = recv.toFixed(1);

  // Network history
  state.networkHistory.sent.push(sent);
  state.networkHistory.recv.push(recv);
  if (state.networkHistory.sent.length > CONFIG.NETWORK_HISTORY_SIZE) {
    state.networkHistory.sent.shift();
    state.networkHistory.recv.shift();
  }
  drawNetworkChart();

  // Badge counts
  document.getElementById('procBadge').textContent = stats.processCount || 0;
  document.getElementById('threatBadge').textContent = stats.threatCount || 0;
  if (stats.connectionCount !== undefined) {
    document.getElementById('connectionCount').textContent = stats.connectionCount;
    document.getElementById('connBadge').textContent = stats.connectionCount;
  }
}

function updateGauge(gaugeId, valueId, cardId, percent) {
  const gauge = document.getElementById(gaugeId);
  const valueEl = document.getElementById(valueId);
  const card = document.getElementById(cardId);

  const offset = CONFIG.GAUGE_CIRCUMFERENCE - (percent / 100) * CONFIG.GAUGE_CIRCUMFERENCE;
  gauge.style.strokeDashoffset = offset;

  valueEl.textContent = Math.round(percent);

  // Color states
  gauge.className = 'gauge-fill';
  card.className = 'gauge-card';
  if (percent >= 90) {
    gauge.classList.add('danger');
    card.classList.add('danger');
  } else if (percent >= 70) {
    gauge.classList.add('warning');
    card.classList.add('warning');
  }
}

// ═══════════════════════════════════════════
// NETWORK CHART (Canvas)
// ═══════════════════════════════════════════
let networkCanvas, networkCtx;

function initNetworkChart() {
  networkCanvas = document.getElementById('networkChart');
  networkCtx = networkCanvas.getContext('2d');
  resizeNetworkChart();
  window.addEventListener('resize', resizeNetworkChart);
}

function resizeNetworkChart() {
  const wrapper = networkCanvas.parentElement;
  networkCanvas.width = wrapper.clientWidth * window.devicePixelRatio;
  networkCanvas.height = wrapper.clientHeight * window.devicePixelRatio;
  networkCanvas.style.width = wrapper.clientWidth + 'px';
  networkCanvas.style.height = wrapper.clientHeight + 'px';
  networkCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawNetworkChart() {
  const w = networkCanvas.clientWidth;
  const h = networkCanvas.clientHeight;
  const ctx = networkCtx;

  ctx.clearRect(0, 0, w * 2, h * 2);
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

  const sentData = state.networkHistory.sent;
  const recvData = state.networkHistory.recv;
  if (sentData.length < 2) return;

  const maxVal = Math.max(
    Math.max(...sentData, ...recvData, 10),
    10
  );
  const padding = 4;
  const drawW = w - padding * 2;
  const drawH = h - padding * 2;
  const step = drawW / (CONFIG.NETWORK_HISTORY_SIZE - 1);

  // Grid lines
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) {
    const y = padding + (drawH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  // Draw recv (cyan fill)
  drawArea(ctx, recvData, step, drawH, padding, maxVal, 'rgba(0, 240, 255, 0.15)', 'rgba(0, 240, 255, 0.6)', w);

  // Draw sent (green fill)
  drawArea(ctx, sentData, step, drawH, padding, maxVal, 'rgba(0, 230, 118, 0.1)', 'rgba(0, 230, 118, 0.5)', w);
}

function drawArea(ctx, data, step, drawH, padding, maxVal, fillColor, strokeColor, w) {
  const startIdx = CONFIG.NETWORK_HISTORY_SIZE - data.length;

  // Fill
  ctx.beginPath();
  ctx.moveTo(padding + startIdx * step, padding + drawH);
  for (let i = 0; i < data.length; i++) {
    const x = padding + (startIdx + i) * step;
    const y = padding + drawH - (data[i] / maxVal) * drawH;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(padding + (startIdx + data.length - 1) * step, padding + drawH);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Stroke
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = padding + (startIdx + i) * step;
    const y = padding + drawH - (data[i] / maxVal) * drawH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ═══════════════════════════════════════════
// RENDER: PROCESS TABLE
// ═══════════════════════════════════════════
function renderProcesses() {
  let procs = [...state.processes];

  // Filter
  if (state.processFilter === 'high-cpu') {
    procs = procs.filter(p => p.cpuSeconds > 100);
  } else if (state.processFilter === 'high-mem') {
    procs = procs.filter(p => p.memMB > 100);
  } else if (state.processFilter === 'suspicious') {
    const threatPids = new Set(state.threats.map(t => t.pid));
    procs = procs.filter(p => threatPids.has(p.pid));
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    procs = procs.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      String(p.pid).includes(q) ||
      p.path?.toLowerCase().includes(q) ||
      p.company?.toLowerCase().includes(q)
    );
  }

  // Sort
  procs.sort((a, b) => {
    let aVal = a[state.sortField];
    let bVal = b[state.sortField];
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal === undefined || aVal === null) aVal = '';
    if (bVal === undefined || bVal === null) bVal = '';
    if (aVal < bVal) return state.sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return state.sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Limit
  procs = procs.slice(0, CONFIG.MAX_TABLE_ROWS);

  // Build threat PID set for highlighting
  const threatMap = {};
  state.threats.forEach(t => { threatMap[t.pid] = t.risk; });

  const tbody = document.getElementById('processRows');
  const fragment = document.createDocumentFragment();

  procs.forEach(p => {
    const tr = document.createElement('tr');
    const risk = threatMap[p.pid];
    if (risk === 'critical' || risk === 'high') tr.classList.add('dangerous');
    else if (risk === 'medium' || risk === 'low') tr.classList.add('suspicious');

    // CPU class
    let cpuClass = '';
    if (p.cpuSeconds > 500) cpuClass = 'cpu-critical';
    else if (p.cpuSeconds > 100) cpuClass = 'cpu-high';

    // MEM class
    let memClass = '';
    if (p.memMB > 500) memClass = 'mem-critical';
    else if (p.memMB > 200) memClass = 'mem-high';

    // Status
    const statusText = p.responding === false ? '⚠ Yanıt Yok' : '● Çalışıyor';
    const statusColor = p.responding === false ? 'color:var(--red-danger)' : 'color:var(--green-dim)';

    tr.innerHTML = `
      <td class="pid">${p.pid}</td>
      <td class="name" title="${escapeHtml(p.path || p.name)}">${escapeHtml(p.name)}</td>
      <td class="${cpuClass}">${p.cpuSeconds?.toFixed(1) || '0.0'}</td>
      <td class="${memClass}">${p.memMB?.toFixed(1) || '0.0'}</td>
      <td style="${statusColor};font-size:0.72rem">${statusText}</td>
      <td style="color:var(--text-muted);font-size:0.7rem" title="${escapeHtml(p.company || '')}">${escapeHtml(truncate(p.company || '-', 20))}</td>
      <td style="color:var(--text-muted)">${p.threads || 0}</td>
      <td>
        <div class="action-btns">
          <button class="btn-kill" onclick="requestAction('kill', '${escapeAttr(p.name)}', 'PID: ${p.pid}', ${p.pid})" title="Sonlandır">⊘</button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);

  // Update sort indicators
  document.querySelectorAll('#processTable th').forEach(th => {
    th.classList.remove('sorted');
    if (th.dataset.sort === state.sortField) {
      th.classList.add('sorted');
      th.querySelector('.sort-arrow').textContent = state.sortDirection === 'asc' ? '▲' : '▼';
    }
  });
}

function sortProcesses(field) {
  if (state.sortField === field) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortField = field;
    state.sortDirection = 'desc';
  }
  renderProcesses();
}

function filterProcesses() {
  state.searchQuery = document.getElementById('processSearch').value;
  renderProcesses();
}

function setProcessFilter(filter, btn) {
  state.processFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProcesses();
}

// ═══════════════════════════════════════════
// RENDER: THREATS
// ═══════════════════════════════════════════
function renderThreats() {
  const container = document.getElementById('threatList');
  const threats = state.threats;

  document.getElementById('threatBadge').textContent = threats.length;
  document.getElementById('threatSectionCount').textContent = `${threats.length} tehdit tespit edildi`;

  if (!threats || threats.length === 0) {
    container.innerHTML = `
      <div class="no-threats">
        <div class="no-threats__icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--green-safe)" stroke-width="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <polyline points="9 12 11 14 15 10"/>
          </svg>
        </div>
        <div class="no-threats__text">Sistem Güvenli</div>
        <div class="no-threats__sub">Şu anda tespit edilen bir tehdit bulunmuyor.</div>
      </div>
    `;
    return;
  }

  const html = threats.map(t => {
    const riskLabel = {
      critical: 'KRİTİK',
      high: 'YÜKSEK',
      medium: 'ORTA',
      low: 'DÜŞÜK'
    }[t.risk] || 'BİLİNMİYOR';

    const reasonsHtml = (t.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');

    return `
      <div class="threat-card risk-${t.risk}">
        <div>
          <span class="threat-badge ${t.risk}">${riskLabel}</span>
        </div>
        <div class="threat-info">
          <div class="threat-info__name">${escapeHtml(t.name)}</div>
          <div class="threat-info__pid">PID: ${t.pid} · RAM: ${t.memMB?.toFixed(1)} MB · CPU: ${t.cpuSec?.toFixed(1)}s</div>
          <ul class="threat-info__reasons">${reasonsHtml}</ul>
          <div class="threat-info__meta">${escapeHtml(t.path || 'Yol bilgisi yok')}</div>
        </div>
        <div class="threat-action">
          <button class="btn-threat-kill" onclick="requestAction('kill', '${escapeAttr(t.name)}', 'PID: ${t.pid}', ${t.pid})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            Sonlandır
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// RENDER: STARTUP
// ═══════════════════════════════════════════
function renderStartups() {
  const container = document.getElementById('startupList');
  const startups = state.startups;

  document.getElementById('startupBadge').textContent = startups.length;
  document.getElementById('startupSectionCount').textContent = `${startups.length} program`;

  if (!startups || startups.length === 0) {
    container.innerHTML = '<div class="no-actions">Başlangıç programı bulunamadı.</div>';
    return;
  }

  const html = startups.map(s => `
    <div class="startup-item">
      <div class="startup-status ${s.enabled ? '' : 'disabled'}"></div>
      <div class="startup-info">
        <div class="startup-info__name">${escapeHtml(s.name)}</div>
        <div class="startup-info__location">${escapeHtml(s.location)}</div>
        <div class="startup-info__command" title="${escapeAttr(s.command)}">${escapeHtml(s.command)}</div>
      </div>
      ${s.enabled ? `
        <button class="btn-startup disable" onclick="requestAction('disable_startup', '${escapeAttr(s.name)}', '${escapeAttr(s.location)}')">
          Devre Dışı Bırak
        </button>
      ` : `
        <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted)">Devre Dışı</span>
      `}
    </div>
  `).join('');

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// RENDER: ACTION LOG
// ═══════════════════════════════════════════
function renderActionLog() {
  const container = document.getElementById('actionLog');
  const log = state.actionLog;

  if (!log || log.length === 0) {
    container.innerHTML = '<div class="no-actions">Henüz bir işlem gerçekleştirilmedi. Tüm işlemler burada loglanacak.</div>';
    return;
  }

  const html = log.map(entry => `
    <div class="action-log-item">
      <span class="action-log-item__time">${escapeHtml(entry.timestamp)}</span>
      <span class="action-log-item__action">${escapeHtml(entry.action)}</span>
      <span class="action-log-item__target">${escapeHtml(entry.target)}</span>
      <span class="action-log-item__status ${entry.success ? 'success' : 'fail'}">
        ${entry.success ? 'BAŞARILI' : 'BAŞARISIZ'}
      </span>
    </div>
  `).join('');

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// TAB NAVIGATION
// ═══════════════════════════════════════════
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${tabId}`);
  });
  // Lazy load large files and sysinfo
  if (tabId === 'diskanalysis' && !state.largeFiles) fetchLargeFiles();
  if (tabId === 'sysinfo' && !state.sysInfo) fetchSysInfo();
}

// ═══════════════════════════════════════════
// MODAL & ACTIONS
// ═══════════════════════════════════════════
function requestAction(type, name, detail, pid, extra) {
  const overlay = document.getElementById('modalOverlay');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  const icon = document.getElementById('modalIcon');
  const confirmBtn = document.getElementById('modalConfirm');

  let actionTitle = '';
  let actionBody = '';
  let iconChar = '⚠';
  let warningText = '';

  switch (type) {
    case 'kill':
      actionTitle = 'Süreç Sonlandırma Onayı';
      iconChar = '⊘';
      actionBody = `
        <strong>${escapeHtml(name)}</strong> sürecini sonlandırmak istediğinize emin misiniz?
        <span class="modal__target">${escapeHtml(name)} — ${escapeHtml(detail)}</span>
        <span class="modal__warning">⚠ Bu işlem geri alınamaz. İlgili uygulama kapanacaktır.</span>
      `;
      break;
    case 'suspend':
      actionTitle = 'Süreç Durdurma Onayı';
      iconChar = '⏸';
      actionBody = `
        <strong>${escapeHtml(name)}</strong> sürecini askıya almak istediğinize emin misiniz?
        <span class="modal__target">${escapeHtml(name)} — ${escapeHtml(detail)}</span>
      `;
      break;
    case 'disable_startup':
      actionTitle = 'Başlangıç Programı Devre Dışı Bırakma';
      iconChar = '⏻';
      actionBody = `
        <strong>${escapeHtml(name)}</strong> başlangıç programını devre dışı bırakmak istediğinize emin misiniz?
        <span class="modal__target">${escapeHtml(name)} — ${escapeHtml(detail)}</span>
        <span class="modal__warning">⚠ Bu program bilgisayar yeniden başlatıldığında otomatik olarak çalışmayacaktır.</span>
      `;
      break;
    case 'clean_temp':
      actionTitle = 'Geçici Dosya Temizleme';
      iconChar = '🗑';
      actionBody = `
        Geçici dosyaları temizlemek istediğinize emin misiniz?
        <span class="modal__target">TEMP klasörü temizlenecek</span>
        <span class="modal__warning">⚠ Bazı uygulamaların geçici verileri silinecektir.</span>
      `;
      break;
    case 'open_location':
      actionTitle = 'Dosya Konumunu Aç';
      iconChar = '📂';
      actionBody = `
        <strong>${escapeHtml(name)}</strong> dosyasının konumu Explorer'da açılsın mı?
        <span class="modal__target">${escapeHtml(detail)}</span>
      `;
      break;
    case 'delete_file':
      actionTitle = 'Dosya Silme Onayı';
      iconChar = '🗑';
      actionBody = `
        <strong>${escapeHtml(name)}</strong> dosyasını kalıcı olarak silmek istediğinize emin misiniz?
        <span class="modal__target">${escapeHtml(detail)}</span>
        <span class="modal__warning">⚠ Bu işlem geri alınamaz! Dosya kalıcı olarak silinecektir.</span>
      `;
      break;
  }

  title.textContent = actionTitle;
  body.innerHTML = actionBody;
  icon.textContent = iconChar;
  overlay.classList.add('active');

  state.modalCallback = () => executeAction(type, name, detail, pid, extra);
  confirmBtn.onclick = () => {
    if (state.modalCallback) state.modalCallback();
    closeModal();
  };
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  state.modalCallback = null;
}

// Close modal on overlay click
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

async function executeAction(type, name, detail, pid, extra) {
  try {
    const payload = { type, name, pid };
    if (type === 'disable_startup') {
      payload.location = detail;
    }
    if (type === 'open_location') {
      payload.filePath = extra?.filePath;
      payload.directory = extra?.directory;
    }
    if (type === 'delete_file') {
      payload.filePath = extra?.filePath;
    }

    const res = await fetch(`${CONFIG.API_BASE}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await res.json();

    if (result.success) {
      showToast(result.message, 'success');
      // Refresh large files after delete
      if (type === 'delete_file') setTimeout(fetchLargeFiles, 1000);
    } else {
      showToast(result.message || 'İşlem başarısız.', 'error');
    }

    // Refresh data after action
    setTimeout(fetchAll, 1000);

  } catch (err) {
    showToast('Sunucuyla bağlantı kurulamadı.', 'error');
    console.error('Action error:', err);
  }
}

// ═══════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ═══════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

// ═══════════════════════════════════════════
// RENDER: DISK ANALYSIS (Large Files)
// ═══════════════════════════════════════════
const CATEGORY_ICONS = {
  Video: '🎬', Ses: '🎵', Gorsel: '🖼', Arsiv: '📦',
  'Disk Imaji': '💿', Program: '⚙', Sistem: '🔧',
  'Log/Metin': '📝', Belge: '📄', Unity: '🎮',
  Android: '📱', Diger: '📁'
};

const CATEGORY_COLORS = {
  Video: '#bf7fff', Ses: '#00cfff', Gorsel: '#ffb347', Arsiv: '#ffd600',
  'Disk Imaji': '#ff2d55', Program: '#00e676', Sistem: '#aaa',
  'Log/Metin': '#888', Belge: '#56a0ff', Unity: '#00f0ff',
  Android: '#a2cf50', Diger: '#666'
};

function renderDiskAnalysis() {
  const data = state.largeFiles;
  if (!data) return;

  // Scan time
  const scanEl = document.getElementById('diskAnalysisScanTime');
  scanEl.textContent = `${data.totalFiles} dosya · ${data.totalSizeGB} GB · Tarama: ${data.scanTime || '--'}`;

  // Category cards
  const catContainer = document.getElementById('diskCategories');
  if (data.categories && data.categories.length > 0) {
    const maxCatMB = Math.max(...data.categories.map(c => c.totalMB));
    catContainer.innerHTML = data.categories.map(cat => {
      const icon = CATEGORY_ICONS[cat.category] || '📁';
      const color = CATEGORY_COLORS[cat.category] || '#666';
      const barWidth = maxCatMB > 0 ? (cat.totalMB / maxCatMB * 100) : 0;
      const sizeDisplay = cat.totalGB >= 1 ? `${cat.totalGB} <span class="disk-cat-card__unit">GB</span>` : `${cat.totalMB} <span class="disk-cat-card__unit">MB</span>`;
      return `
        <div class="disk-cat-card" onclick="setFileFilter('${cat.category}', this)">
          <div class="disk-cat-card__icon">${icon}</div>
          <div class="disk-cat-card__name">${cat.category}</div>
          <div class="disk-cat-card__size">${sizeDisplay}</div>
          <div class="disk-cat-card__count">${cat.count} dosya</div>
          <div class="disk-cat-card__bar">
            <div class="disk-cat-card__bar-fill" style="width:${barWidth}%;background:${color}"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // File table
  renderFileTable();
}

function renderFileTable() {
  const data = state.largeFiles;
  if (!data || !data.files) return;

  let files = [...data.files];

  // Category filter
  if (state.fileFilter !== 'all') {
    files = files.filter(f => f.category === state.fileFilter);
  }

  // Search
  if (state.fileSearchQuery) {
    const q = state.fileSearchQuery.toLowerCase();
    files = files.filter(f =>
      f.name?.toLowerCase().includes(q) ||
      f.extension?.toLowerCase().includes(q) ||
      f.category?.toLowerCase().includes(q) ||
      f.directory?.toLowerCase().includes(q)
    );
  }

  // Sort
  files.sort((a, b) => {
    let aVal = a[state.fileSortField];
    let bVal = b[state.fileSortField];
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return state.fileSortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return state.fileSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('fileRows');
  const fragment = document.createDocumentFragment();

  files.forEach(f => {
    const tr = document.createElement('tr');
    const sizeClass = f.sizeMB > 1000 ? 'file-size-huge' : (f.sizeMB > 500 ? 'file-size-large' : '');
    const sizeDisplay = f.sizeGB >= 1 ? `${f.sizeGB.toFixed(2)} GB` : `${f.sizeMB.toFixed(1)} MB`;
    const catClass = f.category.replace(/[\s\/]/g, '');
    const safePath = escapeAttr(f.path || '');
    const safeDir = escapeAttr(f.directory || '');

    tr.innerHTML = `
      <td class="name" title="${escapeAttr(f.path)}">${escapeHtml(f.name)}</td>
      <td class="${sizeClass}">${sizeDisplay}</td>
      <td><span class="category-badge cat-${catClass}">${f.category}</span></td>
      <td style="color:var(--text-muted);font-size:0.72rem">${f.lastModified || '--'}</td>
      <td class="file-path-cell" title="${escapeAttr(f.directory)}">${escapeHtml(truncate(f.directory || '', 40))}</td>
      <td>
        <div class="file-actions">
          <button class="btn-open-folder" onclick="requestAction('open_location', '${escapeAttr(f.name)}', '${safeDir}', null, {filePath: '${safePath}'})" title="Dosya konumunu aç">📂 Aç</button>
          <button class="btn-delete-file" onclick="requestAction('delete_file', '${escapeAttr(f.name)}', '${safePath}', null, {filePath: '${safePath}'})" title="Dosyayı sil">🗑 Sil</button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);

  // Sort indicators
  document.querySelectorAll('#fileTable th').forEach(th => {
    th.classList.remove('sorted');
    if (th.dataset.filesort === state.fileSortField) {
      th.classList.add('sorted');
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = state.fileSortDirection === 'asc' ? '▲' : '▼';
    }
  });
}

function sortFiles(field) {
  if (state.fileSortField === field) {
    state.fileSortDirection = state.fileSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.fileSortField = field;
    state.fileSortDirection = field === 'sizeMB' ? 'desc' : 'asc';
  }
  renderFileTable();
}

function filterFiles() {
  state.fileSearchQuery = document.getElementById('fileSearch').value;
  renderFileTable();
}

function setFileFilter(filter, btn) {
  state.fileFilter = filter;
  // Update filter buttons
  document.querySelectorAll('[data-filefilter]').forEach(b => b.classList.remove('active'));
  if (btn && btn.dataset && btn.dataset.filefilter) {
    btn.classList.add('active');
  } else {
    // Category card clicked
    const matchBtn = document.querySelector(`[data-filefilter="${filter}"]`);
    if (matchBtn) matchBtn.classList.add('active');
    else {
      // Reset to 'Tümü' if no matching filter button
      const allBtn = document.querySelector('[data-filefilter="all"]');
      if (allBtn) allBtn.classList.add('active');
    }
  }
  renderFileTable();
}

// ═══════════════════════════════════════════
// RENDER: SYSTEM INFO
// ═══════════════════════════════════════════
function renderSysInfo() {
  const info = state.sysInfo;
  if (!info) return;

  const container = document.getElementById('sysinfoGrid');
  let html = '';

  // OS Card
  html += `
    <div class="sysinfo-card">
      <div class="sysinfo-card__header">
        <span class="sysinfo-card__icon">💻</span>
        <span class="sysinfo-card__title">İşletim Sistemi</span>
      </div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">OS</span><span class="sysinfo-row__value">${escapeHtml(info.os || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Bilgisayar Adı</span><span class="sysinfo-row__value">${escapeHtml(info.computerName || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Kullanıcı</span><span class="sysinfo-row__value">${escapeHtml(info.userName || '--')}</span></div>
    </div>
  `;

  // CPU Card
  html += `
    <div class="sysinfo-card">
      <div class="sysinfo-card__header">
        <span class="sysinfo-card__icon">🧠</span>
        <span class="sysinfo-card__title">İşlemci (CPU)</span>
      </div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Model</span><span class="sysinfo-row__value">${escapeHtml(info.cpuName || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Çekirdek</span><span class="sysinfo-row__value">${info.cpuCores || '--'} Çekirdek / ${info.cpuThreads || '--'} Thread</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Maks. Frekans</span><span class="sysinfo-row__value">${info.cpuMaxMHz ? (info.cpuMaxMHz / 1000).toFixed(2) + ' GHz' : '--'}</span></div>
    </div>
  `;

  // GPU Card
  html += `
    <div class="sysinfo-card">
      <div class="sysinfo-card__header">
        <span class="sysinfo-card__icon">🎮</span>
        <span class="sysinfo-card__title">Ekran Kartı (GPU)</span>
      </div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Model</span><span class="sysinfo-row__value">${escapeHtml(info.gpuName || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Sürücü</span><span class="sysinfo-row__value">${escapeHtml(info.gpuDriverVersion || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Bellek</span><span class="sysinfo-row__value">${info.gpuRAM_MB ? (info.gpuRAM_MB / 1024).toFixed(1) + ' GB' : '--'}</span></div>
    </div>
  `;

  // RAM Card
  let ramSlotsHtml = '';
  if (info.ramSlots && info.ramSlots.length > 0) {
    ramSlotsHtml = info.ramSlots.map((slot, i) => `
      <div class="ram-slot">
        <div class="ram-slot__header">Slot ${i + 1}</div>
        <div class="sysinfo-row"><span class="sysinfo-row__label">Kapasite</span><span class="sysinfo-row__value">${(slot.sizeMB / 1024).toFixed(0)} GB</span></div>
        <div class="sysinfo-row"><span class="sysinfo-row__label">Hız</span><span class="sysinfo-row__value">${slot.speed || '--'} MHz</span></div>
        <div class="sysinfo-row"><span class="sysinfo-row__label">Tür</span><span class="sysinfo-row__value">${slot.type || '--'}</span></div>
        <div class="sysinfo-row"><span class="sysinfo-row__label">Üretici</span><span class="sysinfo-row__value">${escapeHtml(slot.manufacturer || '--')}</span></div>
      </div>
    `).join('');
  }

  html += `
    <div class="sysinfo-card">
      <div class="sysinfo-card__header">
        <span class="sysinfo-card__icon">🧩</span>
        <span class="sysinfo-card__title">Bellek (RAM)</span>
      </div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Toplam Slot</span><span class="sysinfo-row__value">${info.ramTotalSlots || '--'}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Kullanılan Slot</span><span class="sysinfo-row__value">${info.ramSlots?.length || '--'}</span></div>
      ${ramSlotsHtml}
    </div>
  `;

  // Motherboard Card
  html += `
    <div class="sysinfo-card">
      <div class="sysinfo-card__header">
        <span class="sysinfo-card__icon">🔌</span>
        <span class="sysinfo-card__title">Anakart & BIOS</span>
      </div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">Anakart</span><span class="sysinfo-row__value">${escapeHtml(info.motherboard || '--')}</span></div>
      <div class="sysinfo-row"><span class="sysinfo-row__label">BIOS</span><span class="sysinfo-row__value">${escapeHtml(info.biosVersion || '--')}</span></div>
    </div>
  `;

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// RENDER: NETWORK CONNECTIONS
// ═══════════════════════════════════════════
function renderConnections() {
  const conns = state.connections;
  document.getElementById('connSectionCount').textContent = `${conns.length} bağlantı`;
  document.getElementById('connBadge').textContent = conns.length;

  const tbody = document.getElementById('connectionRows');
  const fragment = document.createDocumentFragment();

  conns.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name">${escapeHtml(c.processName || '--')}</td>
      <td class="pid">${c.pid}</td>
      <td style="color:var(--text-muted);font-size:0.72rem">${escapeHtml(c.localAddress)}</td>
      <td>${c.localPort}</td>
      <td style="color:var(--cyan-dim);font-size:0.72rem">${escapeHtml(c.remoteAddress)}</td>
      <td>${c.remotePort}</td>
      <td style="color:var(--green-safe);font-size:0.72rem">${escapeHtml(c.state)}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}
