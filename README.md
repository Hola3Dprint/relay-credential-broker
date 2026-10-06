# Relay

A private Windows credential broker for ChatGPT Dots and other MCP clients. Enroll an account once; Relay restores encrypted browser sessions, signs in again when needed, and handles explicitly configured MFA inside its own browser. Agents receive outcomes and permitted page text, never credential values.

![Relay dashboard after local demo sign-in](docs/dashboard.png)

**Working implementation, not a universal login adapter.** Each website needs an explicit adapter. Real Bitwarden, mailbox, signup, reset, and ChatGPT connections require enrollment and provider-specific verification. A local test website exercises the complete password + TOTP + session workflow without real accounts.

## Run on Windows

Install Node.js 22 or newer (24 recommended), then from this repository:

```powershell
npm ci
npm run browser:install
npm run build
npm start
```

In a second terminal:

```powershell
npm run console
```

The console runs at `http://127.0.0.1:4318`. `npm run console` opens an authenticated link with a short-lived URL fragment; the console removes the fragment on load. The access token itself remains valid until the encrypted store is replaced; keep the console browser private. The initial store uses Windows CurrentUser DPAPI. Start setup can rewrap its random AES key using a non-exportable Windows TPM RSA key. TPM failure is an error, never a silent software fallback.

Click **Start setup**, choose TPM or DPAPI, then **Try the local demo**. The demo is an explicitly local fixture with published test credentials, not a real connected supplier.

For frontend development use `npm run dev`, and open `npm run console -- --dev`.

## Use with ChatGPT Dots

See [the Dot connection guide](docs/CHATGPT-DOTS.md). Relay includes:

- MCP stdio and stateless Streamable HTTP transports.
- A client grant restricted to selected accounts and operations, revocable immediately.
- A preparation script for OpenAI Secure MCP Tunnel so the broker can remain private.
- A portable skills plugin in `plugin/`, usable alongside the connected Relay MCP plugin.

The supported path is **Dot → ChatGPT Relay plugin → Secure MCP Tunnel → scoped stdio bridge → local broker → website**. The broker does not transfer cookies to the Dot's native browser. Use `read_account_page` to work with permitted authenticated pages.

| Tool                | Result                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `list_accounts`     | Scoped account identifiers and permitted task pages                                            |
| `ensure_login`      | `AUTHENTICATED`, `BLOCKED`, or `ERROR`                                                         |
| `read_account_page` | Visible text from an exact owner-enrolled task URL                                             |
| `create_account`    | Configured signup, verification and optional TOTP enrollment; requires a separate signup grant |

No secret retrieval, arbitrary JavaScript, cookie export, mailbox search, shell, or unrestricted browser tools are exposed. The MCP annotations accurately flag authentication workflows as potentially mutating, including configured password reset. ChatGPT and Dot permissions remain in effect.

## Enroll real accounts

In Accounts, enter credentials locally or choose a Bitwarden Secrets Manager secret ID. Configure exact origins, sign-in selectors, a signed-in marker, and the session-check URL. Set exact task URLs the Dot may read. Add any required identity-provider and asset origins explicitly; other network requests are blocked.

Bitwarden uses the official Node SDK with a machine-account token. In Settings, connect a token limited to your automation project. Each selected secret's value is this JSON object:

```json
{
  "username": "automation@yourdomain.com",
  "password": "your-existing-website-password",
  "totpSecret": "YOUR_EXISTING_BASE32_SEED",
  "recoveryCodes": []
}
```

Omit `totpSecret` when not used. Password rotation and recovery-code reservation update the same Bitwarden secret in memory through the SDK, with no secret argv or plaintext SDK cache. The machine account needs write permission for those operations. An expired or revoked token produces a safe error; Relay cannot manufacture replacement vault authority.

For email MFA, verification or password reset, connect a dedicated existing TLS IMAP mailbox. Use the receiving server's trusted `Authentication-Results` authserv-id. Relay matches exact sender, recipient, subject, recent internal arrival time, aligned DKIM, and permitted HTTPS link origins. The provider must strip forged inbound copies of its own authserv-id. Codes/links are reserved before use. See [adapter configuration](docs/ADAPTERS.md).

Signup uses a preconfigured alias template such as `automation+{alias}@yourdomain.com`; your mailbox provider must already deliver those aliases. Relay generates a 32-character random password and records the candidate before signup. An uncertain signup is not blindly retried. Recovery codes are consumed only by an explicitly selected recovery adapter. TOTP and email MFA are selected per adapter; Relay does not guess or silently downgrade authentication.

## Startup after reboot

The optional native .NET Windows service host is in `windows/Relay.Service`. Install it from elevated PowerShell under the SAME Windows account used for enrollment:

```powershell
.\scripts\install-service.ps1
# Stop a manually running instance, then:
Start-Service RelayCredentialBroker
```

The installer prompts locally for that Windows account's service credential. Windows SCM stores it, not source files. The account must have **Log on as a service** rights. A Windows Hello PIN is not a service password. You need the .NET 8 SDK to publish the service; the resulting host is self-contained. It starts the broker at boot and restarts after failure. It has been compiled locally; live service installation and reboot behavior need verification on the target service account.

To supervise an already configured official tunnel-client too, save an existing tunnel runtime credential with `scripts/save-tunnel-credential.ps1`, then pass `-TunnelPath` and optionally `-TunnelProfile` to the installer. The runtime credential uses CurrentUser DPAPI, independently of the TPM-wrapped vault key. The service decrypts it only into the child environment. Do not change the service identity without re-enrollment or key migration. Windows login, disk-unlock policy, token revocation, hardware failure, and provider security checks can still affect availability.

## Verification

```powershell
npm run check
npm audit --audit-level=high
dotnet build windows/Relay.Service/Relay.Service.csproj -c Release
```

Tests cover AES-GCM tampering, RFC 6238 vectors, real Chromium login, TOTP, encrypted persistence and session restoration, session invalidation, concurrent sign-in deduplication, pending password recovery, exact URL restrictions, human-verification blocks, DKIM filtering, console/client separation, MCP initialization, revocation and origin/Host checks. GitHub Actions runs these checks on Windows.

Current limits and threat model: [SECURITY.md](docs/SECURITY.md). Functional and visual checks: [VERIFICATION.md](docs/VERIFICATION.md).

## Configuration

| Variable                       | Default / purpose                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `RELAY_DATA_DIR`               | `data/`; restricted, encrypted, excluded from Git                                                           |
| `RELAY_HEADLESS`               | `true`; set `false` for local adapter debugging                                                             |
| `RELAY_BITWARDEN_API_URL`      | `https://api.bitwarden.com`; use a trusted regional server when needed                                      |
| `RELAY_BITWARDEN_IDENTITY_URL` | `https://identity.bitwarden.com`                                                                            |
| `RELAY_KEY_MODE`               | Windows DPAPI; `passphrase` is explicit portable/test mode                                                  |
| `RELAY_PASSPHRASE`             | Required for portable mode, at least 20 characters; cannot auto-unlock without secure external provisioning |
| `RELAY_CLIENT_TOKEN`           | Optional scoped bridge token; normally read by `--client-id` from the protected store                       |

Back up both `data/master-key.json` and `data/vault.enc` together. TPM/DPAPI protection is bound to the machine/account; copying files to another PC is not a recovery strategy. No plaintext fallback is implemented.
