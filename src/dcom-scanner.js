/**
 * USB Dcom Scanner
 * Detects connected USB Dcom devices and maps them to network interfaces
 * Optimized for Vodafone K5160 (Huawei E3372)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Huawei USB Vendor ID
const HUAWEI_VENDOR_ID = '12d1';

// Known Huawei modem product IDs
const HUAWEI_MODEM_PRODUCTS = {
  '1506': 'Huawei E3372 (HiLink)',
  '14dc': 'Huawei E3372 (Stick)',
  '1c05': 'Huawei E3372h (HiLink)',
  '14fe': 'Huawei K5160 (Storage/CD-ROM mode)',
  '1f01': 'Huawei E3372h-320',
};

/**
 * Scan for connected USB Dcom devices
 * Returns array of device objects with interface & IP info
 */
async function scanDevices() {
  const usbDevices = await detectUSBModems();
  const networkInterfaces = await getModemInterfaces();
  
  // Map USB devices to their network interfaces
  const devices = [];
  
  for (const iface of networkInterfaces) {
    const ipInfo = await getInterfaceIP(iface);
    const gatewayIP = await getGatewayIP(iface);
    
    devices.push({
      interfaceName: iface,
      ip: ipInfo.ip || 'N/A',
      subnet: ipInfo.subnet || 'N/A',
      gateway: gatewayIP || 'N/A',
      status: ipInfo.ip ? 'active' : 'no-ip',
      type: iface.startsWith('eth') ? 'ethernet' : 'usb',
    });
  }

  // Add USB detection info
  for (const usb of usbDevices) {
    if (usb.needsModeSwitch) {
      devices.push({
        interfaceName: 'N/A',
        ip: 'N/A',
        subnet: 'N/A',
        gateway: 'N/A',
        status: 'storage-mode',
        type: 'usb-storage',
        usbInfo: usb,
        message: 'Device in CD-ROM mode — needs usb_modeswitch'
      });
    }
  }

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
          modems.push({
            vendor,
            product,
            name: HUAWEI_MODEM_PRODUCTS[product] || `Huawei Unknown (${product})`,
            raw: line.trim(),
            needsModeSwitch: product === '14fe', // CD-ROM mode
          });
        }
      }
    }

    return modems;
  } catch (error) {
    console.error('Error scanning USB devices:', error.message);
    return [];
  }
}

/**
 * Get modem-related network interfaces
 * Uses both include patterns and sysfs USB detection
 */
async function getModemInterfaces() {
  try {
    // Method 1: Find USB network interfaces via sysfs (most reliable)
    let usbInterfaces = [];
    try {
      const { stdout: sysfsOut } = await execAsync(
        "ls -d /sys/class/net/*/device/driver 2>/dev/null | cut -d'/' -f5"
      );
      const sysfsIfaces = sysfsOut.trim().split('\n').filter(i => i);
      
      for (const iface of sysfsIfaces) {
        // Check if this interface is a USB device
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

    // Method 2: Pattern matching on interface names (fallback)
    const { stdout } = await execAsync("ip -o link show | awk -F': ' '{print $2}'");
    const allInterfaces = stdout.trim().split('\n').map(i => i.trim()).filter(i => i);

    // Include patterns for USB modem interfaces
    // enx*: HiLink USB ethernet (most common for K5160)
    // wwan*: cellular modem interfaces
    // usb*: generic USB network
    // eth1, eth2...: secondary ethernet (often USB modems)
    const includePatterns = ['enx', 'wwan', 'usb', 'ppp'];
    const excluded = ['lo', 'wlan', 'eth0', 'docker', 'br-', 'veth', 'virbr'];

    const patternMatched = allInterfaces.filter(iface => {
      // Skip excluded
      for (const ex of excluded) {
        if (iface.startsWith(ex)) return false;
      }
      // Include if matches known USB modem patterns
      for (const pat of includePatterns) {
        if (iface.startsWith(pat)) return true;
      }
      // Include secondary eth interfaces (eth1, eth2, etc.)
      if (/^eth[1-9]/.test(iface)) return true;
      return false;
    });

    // Merge both methods (unique)
    const merged = [...new Set([...usbInterfaces, ...patternMatched])];
    
    // Final filter: remove primary built-in interfaces
    const result = merged.filter(i => !['lo', 'eth0', 'wlan0'].includes(i));
    
    console.log(`[dcom-scanner] Found interfaces: ${result.length > 0 ? result.join(', ') : 'none'}`);
    console.log(`[dcom-scanner] All interfaces: ${allInterfaces.join(', ')}`);
    
    return result;
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
    return {
      ip: parts[0] || null,
      subnet: parts[1] || null,
    };
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
  } catch (error) {
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

module.exports = {
  scanDevices,
  detectUSBModems,
  getModemInterfaces,
  getInterfaceIP,
  getSystemInfo,
  switchModemMode,
};
