/**
 * IP Rotator
 * Handles IP rotation for USB Dcom devices (Vodafone K5160 / Huawei E3372)
 * Supports: HiLink API, interface restart, AT commands
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const execAsync = promisify(exec);

/**
 * Rotate IP for a given network interface
 * @param {string} interfaceName - Network interface name (eth1, usb0, etc.)
 * @param {string} method - Rotation method: 'hilink', 'interface', 'at_command'
 */
async function rotateIP(interfaceName, method = 'hilink') {
  console.log(`[ip-rotator] Rotating IP for ${interfaceName} using method: ${method}`);

  switch (method) {
    case 'hilink':
      return await rotateHiLink(interfaceName);
    case 'interface':
      return await rotateInterface(interfaceName);
    case 'at_command':
      return await rotateATCommand(interfaceName);
    default:
      throw new Error(`Unknown rotation method: ${method}`);
  }
}

/**
 * Method 1: HiLink API
 * For Huawei modems in HiLink mode (default for K5160)
 * Sends reconnect request to the modem's web interface
 */
async function rotateHiLink(interfaceName) {
  const gatewayIP = await getGateway(interfaceName);
  if (!gatewayIP) {
    throw new Error(`Cannot find gateway for ${interfaceName}`);
  }

  try {
    // Step 1: Get session token
    const tokenResponse = await httpRequest(gatewayIP, '/api/webserver/SesTokInfo');
    const sessionMatch = tokenResponse.match(/<SesInfo>(.*?)<\/SesInfo>/);
    const tokenMatch = tokenResponse.match(/<TokInfo>(.*?)<\/TokInfo>/);

    const cookie = sessionMatch ? sessionMatch[1] : '';
    const token = tokenMatch ? tokenMatch[1] : '';

    // Step 2: Send reconnect (disconnect then connect)
    // Disconnect
    await httpRequest(gatewayIP, '/api/dialup/mobile-dataswitch', 'POST', 
      '<?xml version="1.0" encoding="UTF-8"?><request><dataswitch>0</dataswitch></request>',
      { 'Cookie': cookie, '__RequestVerificationToken': token }
    );

    // Wait 2 seconds
    await sleep(2000);

    // Get fresh token
    const tokenResponse2 = await httpRequest(gatewayIP, '/api/webserver/SesTokInfo');
    const sessionMatch2 = tokenResponse2.match(/<SesInfo>(.*?)<\/SesInfo>/);
    const tokenMatch2 = tokenResponse2.match(/<TokInfo>(.*?)<\/TokInfo>/);
    const cookie2 = sessionMatch2 ? sessionMatch2[1] : '';
    const token2 = tokenMatch2 ? tokenMatch2[1] : '';

    // Reconnect
    await httpRequest(gatewayIP, '/api/dialup/mobile-dataswitch', 'POST',
      '<?xml version="1.0" encoding="UTF-8"?><request><dataswitch>1</dataswitch></request>',
      { 'Cookie': cookie2, '__RequestVerificationToken': token2 }
    );

    // Wait for reconnection
    await sleep(5000);

    // Get new IP
    const newIP = await getInterfaceIP(interfaceName);

    return {
      success: true,
      method: 'hilink',
      interface: interfaceName,
      newIP: newIP || 'pending...',
      message: 'IP rotated via HiLink API'
    };
  } catch (error) {
    throw new Error(`HiLink rotation failed for ${interfaceName}: ${error.message}`);
  }
}

/**
 * Method 2: Interface restart
 * Bring interface down and up to force DHCP renewal
 */
async function rotateInterface(interfaceName) {
  try {
    // Bring interface down
    await execAsync(`sudo ip link set ${interfaceName} down`);
    await sleep(3000);

    // Bring interface up
    await execAsync(`sudo ip link set ${interfaceName} up`);
    await sleep(5000);

    // Request new DHCP lease
    try {
      await execAsync(`sudo dhclient -r ${interfaceName} 2>/dev/null; sudo dhclient ${interfaceName} 2>/dev/null`);
    } catch {
      // dhclient may not be available, try udhcpc
      try {
        await execAsync(`sudo udhcpc -i ${interfaceName} 2>/dev/null`);
      } catch {
        // Ignore — some modems auto-assign IP
      }
    }

    await sleep(3000);
    const newIP = await getInterfaceIP(interfaceName);

    return {
      success: true,
      method: 'interface',
      interface: interfaceName,
      newIP: newIP || 'pending...',
      message: 'IP rotated via interface restart'
    };
  } catch (error) {
    throw new Error(`Interface rotation failed for ${interfaceName}: ${error.message}`);
  }
}

/**
 * Method 3: AT Commands via serial port
 * Send AT+CFUN=0 (radio off) then AT+CFUN=1 (radio on)
 */
async function rotateATCommand(interfaceName) {
  try {
    // Find the serial port for this modem
    const serialPort = await findSerialPort(interfaceName);
    if (!serialPort) {
      throw new Error('No serial port found for this modem');
    }

    // Disable radio
    await execAsync(`echo -e "AT+CFUN=0\\r" > ${serialPort}`);
    await sleep(3000);

    // Enable radio  
    await execAsync(`echo -e "AT+CFUN=1\\r" > ${serialPort}`);
    await sleep(8000);

    const newIP = await getInterfaceIP(interfaceName);

    return {
      success: true,
      method: 'at_command',
      interface: interfaceName,
      newIP: newIP || 'pending...',
      message: 'IP rotated via AT commands'
    };
  } catch (error) {
    throw new Error(`AT command rotation failed for ${interfaceName}: ${error.message}`);
  }
}

// ---- Helper Functions ----

/**
 * Find serial port associated with a USB modem
 */
async function findSerialPort(interfaceName) {
  try {
    // List available ttyUSB ports
    const { stdout } = await execAsync('ls /dev/ttyUSB* 2>/dev/null');
    const ports = stdout.trim().split('\n').filter(p => p);

    // Typically ttyUSB0 is the AT command port
    // For multiple modems, we need to map interface to serial port
    if (ports.length > 0) {
      return ports[0]; // Simple fallback — TODO: better mapping
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get default gateway for an interface
 */
async function getGateway(interfaceName) {
  try {
    const { stdout } = await execAsync(
      `ip route show dev ${interfaceName} 2>/dev/null | grep default | awk '{print $3}'`
    );
    const gw = stdout.trim();
    if (gw) return gw;

    // For HiLink modems, gateway is typically 192.168.x.1
    const { stdout: ipOut } = await execAsync(
      `ip -4 addr show ${interfaceName} 2>/dev/null | grep -oP 'inet \\K[\\d.]+'`
    );
    const ip = ipOut.trim();
    if (ip) {
      const parts = ip.split('.');
      parts[3] = '1';
      return parts.join('.');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current IP of interface
 */
async function getInterfaceIP(interfaceName) {
  try {
    const { stdout } = await execAsync(
      `ip -4 addr show ${interfaceName} 2>/dev/null | grep -oP 'inet \\K[\\d.]+'`
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Make HTTP request to modem's HiLink API
 */
function httpRequest(host, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: 80,
      path,
      method,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/xml',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { rotateIP };
