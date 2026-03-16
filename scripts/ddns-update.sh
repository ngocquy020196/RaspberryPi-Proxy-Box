#!/bin/bash
# ============================================
# Cloudflare DDNS Updater for DCOM Proxy Box
# Updates DNS A record with Pi's public WiFi IP
# Customers use this domain to connect to proxy
# ============================================

# Load config from .env
INSTALL_DIR="/opt/dcom-proxy"
if [ -f "$INSTALL_DIR/.env" ]; then
  source "$INSTALL_DIR/.env"
fi

# Cloudflare API config (from .env)
CF_API_TOKEN="${CF_API_TOKEN:-}"
CF_ZONE_ID="${CF_ZONE_ID:-}"
CF_RECORD_NAME="${CF_DDNS_DOMAIN:-}"

# Validate config
if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ] || [ -z "$CF_RECORD_NAME" ]; then
  echo "[ddns] Skipped — CF_API_TOKEN, CF_ZONE_ID, and CF_DDNS_DOMAIN must be set"
  exit 0
fi

# Get current public IP (via WiFi, not PPP)
CURRENT_IP=$(curl -s --max-time 10 https://api.ipify.org 2>/dev/null)

if [ -z "$CURRENT_IP" ] || ! echo "$CURRENT_IP" | grep -qP '^\d+\.\d+\.\d+\.\d+$'; then
  echo "[ddns] ERROR: Could not get public IP"
  exit 1
fi

# Get existing DNS record
RECORD_DATA=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=${CF_RECORD_NAME}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo "$RECORD_DATA" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
OLD_IP=$(echo "$RECORD_DATA" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)

# Skip if IP hasn't changed
if [ "$CURRENT_IP" = "$OLD_IP" ]; then
  echo "[ddns] IP unchanged: $CURRENT_IP"
  exit 0
fi

if [ -z "$RECORD_ID" ]; then
  # Create new record
  echo "[ddns] Creating A record: ${CF_RECORD_NAME} → ${CURRENT_IP}"
  curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${CF_RECORD_NAME}\",\"content\":\"${CURRENT_IP}\",\"ttl\":60,\"proxied\":false}" \
    > /dev/null
else
  # Update existing record
  echo "[ddns] Updating: ${CF_RECORD_NAME} ${OLD_IP} → ${CURRENT_IP}"
  curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${CF_RECORD_NAME}\",\"content\":\"${CURRENT_IP}\",\"ttl\":60,\"proxied\":false}" \
    > /dev/null
fi

echo "[ddns] Done: ${CF_RECORD_NAME} → ${CURRENT_IP}"
