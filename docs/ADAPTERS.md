# Website adapters

Use the basic enrollment form for password/TOTP websites, or paste full adapter JSON into its Advanced field. Full schemas are in `src/schema.ts`; credentials are supplied separately and never belong in adapter JSON.

```json
{
  "id": "supplier-x",
  "name": "Supplier X",
  "identity": "business",
  "origins": ["https://supplier.example"],
  "login": {
    "url": "https://supplier.example/login",
    "username": "#email",
    "password": "#password",
    "submit": "button[type=submit]",
    "success": "[data-account-menu]"
  },
  "sessionCheckUrl": "https://supplier.example/account",
  "taskPages": ["https://supplier.example/catalog"],
  "mfa": { "input": "#code", "submit": "#verify", "method": "totp" },
  "blockedSelectors": ["[data-captcha]", "[data-passkey-required]"],
  "renewalMinutes": 720,
  "timeoutMs": 15000
}
```

These are schema examples, not working supplier credentials or live website adapters. Use selectors verified on the actual site. The signed-in marker must be visible only after successful authentication. The broker checks it and stores cookies, localStorage and IndexedDB inside the encrypted vault. SessionStorage and arbitrary browser-profile files are not persisted.

Origins must be HTTPS (127.0.0.1 HTTP is permitted for local fixtures). All form, session, signup, reset and task URLs must belong to allowed origins. Cross-origin requests, WebSockets and service workers are blocked. Include legitimate IdP and asset origins where necessary. Keep task pages to static URLs without embedded credentials or sensitive query parameters. Avoid settings pages that display secrets.

## Email MFA

Replace the MFA object with:

```json
{
  "input": "#email-code",
  "submit": "#verify",
  "method": "email",
  "mail": {
    "sender": "login@supplier.example",
    "subjectIncludes": "sign-in code",
    "codePattern": "\\b([0-9]{6})\\b",
    "dkimDomain": "supplier.example"
  }
}
```

Only bounded six- or eight-digit code patterns are accepted. DKIM domain defaults to the exact sender domain. Configure a dedicated mailbox with trusted receiving authserv-id, TLS and app-password access. The website credential username must be the verification email recipient. The inbox provider must strip forged copies of its authentication header. Relay requires the top Authentication-Results header to come from that configured receiving server with a matching `dkim=pass header.d=...` result. It does not trust display names or From alone.

`method: recovery` consumes a stored recovery code before submitting it. Use recovery mode only when the site presents an approved recovery-code field. Recovery codes remain single-use even if the attempt fails.

## Signup

Add `signup` using the same `url`, `username`, `password`, `submit`, `success` fields as login. Optional `confirmPassword` handles a repeat-password input. For email verification add `verificationMail` with the same mail rule fields above and `verificationOrigins` containing allowed HTTPS origins. Every verification origin must also appear in the site's `origins`.

For optional authenticator enrollment, add `totpEnrollment` to signup:

```json
{
  "url": "https://supplier.example/security/totp",
  "secret": "[data-totp-seed]",
  "code": "#confirmation-code",
  "submit": "#enable-totp",
  "success": "[data-totp-enabled]",
  "recoveryCodes": "[data-recovery-code]"
}
```

The selector must expose a Base32 seed as text; QR-only flows need a site-specific extension. Relay saves the seed before confirmation, calculates the code privately, then stores recovery-code text elements. It does not select a legal-terms checkbox or solve a challenge. Site-specific implicit legal acceptance must be handled through the host's user-authorization safeguards before invoking signup.

## Password expiration and reset

Add `reset`:

```json
{
  "expired": "[data-password-expired]",
  "requestUrl": "https://supplier.example/forgot-password",
  "username": "#email",
  "requestSubmit": "#request-reset",
  "mail": {
    "sender": "security@supplier.example",
    "subjectIncludes": "reset your password",
    "dkimDomain": "supplier.example"
  },
  "linkOrigins": ["https://supplier.example"],
  "newPassword": "#new-password",
  "confirmPassword": "#confirm-password",
  "submit": "#save-password",
  "success": "[data-reset-complete]"
}
```

The adapter checks `expired` after login submission. It reserves a generated password in encrypted storage, requests the reset, consumes a recent authenticated permitted email link, submits the password, updates the vault, and signs in again. A pending password is retained across uncertain outcomes. On the next login Relay tries that candidate, then the previous vault password once if the candidate was rejected. A valid existing session cannot discard a pending password. This prevents losing the new credential after a crash between the website change and the vault update.

Verify every signup/reset adapter on an authorized test account before enabling it for a Dot. Generic schema support does not establish compatibility with a real site's flows.
