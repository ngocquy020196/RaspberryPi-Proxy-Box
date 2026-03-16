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
    await proxyManager.regenerateAndReload(devices);
    res.json({ success: true, message: '3proxy config applied' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rotate IP for a specific device
app.post('/api/rotate/:interfaceName', async (req, res) => {
  try {
    const { interfaceName } = req.params;
    const method = req.body.method || process.env.IP_ROTATE_METHOD || 'hilink';
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
    const method = req.body.method || process.env.IP_ROTATE_METHOD || 'hilink';
    const results = [];
    for (const device of devices) {
      try {
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
});
