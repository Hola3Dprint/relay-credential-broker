# Fill ChatGPT's native private sign-in form

FraudBot can trigger local autofill before it requests cloud-browser sign-in. Relay's desktop Chrome companion fills the owner-facing ChatGPT private form. When the owner confirms **Sign in**, the native ChatGPT flow sends the values to the remote browser. Neither the MCP result nor the native request result contains a credential.

## Setup

1. Keep Relay and its private tunnel running on the owner's computer.
2. Update/reload **Relay Private Autofill** to version 0.2.0 and reload the Dot's ChatGPT tab in that paired Chrome profile. Existing pairing is retained.
3. In Relay's **Connected clients → Edit access**, enable browser autofill and enter the exact Dot address in **Dot address for private sign-in**. This separately enables private-form fill access for that Dot. Leave the address blank to disable it.
4. Refresh the connected ChatGPT plugin's catalog. The nine tools include `prepare_private_signin` and `private_signin_status`.
5. Keep the configured Dot chat open in paired desktop Chrome. The local computer/browser must be online.

## Dot workflow

Before awaiting the supported native `browserAuth.request`, call `prepare_private_signin`:

```json
{ "origin": "https://actual-sign-in-host.example" }
```

Use the current sign-in page's exact HTTPS origin, including any legitimate identity-provider host. An `ARMED` result starts a five-minute, single-use intent and returns a non-secret `requestId`.

Then issue the normal native request using fields actually visible on the website. The companion opens only a unique matching native sign-in card in the configured Dot tab. It verifies the displayed website address and the actual private form before filling username/password fields. The owner confirms **Sign in**. The companion never clicks Sign in, Save to Passwords, takeover, or a sign-in method choice. The native request remains pending until the owner acts.

After the native request returns, `private_signin_status({"requestId":"…"})` reports `ARMED`, `DELIVERED`, `FILLED`, or `BLOCKED`. These are fill states, not proof of website authentication. Verify the website through supported native browser observations. Respect a decline, an unavailable request, site errors and host approvals.

## Scope

This supports the observed web private form on `https://chatgpt.com/dots/<configured-id>` with standard visible native username/password controls. It validates the private form's privacy marker, dialog, destination address, accessible form name, field metadata and short-lived form nonce. Changed forms, stale routing and replay are rejected. Requests expire, older armed destinations are superseded, and grants are rechecked before delivery. The paired extension remains a trusted credential boundary.

No company adapter is needed. Signup, password changes, method selection, passkeys, CAPTCHA and verification-code widgets remain in the native/owner workflow. The shared password must still match the website's existing account.

## Non-submitting test

Use `prepare_private_signin({"origin":"https://test-target.example","demo":true})` only for an authorized non-submitting probe. Demo mode uses the repository's public fake username/password, never the saved shared credential, and requires the client's `relay-demo:business` account grant. Open the matching native request, verify the local fill status, then choose **Not now** without submitting or saving a login.

## Verification

Automated tests cover the shipped private-form setter, credential-free metadata/results, wrong transport/Dot/website, changed fields, stale nonce, expiry, replay, revocation and demo-secret isolation. An empty live native GitHub request was inspected and declined, confirming standard private inputs, a visible destination and the awaited owner-response behavior. Live extension update and end-to-end trigger/fill require separate verification; do not infer them from those tests.

The [official Dot computer guide](https://learn.chatgpt.com/docs/dots/computers-and-apps) describes private sign-in and optional saved-login reuse. Relay preserves ChatGPT's own sign-in confirmation and does not use undocumented backend endpoints.
