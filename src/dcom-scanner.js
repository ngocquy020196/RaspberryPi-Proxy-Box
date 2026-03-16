/**
 * USB Dcom Scanner
 * Detects connected USB Dcom devices and maps them to network interfaces
 * Supports both HiLink mode (USB ethernet) and Stick mode (serial/PPP)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const http = require('http');
const https = require('https');

// Huawei USB Vendor ID
const HUAWEI_VENDOR_ID = '12d1';

// Known Huawei modem product IDs
const HUAWEI_MODEM_PRODUCTS = {
  // HiLink mode (USB ethernet — plug and play)
  '1506': { name: 'Huawei E3372 (HiLink)', mode: 'hilink' },
  '1c05': { name: 'Huawei E3372h (HiLink)', mode: 'hilink' },
  '1f01': { name: 'Huawei E3372h-320 (HiLink)', mode: 'hilink' },
  // Stick mode (serial port — needs PPP/wvdial)
  '1001': { name: 'Huawei E1550/E169/E620 (Stick)', mode: 'stick' },
  '1003': { name: 'Huawei E220 (Stick)', mode: 'stick' },
  '1406': { name: 'Huawei E1750 (Stick)', mode: 'stick' },
  '14dc': { name: 'Huawei E3372 (Stick)', mode: 'stick' },
  '1436': { name: 'Huawei E173 (Stick)', mode: 'stick' },
  '1465': { name: 'Huawei K3765 (Stick)', mode: 'stick' },
  // Storage/CD-ROM mode (needs usb_modeswitch)
  '14fe': { name: 'Huawei K5160 (CD-ROM)', mode: 'storage' },
  '1446': { name: 'Huawei E1752 (CD-ROM)', mode: 'storage' },
  '1f01': { name: 'Huawei E3372 (CD-ROM)', mode: 'storage' },
};

/**
 * Get unique device ID for a network interface
 * For HiLink: MAC address from sysfs
 * For Stick/PPP: USB serial from ttyUSB sysfs → IMEI via AT → bus path
 */
async function getDeviceID(interfaceName, atPort) {
  // 1. Real MAC address (works for HiLink/USB ethernet)
  try {
    const { stdout } = await execAsync(`cat /sys/class/net/${interfaceName}/address 2>/dev/null`);
    const mac = stdout.trim();
    if (mac && mac !== '00:00:00:00:00:00') return mac;
  } catch {}

  // 2. USB serial number via ttyUSB sysfs (most reliable for stick modems)
  if (atPort) {
    try {
      const portName = atPort.replace('/dev/', '');
      const { stdout } = await execAsync(
        `udevadm info -a /dev/${portName} 2>/dev/null | grep '{serial}' | head -1 | grep -oP '"[^"]+"' | tr -d '"'`
      );
      const serial = stdout.trim();
      // Skip default/placeholder serials (not unique across devices)
      const isDefault = /^[0-9A-F]{16}$/i.test(serial) || serial === '0123456789ABCDEF';
      if (serial && serial.length > 3 && !isDefault) return serial;
    } catch {}
  }

  // 3. IMEI via AT command (try multiple baud rates)
  if (atPort) {
    for (const baud of [9600, 115200]) {
      try {
        const { stdout } = await execAsync(
          `(echo -e "AT+CGSN\\r"; sleep 1) | socat - ${atPort},b${baud},raw,echo=0,crnl 2>/dev/null`,
          { timeout: 5000 }
        );
        const imeiMatch = stdout.match(/(\d{15})/);
        if (imeiMatch) return `IMEI:${imeiMatch[1]}`;
      } catch {}
    }
  }

  // 4. USB bus port path from ttyUSB (stable per physical port)
  if (atPort) {
    try {
      const portName = atPort.replace('/dev/', '');
      const { stdout } = await execAsync(
        `udevadm info -q path /dev/${portName} 2>/dev/null | grep -oP 'usb\\d+/[\\d.-]+' | head -1`
      );
      const busPath = stdout.trim();
      if (busPath) return `USB:${busPath}`;
    } catch {}
  }

  return 'N/A';
}

/**
 * Scan for connected USB Dcom devices
 * Returns array of device objects with interface & IP info
 */
