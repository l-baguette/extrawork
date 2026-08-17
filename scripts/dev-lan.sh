#!/usr/bin/env bash
# Run the dev stack so it can be reached from a phone on the same Wi-Fi.
#
# `localhost` means "this device". An approval link containing it is unusable on
# a phone, which is the whole point of testing the customer's side — so this
# rewrites the four public URLs to this machine's LAN address and starts the
# three processes with them.
#
# Nothing is written to .env: these are exported for this run only, so the
# normal `pnpm dev` keeps working on localhost and no machine-specific address
# gets committed.
set -euo pipefail

cd "$(dirname "$0")/.."

LAN_IP="${LAN_IP:-}"
if [ -z "$LAN_IP" ]; then
  for iface in en0 en1 en2; do
    LAN_IP=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    [ -n "$LAN_IP" ] && break
  done
fi

if [ -z "$LAN_IP" ]; then
  echo "Could not find a LAN address. Connect to Wi-Fi, or run: LAN_IP=192.168.x.x $0" >&2
  exit 1
fi

export API_HOST=0.0.0.0
export API_PUBLIC_URL="http://${LAN_IP}:4000"
export WEB_PUBLIC_URL="http://${LAN_IP}:3000"
export NEXT_PUBLIC_API_URL="http://${LAN_IP}:4000"
# Both origins stay allowed so the machine running this can still use localhost.
export CORS_ALLOWED_ORIGINS="http://${LAN_IP}:3000,http://localhost:3000"

cat <<BANNER

  ExtraWork is starting on the network at ${LAN_IP}.

  On your phone (same Wi-Fi):
    Owner dashboard   http://${LAN_IP}:3000
    Employee console  http://${LAN_IP}:3000/simulator
    Customer links    generated automatically with this address

  On this Mac:
    http://localhost:3000 still works.

  Approval links minted while this is running point at ${LAN_IP}.
  Links minted earlier still say localhost and will not open on a phone.

BANNER

# `next dev` already listens on every interface; the API needs API_HOST=0.0.0.0,
# set above.
pnpm --filter @extrawork/api dev &
pnpm --filter @extrawork/worker dev &
pnpm --filter @extrawork/web dev &
wait
