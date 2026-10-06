param()
$ErrorActionPreference = 'Stop'
$relayRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$relayData = Join-Path $relayRepo 'data'
if (!(Test-Path -LiteralPath (Join-Path $relayData 'vault.enc'))) { throw 'Complete Relay setup under this Windows account first.' }
Add-Type -AssemblyName System.Security
$relaySecure = Read-Host 'Existing OpenAI tunnel runtime key (stored for service startup under this Windows account)' -AsSecureString
$relayPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($relaySecure)
try {
  $relayBytes = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($relayPointer))
  $relayProtected = [Security.Cryptography.ProtectedData]::Protect($relayBytes, [Text.Encoding]::UTF8.GetBytes('Relay tunnel runtime v1'), [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes((Join-Path $relayData 'tunnel-runtime.dpapi'), $relayProtected)
  Write-Host 'Saved for the optional tunnel service. The key was not printed or written in plaintext.'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($relayPointer)
  if ($relayBytes) { [Array]::Clear($relayBytes, 0, $relayBytes.Length) }
}