async function scanDevices() {
  const usbDevices = await detectUSBModems();
  const devices = [];

  // --- HiLink devices: find USB ethernet interfaces ---
  const networkInterfaces = await getModemInterfaces();
  for (const iface of networkInterfaces) {
    const ipInfo = await getInterfaceIP(iface);
    const gatewayIP = await getGatewayIP(iface);
    const mac = await getDeviceID(iface);

    devices.push({
      interfaceName: iface,
      ip: ipInfo.ip || 'N/A',
      subnet: ipInfo.subnet || 'N/A',
      gateway: gatewayIP || 'N/A',
      macAddress: mac,
      status: ipInfo.ip ? 'active' : 'no-ip',
      type: 'hilink',
    });
  }

  // --- Stick mode devices: find serial ports and PPP interfaces ---
  const stickModems = usbDevices.filter(u => u.mode === 'stick');
  if (stickModems.length > 0) {
    const serialPorts = await getSerialPorts();
    const pppInterfaces = await getPPPInterfaces();

    // Group serial ports (each modem typically has 2-3 ports)
    // Port 0 = modem/PPP, Port 1 = AT commands, Port 2 = diagnostic
    const modemGroups = groupSerialPorts(serialPorts);

    for (let i = 0; i < modemGroups.length; i++) {
      const group = modemGroups[i];
      const pppIface = pppInterfaces[i] || null;
      const modemInfo = stickModems[i] || stickModems[0];

      if (pppIface) {
        const ipInfo = await getInterfaceIP(pppIface);
        const publicIP = ipInfo.ip ? await getPublicIP(pppIface) : null;
        const mac = await getDeviceID(pppIface, group.atPort);
        devices.push({
          interfaceName: pppIface,
          ip: publicIP || ipInfo.ip || 'N/A',
          localIP: ipInfo.ip || 'N/A',
          subnet: ipInfo.subnet || 'N/A',
          gateway: 'peer',
          macAddress: mac,
          status: ipInfo.ip ? 'active' : 'no-ip',
          type: 'stick',
          serialPort: group.modemPort,
          atPort: group.atPort,
          usbInfo: modemInfo,
        });
      } else {
        devices.push({
          interfaceName: `ppp${i}`,
          ip: 'N/A',
          subnet: 'N/A',
          gateway: 'N/A',
          macAddress: 'N/A',
          status: 'disconnected',
          type: 'stick',
          serialPort: group.modemPort,
          atPort: group.atPort,
          usbInfo: modemInfo,
          message: `Stick modem on ${group.modemPort} — needs PPP dial`,
        });
      }
    }
  }

  // --- Storage mode devices: need usb_modeswitch ---
  for (const usb of usbDevices) {
    if (usb.mode === 'storage') {
      devices.push({
        interfaceName: 'N/A',
        ip: 'N/A',
        subnet: 'N/A',
        gateway: 'N/A',
        macAddress: 'N/A',
        status: 'storage-mode',
        type: 'usb-storage',
        usbInfo: usb,
        message: 'Device in CD-ROM mode — needs usb_modeswitch',
      });
    }
  }

  console.log(`[dcom-scanner] Found ${devices.length} device(s): ${devices.map(d => `${d.interfaceName}(${d.type}:${d.status})`).join(', ') || 'none'}`);

  return devices;
}

/**
 * Detect Huawei USB modems via lsusb
 */
async function detectUSBModems() {
  try {
    const { stdout } = await execAsync('lsusb');
    const lines = stdout.trim().split('\n');
    const modems = [];

    for (const line of lines) {
      const match = line.match(/ID\s+(\w{4}):(\w{4})/);
      if (match) {
        const [, vendor, product] = match;
        if (vendor === HUAWEI_VENDOR_ID) {
          const info = HUAWEI_MODEM_PRODUCTS[product] || { name: `Huawei Unknown (${product})`, mode: 'unknown' };
          modems.push({
            vendor,
            product,
            name: info.name,
            mode: info.mode,
            raw: line.trim(),
          });
          console.log(`[dcom-scanner] USB modem found: ${info.name} (${vendor}:${product}) — mode: ${info.mode}`);
        }
      }
    }

    if (modems.length === 0) {
      console.log('[dcom-scanner] No Huawei USB modems found');
    }

    return modems;
  } catch (error) {
    console.error('Error scanning USB devices:', error.message);
    return [];
  }
}

/**
 * Get serial ports for USB modems
 */
async function getSerialPorts() {
  try {
    const { stdout } = await execAsync('ls /dev/ttyUSB* 2>/dev/null');
    return stdout.trim().split('\n').filter(p => p);
  } catch {
    return [];
  }
}

/**
 * Group serial ports by modem (each modem creates 2-3 ttyUSB ports)
 */
function groupSerialPorts(ports) {
  if (ports.length === 0) return [];

  // Simple grouping: every 2-3 consecutive ports = 1 modem
  // ttyUSB0 = modem (PPP), ttyUSB1 = AT commands
  // ttyUSB2 = modem 2, ttyUSB3 = AT commands 2, etc.
  const groups = [];
  const portsPerModem = ports.length >= 4 ? Math.ceil(ports.length / Math.ceil(ports.length / 3)) : ports.length;
  
  for (let i = 0; i < ports.length; i += Math.max(2, portsPerModem)) {
    groups.push({
      modemPort: ports[i],                    // First port = PPP dial
      atPort: ports[i + 1] || ports[i],       // Second port = AT commands
      diagPort: ports[i + 2] || null,         // Third port = diagnostic (optional)
    });
  }

  return groups;
}

