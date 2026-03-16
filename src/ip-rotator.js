/**
 * IP Rotator
 * Handles IP rotation for USB Dcom devices
 * Supports: HiLink API, interface restart, AT commands, PPP reconnect
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const execAsync = promisify(exec);

/**
 * Rotate IP for a given network interface
 * @param {string} interfaceName - Network interface name (eth1, ppp0, etc.)
 * @param {string} method - Rotation method: 'hilink', 'interface', 'at_command', 'ppp'
 */
async function rotateIP(interfaceName, method = 'hilink') {
  // Auto-detect PPP interfaces
  if (interfaceName.startsWith('ppp')) {
    method = 'ppp';
  }

  console.log(`[ip-rotator] Rotating IP for ${interfaceName} using method: ${method}`);

  switch (method) {
    case 'hilink':
      return await rotateHiLink(interfaceName);
    case 'interface':
      return await rotateInterface(interfaceName);
    case 'at_command':
      return await rotateATCommand(interfaceName);
    case 'ppp':
      return await rotatePPP(interfaceName);
    default:
      throw new Error(`Unknown rotation method: ${method}`);
  }
}

/**
 * Method 1: HiLink API
 */
async function rotateHiLink(interfaceName) {
  const gatewayIP = await getGateway(interfaceName);
  if (!gatewayIP) throw new Error(`Cannot find gateway for ${interfaceName}`);

  try {
    const tokenResponse = await httpRequest(gatewayIP, '/api/webserver/SesTokInfo');
    const sessionMatch = tokenResponse.match(/<SesInfo>(.*?)<\/SesInfo>/);
    const tokenMatch = tokenResponse.match(/<TokInfo>(.*?)<\/TokInfo>/);
    const cookie = sessionMatch ? sessionMatch[1] : '';
    const token = tokenMatch ? tokenMatch[1] : '';

    await httpRequest(gatewayIP, '/api/dialup/mobile-dataswitch', 'POST',
      '<?xml version="1.0" encoding="UTF-8"?><request><dataswitch>0</dataswitch></request>',
      { 'Cookie': cookie, '__RequestVerificationToken': token }
    );

    await sleep(2000);

    const tokenResponse2 = await httpRequest(gatewayIP, '/api/webserver/SesTokInfo');
    const sessionMatch2 = tokenResponse2.match(/<SesInfo>(.*?)<\/SesInfo>/);
    const tokenMatch2 = tokenResponse2.match(/<TokInfo>(.*?)<\/TokInfo>/);
    const cookie2 = sessionMatch2 ? sessionMatch2[1] : '';
    const token2 = tokenMatch2 ? tokenMatch2[1] : '';

    await httpRequest(gatewayIP, '/api/dialup/mobile-dataswitch', 'POST',
      '<?xml version="1.0" encoding="UTF-8"?><request><dataswitch>1</dataswitch></request>',
      { 'Cookie': cookie2, '__RequestVerificationToken': token2 }
    );

    await sleep(5000);
    const newIP = await getInterfaceIP(interfaceName);

    return { success: true, method: 'hilink', interface: interfaceName, newIP: newIP || 'pending...', message: 'IP rotated via HiLink API' };
  } catch (error) {
    throw new Error(`HiLink rotation failed: ${error.message}`);
  }
}

/**
 * Method 2: Interface restart (HiLink USB ethernet)
 */
async function rotateInterface(interfaceName) {
  try {
    await execAsync(`sudo ip link set ${interfaceName} down`);
    await sleep(3000);
    await execAsync(`sudo ip link set ${interfaceName} up`);
    await sleep(5000);

    try {
      await execAsync(`sudo dhclient -r ${interfaceName} 2>/dev/null; sudo dhclient ${interfaceName} 2>/dev/null`);
    } catch {
      try { await execAsync(`sudo udhcpc -i ${interfaceName} 2>/dev/null`); } catch {}
    }

    await sleep(3000);
    const newIP = await getInterfaceIP(interfaceName);
    return { success: true, method: 'interface', interface: interfaceName, newIP: newIP || 'pending...', message: 'IP rotated via interface restart' };
  } catch (error) {
    throw new Error(`Interface rotation failed: ${error.message}`);
  }
}

/**
 * Method 3: AT Commands via serial port
 */
