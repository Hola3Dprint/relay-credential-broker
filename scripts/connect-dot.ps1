param([Parameter(Mandatory=$true)][string]$ClientId, [Parameter(Mandatory=$true)][string]$TunnelId)
$ErrorActionPreference = 'Stop'
if ($ClientId -notmatch '^[0-9a-f-]{36}$' -or $TunnelId -notmatch '^tunnel_[a-zA-Z0-9]+$') { throw 'Use the client ID from Relay and the tunnel ID from OpenAI Platform.' }
$relayRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$relayNode = (Get-Command node.exe -ErrorAction Stop).Source
$relayMcp = Join-Path $relayRepo 'dist\server\mcp.js'
$relayData = Join-Path $relayRepo 'data'
if (!(Test-Path -LiteralPath $relayMcp)) { throw 'Run npm run build first.' }
# tunnel-client parses this string as a POSIX-style command, even on Windows.
# Forward slashes preserve quoted Windows paths through its stdio preflight.
$relayCommand = '"' + $relayNode.Replace('\', '/') + '" "' + $relayMcp.Replace('\', '/') + '" --data-dir "' + $relayData.Replace('\', '/') + '" --client-id ' + $ClientId
# Prepare exact local wiring. This helper makes no OpenAI API calls and handles no API key.
# Configure the separately installed official tunnel-client using its own credential flow.
$relayConnection = @{ tunnelId=$TunnelId; clientId=$ClientId; mcpCommand=$relayCommand; profile='relay' }
$relayConnection | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $relayData 'dot-connection.json') -Encoding UTF8
Write-Host 'Prepared private Dot connection. Install the official client under data/tools/tunnel-client and provision the approved .env.local runtime key, then run:'
Write-Host 'node scripts/dot-runtime.mjs init'
Write-Host 'node scripts/dot-runtime.mjs doctor'
Write-Host 'node scripts/dot-runtime.mjs connect'
Write-Host 'node scripts/dot-runtime.mjs status'
Write-Host 'ChatGPT Plugins > Add > Create custom MCP server > Connection: Tunnel. Choose your tunnel and connect Relay Credential Broker.'
Write-Host 'Read docs/CHATGPT-DOTS.md for authentication, permissions, and testing.'