/**
 * Get active PPP interfaces
 */
async function getPPPInterfaces() {
  try {
    const { stdout } = await execAsync("ip -o link show | grep ppp | awk -F': ' '{print $2}'");
    return stdout.trim().split('\n').filter(i => i);
  } catch {
    return [];
  }
}

/**
 * Get modem-related network interfaces (for HiLink mode)
 */
async function getModemInterfaces() {
  try {
    // Method 1: Find USB network interfaces via sysfs
    let usbInterfaces = [];
    try {
      const { stdout: sysfsOut } = await execAsync(
        "ls -d /sys/class/net/*/device/driver 2>/dev/null | cut -d'/' -f5"
      );
      const sysfsIfaces = sysfsOut.trim().split('\n').filter(i => i);

      for (const iface of sysfsIfaces) {
        try {
          const { stdout: devPath } = await execAsync(
            `readlink -f /sys/class/net/${iface}/device 2>/dev/null`
          );
          if (devPath.includes('/usb')) {
            usbInterfaces.push(iface);
          }
        } catch {}
      }
    } catch {}

    // Method 2: Pattern matching
    const { stdout } = await execAsync("ip -o link show | awk -F': ' '{print $2}'");
    const allInterfaces = stdout.trim().split('\n').map(i => i.trim()).filter(i => i);

    const includePatterns = ['enx', 'wwan', 'usb'];
    const excluded = ['lo', 'wlan', 'eth0', 'docker', 'br-', 'veth', 'virbr', 'ppp'];

    const patternMatched = allInterfaces.filter(iface => {
      for (const ex of excluded) {
        if (iface.startsWith(ex)) return false;
      }
      for (const pat of includePatterns) {
        if (iface.startsWith(pat)) return true;
      }
      if (/^eth[1-9]/.test(iface)) return true;
      return false;
    });

    const merged = [...new Set([...usbInterfaces, ...patternMatched])];
    return merged.filter(i => !['lo', 'eth0', 'wlan0'].includes(i));
  } catch (error) {
    console.error('Error listing interfaces:', error.message);
    return [];
  }
}

/**
 * Get IP address of a network interface
 */
async function getInterfaceIP(interfaceName) {
  try {
    const { stdout } = await execAsync(
      `ip -4 addr show ${interfaceName} 2>/dev/null | grep -oP 'inet \\K[\\d./]+'`
    );
    const parts = stdout.trim().split('/');
    return { ip: parts[0] || null, subnet: parts[1] || null };
  } catch {
    return { ip: null, subnet: null };
  }
}

/**
 * Get default gateway for an interface
 */
