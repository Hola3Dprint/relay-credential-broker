# Fill ChatGPT's native private sign-in form

FraudBot can trigger local autofill before it requests cloud-browser sign-in. Relay's desktop Chrome companion fills the owner-facing ChatGPT private form. When the owner confirms **Sign in**, the native ChatGPT flow sends the values to the remote browser. Neither the MCP result nor the native request result contains a credential.

## Setup

1. Keep Relay and its private tunnel running on the owner's computer.
2. Update/reload **Relay Private Autofill** to version 0.2.2 and reload the Dot's ChatGPT tab in that paired Chrome profile. Existing pairing is retained.
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

## Approval-needed notification

Companion 0.2.2 automatically shows an **Approval needed** notice after it fills a validated private request. The notice names the destination website, the browser tab title shows **Approval needed**, and the extension's toolbar badge shows **!**. No new extension permissions or separate notification permission are required. This is a notification inside paired desktop Chrome, not a Windows push notification or mobile alert.

**Show request** brings the matching open private form into view, or opens its uniquely matching collapsed native request. It does not click the final Sign in control. **Dismiss notice** removes Relay's notice without approving or cancelling ChatGPT's request. The notice clears when the request closes or expires, and its toolbar badge clears on navigation. Notification text and metadata contain only the destination hostname/origin, never filled email/password values. Relay does not choose controls by screen-wide color or size.

## Automatic initiation and failure limit

For an authorized task, FraudBot should check for an active website session first and initiate the supported Relay workflow when a fresh sign-in is needed. ChatGPT's native **Sign in** confirmation remains an owner action. [OpenAI's Dot controls guide](https://learn.chatgpt.com/docs/dots/controls) states that custom rules cannot remove required sign-in confirmations. A verified active website session can be reused until the website expires it; an automatic approval click is not part of Relay.

FraudBot must persist a failure count per website/account in its notes, including across requests, tabs and delegated work. After two failed attempts, it must stop triggering all autofill or sign-in routes for that account until the owner explicitly authorizes another attempt. A definitively blocked fill or a rejected website sign-in counts once per complete attempt. Username/password fields and repeated status reads do not count as separate failures. A verified successful sign-in resets the count. Authorized fake probes and owner cancellations do not count, but a cancellation still requires a new owner request to retry. Resolve an unknown result safely before retrying, and stop sooner when native browser guidance requires it. Switching tools, tabs, tasks or identity-provider hosts must not evade the limit.

This limit is managed by the agent, not a broker authentication lock: Relay knows whether it filled the form, while FraudBot observes whether the website accepted the sign-in.

## Scope

This supports the observed web private form on `https://chatgpt.com/dots/<configured-id>` with standard visible native username/password controls. It validates the private form's privacy marker, dialog, destination address, accessible form name, field metadata and short-lived form nonce. Changed forms, stale routing and replay are rejected. Requests expire, older armed destinations are superseded, and grants are rechecked before delivery. The paired extension remains a trusted credential boundary.

No company adapter is needed. Signup, password changes, method selection, passkeys, CAPTCHA and verification-code widgets remain in the native/owner workflow. The shared password must still match the website's existing account.

## Non-submitting test

Use `prepare_private_signin({"origin":"https://test-target.example","demo":true})` only for an authorized non-submitting probe. Demo mode uses the repository's public fake username/password, never the saved shared credential, and requires the client's `relay-demo:business` account grant. Open the matching native request, verify the local fill status, then choose **Not now** without submitting or saving a login.

## Verification

On October 6, 2026, FraudBot completed a live, non-submitting test through the installed nine-tool connection and paired desktop Chrome companion 0.2.1. It armed `demo:true` for GitHub, then opened the native request. Relay opened and filled the matching private form with public fake credentials. A scoped SDK client and FraudBot independently confirmed `FILLED`; the password remained masked and Save to Passwords remained unchecked. The request was cancelled with **Not now** and returned `declined`. No sign-in was submitted, no authentication was verified, and no real credential was delivered.

All 48 automated tests, type checks and the production build passed locally, and the Windows and macOS jobs passed in [GitHub Actions run 37430565436](https://github.com/Hola3Dprint/relay-credential-broker/actions/runs/37430565436). Tests cover the shipped private-form setter, credential-free metadata/results, wrong transport/Dot/website, changed fields, nested destination labels, separate duplicate labels, stale nonce, expiry, replay, revocation and demo-secret isolation. The owner's actual Mac and real website sign-ins remain untested.

The [official Dot computer guide](https://learn.chatgpt.com/docs/dots/computers-and-apps) describes private sign-in and optional saved-login reuse. Relay preserves ChatGPT's own sign-in confirmation and does not use undocumented backend endpoints.
