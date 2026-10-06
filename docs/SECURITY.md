# Security boundaries

Relay handles powerful credentials. It is a working initial implementation with tests, not a security audit or a guarantee of uninterrupted access to arbitrary websites.

## At rest

The entire vault, account configuration, mailbox credentials, Bitwarden machine token, client bridge tokens, audit records and browser state are encrypted using AES-256-GCM with random nonces and authenticated store identity. A random 256-bit data key is wrapped using Windows CurrentUser DPAPI or a non-exportable RSA key in Microsoft Platform Crypto Provider. TPM wrapping is RSA-OAEP-SHA256. There is no silent plaintext or software fallback from TPM.

Windows data-directory inheritance is removed and only the current Windows identity and SYSTEM receive full access. Secrets are ignored by Git. Writes use a same-directory unique file and atomic rename; state updates are serialized. Keep key and vault backups matched. TPM/DPAPI keys are account/machine-bound and are not portable backups. TPM hardware loss requires a recovery strategy established outside this release.

The optional tunnel runtime key has its own CurrentUser DPAPI file. It is not stored under the TPM vault key. The service account's password is handed to Windows SCM as a PSCredential and never written into an XML/JSON service file.

## In use

Decryption and browser sign-in require secrets in broker memory and inside the enrolled site's login fields. A compromised broker process, Windows user, administrator, mailbox provider or trusted enrolled origin can defeat the boundary. JavaScript strings cannot be reliably zeroized. OS swap, crash dumps and browser internal temporary storage are outside the AES vault guarantee. Maintain the Windows host accordingly; this repository does not change those OS policies.

Each account uses an isolated incognito BrowserContext and encrypted storageState. Cookies, localStorage and IndexedDB are restored; no plaintext persistent profile, HAR, screenshot capture, cookie export or executable page tool is exposed. The browser only makes HTTPS requests to enrolled origins (127.0.0.1 fixture requests excepted); WebSockets and service workers are disabled. An allowed site can see its own credentials, as in ordinary login. Allowlist only trusted origins.

Page reading is limited to exact owner-enrolled task URLs and visible text. Known username, password, pending password, TOTP seed and recovery-code literals are redacted. This is not a general sensitive-data classifier: site-issued API tokens, encoded/fragmented values, account profile information or secrets already present in an approved page can appear in its text. Do not approve pages that display secrets. The Dot must treat all site content as untrusted source material.

## API and MCP

Shared autofill stores one owner-configured email/password in the encrypted vault. The owner explicitly grants a Dot autofill authority on the requested HTTPS origin. Unlike an account grant, this permits reuse across sites. The AI receives only status; the value is delivered exclusively to the authenticated paired Chrome companion after checking grant, requested origin, recent focus nonce and field kind. The companion validates the current tab/frame origin, active native input, visibility, writable state and form destination again before filling. Neither clipboard copying nor credential retrieval is exposed to MCP. Password-change forms are rejected; new-account fields require both owner and client signup grants.

The extension has HTTPS page access to reach login inputs in the Dot's Chrome profile and loopback access to Relay. Its browser-only token is stored in Chrome extension storage, separate from Dot and console tokens; it can retrieve only a pending Dot-authorized delivery, not initiate a credential read. Pairing codes expire after five minutes and are single-use. Chrome extension origins are allowed only on browser-companion routes, which still require their own token. A compromised extension/browser profile or trusted destination site can see filled credentials, just as with a password manager.

The broker binds only to 127.0.0.1. Host validation prevents DNS-rebinding requests; browser Origin checks reject cross-origin requests. The console requires a separate 256-bit bearer token. Client tokens are constant-time checked and restricted to accounts and tool operations. Admin keys do not authenticate as clients. Revocation is checked on every call. Client operations are rate limited. All credentials/configuration setters are console-only and are not MCP tools.

The console token is stored in that tab's sessionStorage after URL-fragment intake. Keep the console private. The stdio bridge reads its selected encrypted grant internally, sends it only to the loopback broker, and emits only MCP tool results. It has local OS authority to read the vault; callers cannot ask it to read arbitrary files or change its grant. A host compromise still defeats local process isolation.

Use the official private tunnel with the intended organization/workspace. The repository's preparation helper does not create a public endpoint, perform OAuth, or disable security controls. The raw `/mcp` endpoint requires a scoped bearer token and is for local clients. Do not publish it directly: public ChatGPT deployment would require an appropriate OAuth 2.1 authorization layer and HTTPS ingress, which this release deliberately does not implement.

## Mail and account changes

Email ingestion requires TLS, exact sender/recipient/subject, recent internal arrival time, receiving-provider-attested aligned DKIM and an explicit HTTPS link-origin allowlist. The mail provider must strip inbound Authentication-Results claiming its own authserv-id. The broker does not perform its own DNS DKIM verification; it trusts the enrolled receiving mail server's result. Numeric OTP matching is bounded. Message identifiers and recovery codes are reserved before use and stored encrypted.

Signup and reset require explicit adapters and suitable grants. Unknown outcomes are retained for recovery. The broker does not bypass CAPTCHA, physical passkeys, push approvals or identity checks. Selector-based detection must be configured for each site's challenge screens. Terms acceptance and host-sensitive confirmations remain the user's/ChatGPT's responsibility. MCP annotations declare mutating behavior accurately.

## Verification scope

Local Chromium password/TOTP, session restore, TPM wrapping/unwrapping, access control and tampering have been tested. The original four-tool tunnel and live Dot demo also passed. The native service compiles. Shared autofill protocol and shipped content-script rejection rules have automated tests; live companion installation, pairing and Dot-to-field delivery must be verified separately. No real Bitwarden token, IMAP mailbox, supplier signup/reset or reboot/service-account environment was enrolled. See VERIFICATION.md for the current scope.
