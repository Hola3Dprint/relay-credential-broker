param([ValidateSet('dpapi','tpm')][string]$Mode, [ValidateSet('wrap','unwrap')][string]$Action)
$ErrorActionPreference = 'Stop'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($request.value)
  if ($Mode -eq 'dpapi') {
    Add-Type -AssemblyName System.Security
    $entropy = [Text.Encoding]::UTF8.GetBytes('Relay credential broker v1')
    if ($Action -eq 'wrap') {
      $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    } else {
      $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    }
  } else {
    $provider = [Security.Cryptography.CngProvider]::new('Microsoft Platform Crypto Provider')
    $keyName = 'Relay-' + $request.id
    if ($Action -eq 'wrap' -and ![Security.Cryptography.CngKey]::Exists($keyName, $provider)) {
      $parameters = [Security.Cryptography.CngKeyCreationParameters]::new()
      $parameters.Provider = $provider
      $parameters.ExportPolicy = [Security.Cryptography.CngExportPolicies]::None
      $parameters.KeyUsage = [Security.Cryptography.CngKeyUsages]::Decryption
      $parameters.Parameters.Add([Security.Cryptography.CngProperty]::new('Length', [BitConverter]::GetBytes(2048), [Security.Cryptography.CngPropertyOptions]::None))
      $key = [Security.Cryptography.CngKey]::Create([Security.Cryptography.CngAlgorithm]::Rsa, $keyName, $parameters)
    } else {
      $key = [Security.Cryptography.CngKey]::Open($keyName, $provider)
    }
    try {
      $rsa = [Security.Cryptography.RSACng]::new($key)
      if ($Action -eq 'wrap') { $result = $rsa.Encrypt($bytes, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256) }
      else { $result = $rsa.Decrypt($bytes, [Security.Cryptography.RSAEncryptionPadding]::OaepSHA256) }
    } finally { if ($rsa) { $rsa.Dispose() }; $key.Dispose() }
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
  # Never return crypto request data or provider diagnostics containing sensitive input.
  [Console]::Error.Write('Windows key protection failed. Check the service identity and TPM availability.')
  exit 1
} finally { if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) } }
