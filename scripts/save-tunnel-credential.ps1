param([switch]$FromEnvironment)
$ErrorActionPreference = 'Stop'
$relayRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$relayData = Join-Path $relayRepo 'data'
if (!(Test-Path -LiteralPath (Join-Path $relayData 'vault.enc'))) { throw 'Complete Relay setup under this Windows account first.' }
Add-Type -AssemblyName System.Security
$relayTarget = Join-Path $relayData 'tunnel-runtime.dpapi'
if ((Test-Path -LiteralPath $relayTarget) -and ((Get-Item -LiteralPath $relayTarget).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing a linked credential target.' }
$relayPointer = [IntPtr]::Zero
try {
  if ($FromEnvironment) {
    if (!$env:CONTROL_PLANE_API_KEY) { throw 'The approved runtime key is missing from the child environment.' }
    $relayBytes = [Text.Encoding]::UTF8.GetBytes($env:CONTROL_PLANE_API_KEY)
    Remove-Item Env:CONTROL_PLANE_API_KEY
  } else {
    $relaySecure = Read-Host 'Existing OpenAI tunnel runtime key (stored for service startup under this Windows account)' -AsSecureString
    $relayPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($relaySecure)
    $relayBytes = [Text.Encoding]::UTF8.GetBytes([Runtime.InteropServices.Marshal]::PtrToStringBSTR($relayPointer))
  }
  $relayProtected = [Security.Cryptography.ProtectedData]::Protect($relayBytes, [Text.Encoding]::UTF8.GetBytes('Relay tunnel runtime v1'), [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($relayTarget, $relayProtected)
  Write-Host 'Saved for the optional tunnel service. The key was not printed or written in plaintext.'
} finally {
  if ($relayPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($relayPointer) }
  if ($relayBytes) { [Array]::Clear($relayBytes, 0, $relayBytes.Length) }
}