async function rotateATCommand(interfaceName) {
  try {
    const serialPort = await findSerialPort();
    if (!serialPort) throw new Error('No serial port found');

    await execAsync(`echo -e "AT+CFUN=0\\r" > ${serialPort}`);
    await sleep(3000);
    await execAsync(`echo -e "AT+CFUN=1\\r" > ${serialPort}`);
    await sleep(8000);

    const newIP = await getInterfaceIP(interfaceName);
    return { success: true, method: 'at_command', interface: interfaceName, newIP: newIP || 'pending...', message: 'IP rotated via AT commands' };
  } catch (error) {
    throw new Error(`AT command rotation failed: ${error.message}`);
  }
}

/**
 * Method 4: PPP reconnect (for stick-mode modems)
 * Kills pppd, waits for carrier release, then redials for new IP
 */
async function rotatePPP(interfaceName) {
  const pppIndex = parseInt(interfaceName.replace('ppp', '')) || 0;
  const peerName = `dcom${pppIndex}`;

  console.log(`[ip-rotator] PPP rotate: killing pppd for ${peerName}...`);

  const oldIP = await getInterfaceIP(interfaceName);

  try {
    // Kill pppd
    await execAsync(`sudo pkill -f "pppd.*${peerName}" 2>/dev/null`).catch(() => {});
    await execAsync('sudo pkill -f "pppd.*/dev/ttyUSB" 2>/dev/null').catch(() => {});
    await execAsync('sudo killall pppd 2>/dev/null').catch(() => {});

    // Wait for carrier to release the IP (important!)
    console.log('[ip-rotator] Waiting for carrier to release IP...');
    await sleep(8000);

    // Verify ppp is down
    const checkIP = await getInterfaceIP(interfaceName);
    if (checkIP) {
      console.log('[ip-rotator] PPP still up, force killing...');
      await execAsync('sudo killall -9 pppd 2>/dev/null').catch(() => {});
      await sleep(3000);
    }

    console.log(`[ip-rotator] Redialing ${peerName}...`);

    // Redial
    await execAsync(`sudo pppd call ${peerName} &>/var/log/ppp-${peerName}.log &`);

    // Wait for new IP
    let retries = 20;
    let newIP = null;
    while (retries > 0) {
      await sleep(2000);
      newIP = await getInterfaceIP(interfaceName);
      if (newIP) {
        if (newIP !== oldIP) {
          console.log(`[ip-rotator] PPP rotated: ${oldIP} → ${newIP}`);
        } else {
          console.log(`[ip-rotator] PPP reconnected with same IP: ${newIP}`);
        }

        // Update 3proxy config with new IP
        try {
          const proxyManager = require('./proxy-manager');
          const dcomScanner = require('./dcom-scanner');
          const devices = await dcomScanner.scanDevices();
          await proxyManager.regenerateAndReload(devices);
        } catch (e) {
          console.error('[ip-rotator] Failed to update 3proxy:', e.message);
        }

        return {
          success: true,
          method: 'ppp',
          interface: interfaceName,
          oldIP,
          newIP,
          message: newIP !== oldIP ? `IP rotated: ${oldIP} → ${newIP}` : `Reconnected (same IP: ${newIP})`
        };
      }
      retries--;
    }

    return { success: false, message: `PPP redial timed out — check /var/log/ppp-${peerName}.log` };
  } catch (error) {
    throw new Error(`PPP rotation failed: ${error.message}`);
  }
}

// ---- Helpers ----

async function findSerialPort() {
  try {
    const { stdout } = await execAsync('ls /dev/ttyUSB* 2>/dev/null');
    const ports = stdout.trim().split('\n').filter(p => p);
    return ports.length > 0 ? ports[0] : null;
  } catch { return null; }
}

async function getGateway(interfaceName) {
  try {
    const { stdout } = await execAsync(`ip route show dev ${interfaceName} 2>/dev/null | grep default | awk '{print $3}'`);
    const gw = stdout.trim();
    if (gw) return gw;
    const { stdout: ipOut } = await execAsync(`ip -4 addr show ${interfaceName} 2>/dev/null | grep -oP 'inet \\K[\\d.]+'`);
    const ip = ipOut.trim();
    if (ip) { const p = ip.split('.'); p[3] = '1'; return p.join('.'); }
    return null;
  } catch { return null; }
}

async function getInterfaceIP(interfaceName) {
  try {
    const { stdout } = await execAsync(`ip -4 addr show ${interfaceName} 2>/dev/null | grep -oP 'inet \\K[\\d.]+'`);
    return stdout.trim() || null;
  } catch { return null; }
}

function httpRequest(host, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host, port: 80, path, method, timeout: 10000,
      headers: { 'Content-Type': 'application/xml', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { rotateIP };
