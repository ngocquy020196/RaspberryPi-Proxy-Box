/**
 * DCOM Proxy Box — Main Server
 * Express backend for managing USB Dcom 4G proxy devices
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const auth = require('./src/auth');
const dcomScanner = require('./src/dcom-scanner');
const proxyManager = require('./src/proxy-manager');
const ipRotator = require('./src/ip-rotator');

const app = express();
const PORT = process.env.PORT || 8080;

// ---- Middleware ----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ---- Static Files ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth Routes ----
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/check', auth.check);

// ---- Protected API Routes ----
app.use('/api', auth.requireAuth);

// Device scanning
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await dcomScanner.scanDevices();
    res.json({ success: true, devices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get system info
app.get('/api/system', async (req, res) => {
  try {
    const info = await dcomScanner.getSystemInfo();
    res.json({ success: true, info });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get proxy config for all devices
app.get('/api/proxy/config', (req, res) => {
  try {
    const config = proxyManager.getConfig();
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update proxy config for a specific device
app.post('/api/proxy/config', async (req, res) => {
  try {
    const { interfaceName, port, username, password, type } = req.body;
    await proxyManager.updateDeviceConfig(interfaceName, { port, username, password, type });
    await proxyManager.regenerateAndReload();
    res.json({ success: true, message: 'Proxy config updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Apply proxy config (regenerate 3proxy.cfg and reload)
app.post('/api/proxy/apply', async (req, res) => {
  try {
    const devices = await dcomScanner.scanDevices();
    const result = await proxyManager.regenerateAndReload(devices);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Connect a stick-mode modem via PPP
app.post('/api/ppp/connect/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index) || 0;
    const serialPort = req.body.serialPort || `/dev/ttyUSB${index * 2}`;
    const result = await dcomScanner.connectStickModem(serialPort, index);
    res.json({ success: result.success, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Disconnect a PPP interface
app.post('/api/ppp/disconnect/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index) || 0;
    const result = await dcomScanner.disconnectPPP(index);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-connect all disconnected stick modems
app.post('/api/ppp/connect-all', async (req, res) => {
  try {
    const devices = await dcomScanner.scanDevices();
    const results = [];
    let pppIndex = 0;

    for (const device of devices) {
      if (device.type === 'stick' && device.status === 'disconnected' && device.serialPort) {
        const result = await dcomScanner.connectStickModem(device.serialPort, pppIndex);
        results.push({ port: device.serialPort, ...result });
        pppIndex++;
      }
    }

    if (results.length === 0) {
      res.json({ success: true, message: 'No disconnected stick modems found' });
    } else {
      res.json({ success: true, results });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rotate IP for a specific device (auto-detect method)
app.post('/api/rotate/:interfaceName', async (req, res) => {
  try {
    const { interfaceName } = req.params;
    // Auto-detect method: PPP interfaces use 'interface', HiLink use 'hilink'
    let method = req.body.method || process.env.IP_ROTATE_METHOD || 'hilink';
    if (interfaceName.startsWith('ppp')) {
      method = 'interface'; // PPP always uses interface restart
    }
    const result = await ipRotator.rotateIP(interfaceName, method);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rotate IP for ALL devices
app.post('/api/rotate-all', async (req, res) => {
  try {
    const devices = await dcomScanner.scanDevices();
    const results = [];
    for (const device of devices) {
      if (device.status !== 'active') continue;
      try {
        let method = req.body.method || process.env.IP_ROTATE_METHOD || 'hilink';
        if (device.type === 'stick' || device.interfaceName.startsWith('ppp')) {
          method = 'interface';
        }
        const result = await ipRotator.rotateIP(device.interfaceName, method);
        results.push({ interface: device.interfaceName, ...result });
      } catch (err) {
        results.push({ interface: device.interfaceName, success: false, error: err.message });
      }
    }
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- SPA Fallback ----
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ---- Start Server ----
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 DCOM Proxy Box running at http://0.0.0.0:${PORT}`);
  console.log(`📡 Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Login with your SECRET_KEY from .env\n`);

  // Auto-connect stick modems on startup (after 5s delay)
  setTimeout(autoConnectModems, 5000);

  // Periodically check for new modems and auto-connect (every 30s)
  setInterval(autoConnectModems, 30000);
});

/**
 * Auto-connect disconnected stick modems
 * Runs on startup and every 30 seconds
 */
async function autoConnectModems() {
  try {
    const devices = await dcomScanner.scanDevices();
    let connected = 0;

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      if (device.type === 'stick' && device.status === 'disconnected' && device.serialPort) {
        console.log(`[auto-connect] Connecting ${device.serialPort} as ppp${i}...`);
        const result = await dcomScanner.connectStickModem(device.serialPort, i);
        if (result.success) {
          console.log(`[auto-connect] ✓ Connected ppp${i} → ${result.ip}`);
          connected++;
        } else {
          console.log(`[auto-connect] ✗ Failed ppp${i}: ${result.message || result.error}`);
        }
      }
    }

    // If any new connections, auto-apply 3proxy config
    if (connected > 0) {
      console.log(`[auto-connect] ${connected} modem(s) connected — applying 3proxy config...`);
      const updatedDevices = await dcomScanner.scanDevices();
      await proxyManager.regenerateAndReload(updatedDevices);
    }
  } catch (error) {
    console.error('[auto-connect] Error:', error.message);
  }
}

