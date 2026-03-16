/**
 * 3proxy Configuration Manager
 * Generates and manages 3proxy config based on detected devices
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const CONFIG_PATH = process.env.PROXY_CONFIG_PATH || '/etc/3proxy/3proxy.cfg';
const TEMPLATE_PATH = path.join(__dirname, '..', 'config', '3proxy.cfg.template');
const DEVICE_CONFIG_PATH = path.join(__dirname, '..', 'config', 'devices.json');
const PROXY_START_PORT = parseInt(process.env.PROXY_START_PORT) || 10000;

/**
 * Load saved per-device proxy configuration
 */
function loadDeviceConfigs() {
  try {
    if (fs.existsSync(DEVICE_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(DEVICE_CONFIG_PATH, 'utf-8'));
    }
  } catch (error) {
    console.error('Error loading device configs:', error.message);
  }
  return {};
}

/**
 * Save per-device proxy configuration
 */
function saveDeviceConfigs(configs) {
  fs.writeFileSync(DEVICE_CONFIG_PATH, JSON.stringify(configs, null, 2), 'utf-8');
}

/**
 * Get all proxy configurations
 */
function getConfig() {
  return loadDeviceConfigs();
}

/**
 * Update proxy config for a specific device/interface
 */
async function updateDeviceConfig(interfaceName, { port, username, password, type }) {
  const configs = loadDeviceConfigs();

  configs[interfaceName] = {
    ...configs[interfaceName],
    port: port || configs[interfaceName]?.port,
    username: username || configs[interfaceName]?.username || process.env.DEFAULT_PROXY_USER || 'proxyuser',
    password: password || configs[interfaceName]?.password || process.env.DEFAULT_PROXY_PASS || 'proxypass',
    type: type || configs[interfaceName]?.type || 'http', // http, socks5, both
    updatedAt: new Date().toISOString(),
  };

  saveDeviceConfigs(configs);
  return configs[interfaceName];
}

/**
 * Generate 3proxy.cfg from template + device list
 */
function generateConfig(devices) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const configs = loadDeviceConfigs();
  const proxyEntries = [];

  devices.forEach((device, index) => {
    if (device.status !== 'active' || !device.ip || device.ip === 'N/A') return;

    const iface = device.interfaceName;
    const deviceConfig = configs[iface] || {};
    const port = deviceConfig.port || (PROXY_START_PORT + index);
    const username = deviceConfig.username || process.env.DEFAULT_PROXY_USER || 'proxyuser';
    const password = deviceConfig.password || process.env.DEFAULT_PROXY_PASS || 'proxypass';
    const proxyType = deviceConfig.type || 'http';

    // Auth block for this device
    proxyEntries.push(`# ==== ${iface} (${device.ip}) ====`);
    proxyEntries.push(`flush`);
    proxyEntries.push(`users ${username}:CL:${password}`);
    proxyEntries.push(`auth strong`);
    proxyEntries.push(`allow ${username}`);

    // Set outgoing interface
    proxyEntries.push(`external ${device.ip}`);

    // Add proxy listener(s)
    if (proxyType === 'http' || proxyType === 'both') {
      proxyEntries.push(`proxy -n -p${port}`);
    }
    if (proxyType === 'socks5' || proxyType === 'both') {
      const socksPort = proxyType === 'both' ? port + 1000 : port;
      proxyEntries.push(`socks -n -p${socksPort}`);
    }

    proxyEntries.push('');

    // Auto-save port assignment back to config
    if (!configs[iface]) {
      configs[iface] = {
        port,
        username,
        password,
        type: proxyType,
        updatedAt: new Date().toISOString(),
      };
    }
  });

  saveDeviceConfigs(configs);

  // Replace placeholder in template
  const finalConfig = template.replace(
    '# {{PROXY_ENTRIES}}',
    proxyEntries.join('\n')
  );

  return finalConfig;
}

/**
 * Write config to file and reload 3proxy
 */
async function regenerateAndReload(devices) {
  if (!devices) {
    const dcomScanner = require('./dcom-scanner');
    devices = await dcomScanner.scanDevices();
  }

  const config = generateConfig(devices);

  // Write config file
  try {
    fs.writeFileSync(CONFIG_PATH, config, 'utf-8');
    console.log(`[proxy-manager] Config written to ${CONFIG_PATH}`);
  } catch (error) {
    // If permission denied, try with sudo
    const tmpPath = '/tmp/3proxy.cfg';
    fs.writeFileSync(tmpPath, config, 'utf-8');
    await execAsync(`sudo cp ${tmpPath} ${CONFIG_PATH}`);
    console.log(`[proxy-manager] Config written to ${CONFIG_PATH} (via sudo)`);
  }

  // Reload 3proxy
  try {
    await execAsync('sudo systemctl reload 3proxy 2>/dev/null || sudo systemctl restart 3proxy');
    console.log('[proxy-manager] 3proxy reloaded');
    return { success: true, message: '3proxy config applied and reloaded' };
  } catch (error) {
    console.error('[proxy-manager] Error reloading 3proxy:', error.message);
    // Try direct process signal
    try {
      await execAsync('sudo killall -HUP 3proxy');
      return { success: true, message: '3proxy config applied (HUP signal sent)' };
    } catch {
      return { success: false, message: 'Config written but 3proxy reload failed — may need manual restart' };
    }
  }
}

module.exports = {
  getConfig,
  updateDeviceConfig,
  generateConfig,
  regenerateAndReload,
};
