/**
 * Dashboard — Frontend Logic
 * Manages device table, stats, config modal, IP rotation
 */

(function () {
  // ---- Auth Guard ----
  fetch('/api/auth/check')
    .then(r => r.json())
    .then(data => {
      if (!data.authenticated) window.location.href = '/';
    })
    .catch(() => { window.location.href = '/'; });

  // ---- DOM References ----
  const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    logoutBtn: document.getElementById('logoutBtn'),
    refreshBtn: null,
    rotateAllBtn: document.getElementById('rotateAllBtn'),
    stopAllBtn: document.getElementById('stopAllBtn'),
    applyProxyBtn: null,
    deviceTableBody: document.getElementById('deviceTableBody'),
    totalDevices: document.getElementById('totalDevices'),
    activeDevices: document.getElementById('activeDevices'),
    totalProxies: document.getElementById('totalProxies'),
    issueDevices: document.getElementById('issueDevices'),
    hostname: document.getElementById('hostname'),
    uptime: document.getElementById('uptime'),
    cpuTemp: document.getElementById('cpuTemp'),
    memUsage: document.getElementById('memUsage'),
    connectInfo: document.getElementById('connectInfo'),
    toastContainer: document.getElementById('toastContainer'),
    // Modal
    configModal: document.getElementById('configModal'),
    configForm: document.getElementById('configForm'),
    modalDeviceName: document.getElementById('modalDeviceName'),
    modalClose: document.getElementById('modalClose'),
    modalCancelBtn: document.getElementById('modalCancelBtn'),
    configInterface: document.getElementById('configInterface'),
    configPort: document.getElementById('configPort'),
    configUser: document.getElementById('configUser'),
    configPass: document.getElementById('configPass'),
    configType: document.getElementById('configType'),
  };

  let devices = [];
  let proxyConfig = {};
  let refreshInterval = null;

  // ---- Initialize ----
  init();

  async function init() {
    setupEventListeners();
    await Promise.all([loadDevices(), loadSystemInfo(), loadProxyConfig(), loadApiKey()]);
    renderApiReference();
    startAutoRefresh();
  }

  function setupEventListeners() {
    // Sidebar toggle (mobile)
    elements.sidebarToggle.addEventListener('click', () => {
      elements.sidebar.classList.toggle('open');
    });

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768 &&
          elements.sidebar.classList.contains('open') &&
          !elements.sidebar.contains(e.target) &&
          e.target !== elements.sidebarToggle) {
        elements.sidebar.classList.remove('open');
      }
    });

    // Logout
    elements.logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });



    // Rotate all
    elements.rotateAllBtn.addEventListener('click', rotateAllIPs);

    // Stop all
    elements.stopAllBtn.addEventListener('click', stopAll);



    // Modal
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalCancelBtn.addEventListener('click', closeModal);
    elements.configModal.addEventListener('click', (e) => {
      if (e.target === elements.configModal) closeModal();
    });

    // Config form submit
    elements.configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveDeviceConfig();
    });
  }

  // ---- State ----
  let ddnsDomain = '';
  let apiKey = '';

  // ---- API Helper with 401 redirect ----

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
      window.location.href = '/';
      return null;
    }
    return res;
  }

  // ---- API Calls ----

  async function loadDevices() {
    try {
      const res = await apiFetch('/api/devices');
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        devices = data.devices;
        renderDevices();
        updateStats();
      }
    } catch (error) {
      console.error('Failed to load devices:', error);
    }
  }


  async function loadSystemInfo() {
    try {
      const res = await apiFetch('/api/system');
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        elements.hostname.textContent = data.info.hostname;
        elements.uptime.textContent = data.info.uptime;
        elements.cpuTemp.textContent = data.info.cpuTemp;
        elements.memUsage.textContent = data.info.memory;
        ddnsDomain = data.info.ddnsDomain || '';
      }
    } catch (error) {
      console.error('Failed to load system info:', error);
    }
  }

  async function loadProxyConfig() {
    try {
      const res = await apiFetch('/api/proxy/config');
      if (!res) return;
      const data = await res.json();
      if (data.success) {
        proxyConfig = data.config;
      }
    } catch (error) {
      console.error('Failed to load proxy config:', error);
    }
  }

  // ---- Render ----

  function renderDevices() {
    if (devices.length === 0) {
      elements.deviceTableBody.innerHTML = `
        <tr>
            <td colspan="9" class="empty-state">
            <div class="empty-content">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <p>No devices detected. Plug in a USB Dcom.</p>
            </div>
          </td>
        </tr>`;
      updateConnectInfo(null);
      return;
    }

    elements.deviceTableBody.innerHTML = devices.map((device, index) => {
      const config = proxyConfig[device.interfaceName] || {};
      const port = config.port || (10000 + index);
      const user = config.username || 'proxyuser';
      const pass = config.password || 'proxypass';
      const realPass = config.password || 'proxypass';
      const proxyHost = ddnsDomain || window.location.hostname;
      const proxyString = `${user}:${realPass}@${proxyHost}:${port}`;
      const statusClass = getStatusClass(device.status);
      const statusLabel = getStatusLabel(device.status);

      return `
        <tr data-interface="${device.interfaceName}">
          <td>${index + 1}</td>
          <td><strong>${device.interfaceName}</strong><br><small class="text-muted">${device.type || ''}</small></td>
          <td class="ip-cell"><small>${device.macAddress || 'N/A'}</small></td>
          <td class="ip-cell">${device.ip}</td>
          <td class="ip-cell">${device.localIP || device.ip}</td>
          <td class="port-cell">${port}</td>
          <td class="auth-cell"><span class="proxy-string" title="${proxyString}">${user}:${realPass}</span></td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td>
            <div class="action-group">
              ${device.status === 'disconnected' && device.type === 'stick' ? `
              <button class="btn btn-sm btn-accent connect-btn" data-index="${index}" data-port="${device.serialPort || ''}" title="Connect PPP">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>` : ''}
              ${device.status === 'active' && device.type === 'stick' ? `
              <button class="btn btn-sm btn-danger stop-btn" data-index="${index}" title="Stop PPP">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              </button>` : ''}
              <button class="btn btn-sm btn-accent rotate-btn" data-interface="${device.interfaceName}" title="Rotate IP" ${device.status !== 'active' ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              </button>
              <button class="btn btn-sm btn-outline config-btn" data-interface="${device.interfaceName}" data-port="${port}" data-user="${user}" data-pass="${config.password || ''}" data-type="${config.type || 'http'}" title="Configure">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09"/></svg>
              </button>
              <button class="btn btn-sm btn-outline copy-btn" data-proxy="${proxyString}" title="Copy proxy string">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Attach event listeners
    document.querySelectorAll('.rotate-btn').forEach(btn => {
      btn.addEventListener('click', () => rotateIP(btn.dataset.interface));
    });

    document.querySelectorAll('.config-btn').forEach(btn => {
      btn.addEventListener('click', () => openConfigModal(btn));
    });

    document.querySelectorAll('.connect-btn').forEach(btn => {
      btn.addEventListener('click', () => connectPPP(btn.dataset.index, btn.dataset.port));
    });

    document.querySelectorAll('.stop-btn').forEach(btn => {
      btn.addEventListener('click', () => stopPPP(btn.dataset.index));
    });

    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => copyProxy(btn));
    });

    // Show connect info for first active device
    const firstActive = devices.find(d => d.status === 'active');
    updateConnectInfo(firstActive);
  }

  function updateStats() {
    const total = devices.length;
    const active = devices.filter(d => d.status === 'active').length;
    const issues = devices.filter(d => d.status !== 'active').length;

    elements.totalDevices.textContent = total;
    elements.activeDevices.textContent = active;
    elements.totalProxies.textContent = active;
    elements.issueDevices.textContent = issues;
  }

  function updateConnectInfo(device) {
    if (!device) {
      elements.connectInfo.innerHTML = '<p class="text-muted">No active devices. Plug in a USB Dcom to see connection details.</p>';
      return;
    }

    const config = proxyConfig[device.interfaceName] || {};
    const port = config.port || 10000;
    const user = config.username || 'proxyuser';
    const pass = config.password || 'proxypass';
    const proxyHost = ddnsDomain || window.location.hostname;

    elements.connectInfo.innerHTML = `
      <p style="margin-bottom: 12px; color: var(--text-secondary); font-weight: 600;">Quick Connect — Proxy Settings</p>
      <div class="connect-example">
        <div><strong style="color: var(--primary);">📡 Proxy (curl)</strong></div>
        <div>curl -x http://${user}:${pass}@${proxyHost}:${port} https://api.ipify.org</div>
        <br>
        <div><strong style="color: var(--text-secondary);">⚙️ SwitchyOmega / Browser Proxy</strong></div>
        <div>Host: ${proxyHost} &nbsp; Port: ${port} &nbsp; User: ${user} &nbsp; Pass: ${pass}</div>
      </div>
    `;
  }

  async function loadApiKey() {
    try {
      const res = await apiFetch('/api/key');
      if (!res) return;
      const data = await res.json();
      if (data.success) apiKey = data.key;
    } catch {}
  }

  function renderApiReference() {
    const el = document.getElementById('apiReference');
    if (!el) return;

    const baseUrl = window.location.origin;
    const sampleMac = devices.length > 0 ? (devices[0].macAddress || 'MAC_ID') : 'MAC_ID';
    const maskedKey = apiKey ? apiKey.substring(0, 6) + '...' : 'YOUR_KEY';

    el.innerHTML = `
      <div style="margin-bottom: 10px;">
        <strong style="color: var(--text-secondary);">🔑 API Key:</strong>
        <code id="apiKeyDisplay" style="background: var(--bg-tertiary); padding: 2px 8px; border-radius: 4px; cursor: pointer;" title="Click to copy">${maskedKey}</code>
        <button class="btn btn-sm btn-outline" id="showApiKeyBtn" style="margin-left: 6px; font-size: 11px;">Show</button>
        <button class="btn btn-sm btn-accent" id="copyApiKeyBtn" style="margin-left: 4px; font-size: 11px;">Copy</button>
      </div>
      <div class="connect-example" style="font-size: 13px;">
        <div><strong style="color: var(--primary);">📋 List all devices</strong></div>
        <div>GET ${baseUrl}/ext/api/devices?key=API_KEY</div>
        <br>
        <div><strong style="color: var(--primary);">🔍 Get device by MAC</strong></div>
        <div>GET ${baseUrl}/ext/api/device/${encodeURIComponent(sampleMac)}?key=API_KEY</div>
        <br>
        <div><strong style="color: var(--primary);">🔄 Rotate IP by MAC</strong></div>
        <div>POST ${baseUrl}/ext/api/rotate/${encodeURIComponent(sampleMac)}?key=API_KEY</div>
        <br>
        <div><strong style="color: var(--text-secondary);">💡 curl example</strong></div>
        <div>curl -H "x-api-key: API_KEY" ${baseUrl}/ext/api/devices</div>
      </div>
    `;

    // Show/Copy API key handlers
    document.getElementById('showApiKeyBtn')?.addEventListener('click', () => {
      const display = document.getElementById('apiKeyDisplay');
      if (display.textContent === maskedKey) {
        display.textContent = apiKey;
      } else {
        display.textContent = maskedKey;
      }
    });

    document.getElementById('copyApiKeyBtn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(apiKey).then(() => {
        const btn = document.getElementById('copyApiKeyBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1500);
      });
    });
  }

  function getStatusClass(status) {
    switch (status) {
      case 'active': return 'status-active';
      case 'no-ip': return 'status-noip';
      case 'storage-mode': return 'status-storage';
      case 'rotating': return 'status-rotating';
      case 'disconnected': return 'status-noip';
      default: return 'status-noip';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'active': return 'Active';
      case 'no-ip': return 'No IP';
      case 'storage-mode': return 'Storage Mode';
      case 'rotating': return 'Rotating...';
      case 'disconnected': return 'Disconnected';
      default: return status;
    }
  }

  // ---- IP Rotation ----

  async function rotateIP(interfaceName) {
    const row = document.querySelector(`tr[data-interface="${interfaceName}"]`);
    const badge = row?.querySelector('.status-badge');
    const btn = row?.querySelector('.rotate-btn');

    if (badge) {
      badge.className = 'status-badge status-rotating';
      badge.textContent = 'Rotating...';
    }
    if (btn) btn.disabled = true;

    showToast(`Rotating IP for ${interfaceName}...`, 'info');

    try {
      const res = await fetch(`/api/rotate/${interfaceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success) {
        showToast(`${interfaceName}: New IP → ${data.result.newIP || 'pending'}`, 'success');
      } else {
        showToast(`Failed: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error rotating ${interfaceName}: ${error.message}`, 'error');
    }

    // Refresh after rotation
    setTimeout(() => loadDevices(), 2000);
  }

  function copyProxy(btn) {
    const proxyStr = btn.dataset.proxy;
    
    function onSuccess() {
      showToast(`Copied: ${proxyStr}`, 'success');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = originalHTML; }, 1500);
    }

    // Try textarea fallback first (works on HTTP)
    const textarea = document.createElement('textarea');
    textarea.value = proxyStr;
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) { onSuccess(); return; }
    } catch { document.body.removeChild(textarea); }

    // Fallback: clipboard API (only works on HTTPS/localhost)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(proxyStr).then(onSuccess).catch(() => {
        showToast(`Proxy: ${proxyStr}`, 'info');
      });
    } else {
      showToast(`Proxy: ${proxyStr}`, 'info');
    }
  }

  async function connectPPP(index, serialPort) {
    showToast(`Connecting PPP ${index}...`, 'info');
    try {
      const res = await fetch(`/api/ppp/connect/${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialPort }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Connected! IP: ${data.ip}`, 'success');
      } else {
        showToast(`PPP failed: ${data.message || data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
    setTimeout(() => loadDevices(), 3000);
  }

  async function stopPPP(index) {
    showToast(`Stopping PPP ${index}...`, 'info');
    try {
      const res = await fetch(`/api/ppp/disconnect/${index}`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('PPP disconnected', 'success');
      } else {
        showToast('Failed to stop PPP', 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
    setTimeout(() => loadDevices(), 2000);
  }

  async function stopAll() {
    showToast('Stopping all connections...', 'info');
    try {
      const res = await fetch('/api/ppp/disconnect-all', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'All stopped', data.success ? 'success' : 'error');
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
    setTimeout(() => loadDevices(), 2000);
  }

  async function rotateAllIPs() {
    showToast('Rotating all IPs...', 'info');
    elements.rotateAllBtn.disabled = true;

    try {
      const res = await fetch('/api/rotate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (data.success) {
        const successCount = data.results.filter(r => r.success).length;
        showToast(`Rotated ${successCount}/${data.results.length} devices`, 'success');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }

    elements.rotateAllBtn.disabled = false;
    setTimeout(() => loadDevices(), 3000);
  }

  // ---- Proxy Config ----

  function openConfigModal(btn) {
    elements.configInterface.value = btn.dataset.interface;
    elements.modalDeviceName.textContent = btn.dataset.interface;
    elements.configPort.value = btn.dataset.port;
    elements.configUser.value = btn.dataset.user;
    elements.configPass.value = btn.dataset.pass;
    elements.configType.value = btn.dataset.type;
    elements.configModal.style.display = 'flex';
  }

  function closeModal() {
    elements.configModal.style.display = 'none';
  }

  async function saveDeviceConfig() {
    const formData = {
      interfaceName: elements.configInterface.value,
      port: parseInt(elements.configPort.value),
      username: elements.configUser.value,
      password: elements.configPass.value,
      type: elements.configType.value,
    };

    try {
      const res = await fetch('/api/proxy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Config saved for ${formData.interfaceName}`, 'success');
        closeModal();
        await loadProxyConfig();
        renderDevices();
      } else {
        showToast(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }
  }

  async function applyProxyConfig() {
    showToast('Applying proxy config...', 'info');
    elements.applyProxyBtn.disabled = true;

    try {
      const res = await fetch('/api/proxy/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (data.success) {
        showToast('3proxy config applied!', 'success');
      } else {
        showToast(`Error: ${data.error}`, 'error');
      }
    } catch (error) {
      showToast(`Error: ${error.message}`, 'error');
    }

    elements.applyProxyBtn.disabled = false;
  }

  // ---- Auto Refresh ----

  function startAutoRefresh() {
    refreshInterval = setInterval(() => {
      loadDevices();
      loadSystemInfo();
    }, 15000); // Every 15 seconds
  }

  // ---- Toast Notifications ----

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
    elements.toastContainer.appendChild(toast);

    // Auto remove
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }
})();
