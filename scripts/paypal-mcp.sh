#!/usr/bin/env bash
# Starts PayPal's official MCP server (@paypal/mcp) against the SANDBOX, limited to
# one read-only tool (get_order), with a sandbox access token minted from .env at start.
# The token is never printed, never stored in any config, and is fresh for each session.
#
#   claude mcp add paypal -- "<repo>/scripts/paypal-mcp.sh"
#
# stdout belongs to the MCP protocol; anything this script says goes to stderr.
set -euo pipefail
cd "$(dirname "$0")/.."

val() { grep -E "^$1=" .env | head -n1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//"; }
id="$(val PAYPAL_CLIENT_ID)"; secret="$(val PAYPAL_CLIENT_SECRET)"
[ "$(val PAYPAL_ENV)" = "sandbox" ] || { echo "paypal-mcp: PAYPAL_ENV must be sandbox" >&2; exit 1; }
[ -n "$id" ] && [ -n "$secret" ] || { echo "paypal-mcp: PayPal keys missing from .env" >&2; exit 1; }

# Credentials go to curl on stdin (-K -), so they never appear in the process list.
token="$(printf 'user = "%s:%s"\n' "$id" "$secret" \
  | curl -sf -K - https://api-m.sandbox.paypal.com/v1/oauth2/token -d grant_type=client_credentials \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')" \
  || { echo "paypal-mcp: could not get a sandbox token" >&2; exit 1; }

export PAYPAL_ACCESS_TOKEN="$token" PAYPAL_ENVIRONMENT=SANDBOX
exec npx -y @paypal/mcp@1.8.1 --tools=orders.get
