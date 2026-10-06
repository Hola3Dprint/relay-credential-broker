param([Parameter(Mandatory=$true)][string]$ClientId, [Parameter(Mandatory=$true)][string]$TunnelId)
$ErrorActionPreference = 'Stop'
if ($ClientId -notmatch '^[0-9a-f-]{36}$' -or $TunnelId -notmatch '^tunnel_[a-zA-Z0-9]+$') { throw 'Use the client ID from Relay and the tunnel ID from OpenAI Platform.' }
$relayRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$relayNode = (Get-Command node.exe -ErrorAction Stop).Source
$relayMcp = Join-Path $relayRepo 'dist\server\mcp.js'
$relayData = Join-Path $relayRepo 'data'
if (!(Test-Path -LiteralPath $relayMcp)) { throw 'Run npm run build first.' }
$relayCommand = '"' + $relayNode + '" "' + $relayMcp + '" --data-dir "' + $relayData + '" --client-id ' + $ClientId
# Prepare exact local wiring. This helper makes no OpenAI API calls and handles no API key.
# Configure the separately installed official tunnel-client using its own credential flow.
$relayConnection = @{ tunnelId=$TunnelId; clientId=$ClientId; mcpCommand=$relayCommand; profile='relay' }
$relayConnection | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $relayData 'dot-connection.json') -Encoding UTF8
Write-Host 'Prepared private Dot connection. Run these commands in your authenticated official tunnel-client shell:'
Write-Host ("tunnel-client init --sample sample_mcp_stdio_local --profile relay --tunnel-id " + $TunnelId + " --mcp-command '" + $relayCommand + "'")
Write-Host 'tunnel-client doctor --profile relay --explain'
Write-Host 'tunnel-client run --profile relay'
Write-Host 'ChatGPT Plugins > + > Add custom MCP server > Connection: Tunnel. Choose your tunnel and enable Relay for your Dot.'
Write-Host 'Read docs/CHATGPT-DOTS.md for authentication, permissions, and testing.'
