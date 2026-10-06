#Requires -RunAsAdministrator
param([PSCredential]$Credential, [string]$TunnelPath, [string]$TunnelProfile = 'relay')
$ErrorActionPreference = 'Stop'
$relayRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$relayData = Join-Path $relayRepo 'data'
if (!(Test-Path -LiteralPath (Join-Path $relayData 'vault.enc'))) { throw 'Complete Relay setup first, under the Windows account that will run this service.' }
if (Get-Service -Name 'RelayCredentialBroker' -ErrorAction SilentlyContinue) { throw 'Relay is already installed. Stop it and use the existing service configuration.' }
if (!$Credential) { $Credential = Get-Credential -Message 'Use the SAME Windows account that completed Relay setup. A Windows account password is required; a Windows Hello PIN is not a service credential.' }
$relayNode = (Get-Command node.exe -ErrorAction Stop).Source
$relayHost = Join-Path $relayRepo 'dist\windows-service'
& dotnet publish (Join-Path $relayRepo 'windows\Relay.Service\Relay.Service.csproj') -c Release -r win-x64 --self-contained true -o $relayHost
if ($LASTEXITCODE -ne 0) { throw 'Windows service build failed.' }
$relayConfig = Join-Path $relayData 'service.json'
@{ nodePath=$relayNode; repoPath=$relayRepo; dataPath=$relayData; tunnelPath=$TunnelPath; tunnelProfile=$TunnelProfile } | ConvertTo-Json | Set-Content -LiteralPath $relayConfig -Encoding UTF8
$relayExecutable = Join-Path $relayHost 'Relay.Service.exe'
$relayBinary = '"' + $relayExecutable + '" "' + $relayConfig + '"'
New-Service -Name 'RelayCredentialBroker' -DisplayName 'Relay Credential Broker' -Description 'Private browser sign-in broker for ChatGPT Dots.' -BinaryPathName $relayBinary -StartupType Automatic -Credential $Credential | Out-Null
& sc.exe failure 'RelayCredentialBroker' reset= 86400 actions= restart/10000/restart/30000/restart/60000
if ($LASTEXITCODE -ne 0) { throw 'Service installed, but recovery policy could not be configured.' }
Write-Host 'Installed. Stop any manually running Relay process, then run Start-Service RelayCredentialBroker.'
Write-Host 'The service account must have Log on as a service rights. Enrollment keys are bound to that account.'