async function getGatewayIP(interfaceName) {
  try {
    const { stdout } = await execAsync(
      `ip route show dev ${interfaceName} 2>/dev/null | grep default | awk '{print $3}'`
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get system information
 */
async function getSystemInfo() {
  try {
    const [hostname, uptime, cpuTemp, memInfo] = await Promise.all([
      execAsync('hostname').then(r => r.stdout.trim()).catch(() => 'unknown'),
      execAsync('uptime -p').then(r => r.stdout.trim()).catch(() => 'unknown'),
      execAsync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null')
        .then(r => (parseInt(r.stdout.trim()) / 1000).toFixed(1) + '°C')
        .catch(() => 'N/A'),
      execAsync("free -m | awk '/Mem:/ {printf \"%d/%dMB\", $3, $2}'")
        .then(r => r.stdout.trim())
        .catch(() => 'N/A'),
    ]);
    return { hostname, uptime, cpuTemp, memory: memInfo };
  } catch {
    return { hostname: 'unknown', uptime: 'unknown', cpuTemp: 'N/A', memory: 'N/A' };
  }
}

/**
 * Trigger usb_modeswitch for a device in storage mode
 */
async function switchModemMode(vendorId, productId) {
  try {
    await execAsync(`usb_modeswitch -v 0x${vendorId} -p 0x${productId} -M 55534243123456780000000000000a11062000000000000100000000000000`);
    return { success: true, message: 'Mode switch triggered — wait 10s for device to re-enumerate' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Connect a stick-mode modem via pppd (replaces wvdial which segfaults on Pi)
 */
async function connectStickModem(serialPort, pppIndex = 0) {
  const pppIface = `ppp${pppIndex}`;
  const peerName = `dcom${pppIndex}`;
  const chatScript = `/etc/chatscripts/${peerName}`;
  const peerFile = `/etc/ppp/peers/${peerName}`;

  // Create chatscript
  const chatContent = `ABORT 'BUSY'
ABORT 'NO CARRIER'
ABORT 'NO DIALTONE'
ABORT 'ERROR'
ABORT 'NO ANSWER'
TIMEOUT 30
'' 'ATZ'
OK 'AT+CGDCONT=1,"IP","internet"'
OK 'ATD*99#'
CONNECT ''
`;

  // Create pppd peer config
  // nodefaultroute — Pi keeps WiFi as default route
  // NO usepeerdns — Pi keeps its own DNS servers
  // 3proxy uses 'external <ppp_ip>' to route proxy traffic through PPP
  const peerContent = `${serialPort}
460800
connect "/usr/sbin/chat -v -f ${chatScript}"
noauth
nodefaultroute
noipdefault
persist
maxfail 3
holdoff 10
logfile /var/log/ppp-${peerName}.log
`;

  try {
    // Write config files
    fs.mkdirSync('/etc/chatscripts', { recursive: true });
    fs.writeFileSync(chatScript, chatContent, 'utf-8');
    fs.writeFileSync(peerFile, peerContent, 'utf-8');
    console.log(`[dcom-scanner] pppd config written: ${peerFile}`);

    // Kill any existing pppd for this port
    await execAsync(`pkill -f "pppd.*${serialPort}" 2>/dev/null`).catch(() => {});
    await new Promise(r => setTimeout(r, 1000));

    // Start pppd as daemon (no nodetach = auto-backgrounds)
    await execAsync(`pppd call ${peerName}`);
    console.log(`[dcom-scanner] pppd started for ${peerName}`);

    // Wait for PPP interface to get IP
    let retries = 15;
    while (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      const ipInfo = await getInterfaceIP(pppIface);
      if (ipInfo.ip) {
        console.log(`[dcom-scanner] PPP connected: ${pppIface} → ${ipInfo.ip}`);

        // Setup policy-based routing:
        // Traffic FROM ppp IP → route through ppp0
        // All other traffic → stays on WiFi (default route)
        const tableId = 100 + pppIndex;
        try {
          // Get peer gateway IP
          const { stdout: routeInfo } = await execAsync(`ip route show dev ${pppIface} 2>/dev/null`).catch(() => ({ stdout: '' }));
          const peerMatch = routeInfo.match(/(\d+\.\d+\.\d+\.\d+)/);
          const peerIp = peerMatch ? peerMatch[1] : null;

          // Remove old rules for this table
          await execAsync(`ip rule del table ${tableId} 2>/dev/null`).catch(() => {});
          await execAsync(`ip route flush table ${tableId} 2>/dev/null`).catch(() => {});

          // Add routing: traffic from ppp IP → goes through ppp0
          if (peerIp) {
            await execAsync(`ip route add default via ${peerIp} dev ${pppIface} table ${tableId}`);
          } else {
            await execAsync(`ip route add default dev ${pppIface} table ${tableId}`);
          }
          await execAsync(`ip rule add from ${ipInfo.ip} table ${tableId} priority ${tableId}`);

          console.log(`[dcom-scanner] Policy routing set: ${ipInfo.ip} → table ${tableId} via ${pppIface}`);
        } catch (routeErr) {
          console.error(`[dcom-scanner] Route setup warning:`, routeErr.message);
        }

        return { success: true, interface: pppIface, ip: ipInfo.ip };
      }
      retries--;
    }

    return { success: false, message: `PPP dial timed out — check /var/log/ppp-${peerName}.log` };
  } catch (error) {
    console.error(`[dcom-scanner] PPP connect error:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Disconnect a PPP interface
 */
async function disconnectPPP(pppIndex = 0) {
  try {
    const peerName = `dcom${pppIndex}`;
    await execAsync(`pkill -f "pppd.*${peerName}" 2>/dev/null`).catch(() => {});
    await execAsync(`pkill -f "pppd.*/dev/ttyUSB" 2>/dev/null`).catch(() => {});
    console.log(`[dcom-scanner] PPP ${pppIndex} disconnected`);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Get public IP for a specific interface (e.g. ppp0)
 * Uses curl through the interface to check actual public IP
 */
async function getPublicIP(interfaceName) {
  try {
    const { stdout } = await execAsync(
      `curl -s --interface ${interfaceName} --max-time 5 https://api.ipify.org 2>/dev/null`
    );
    const ip = stdout.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return ip;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = {
  scanDevices,
  detectUSBModems,
  getModemInterfaces,
  getInterfaceIP,
  getPublicIP,
  getSystemInfo,
  switchModemMode,
  connectStickModem,
  disconnectPPP,
  getSerialPorts,
};

