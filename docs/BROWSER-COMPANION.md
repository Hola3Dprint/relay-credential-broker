# Shared password autofill in FraudBot's Chrome

This workflow uses one saved website password and one default email. FraudBot chooses and navigates the website; Relay fills its focused login inputs. Company adapters are not used. The extension runs in the same desktop Chrome profile used by the Dot, not in a cloud browser.

## FraudBot's cloud computer

The successful live fill test used the owner's connected Windows Chrome. It did not install Relay inside the separate computer shown as **FraudBot's computer** in ChatGPT.

On October 5, 2026, FraudBot inspected that cloud environment using read-only supported tools. It reported Debian 13.6 on x86_64, Node.js 24.19.0, npm 11.9.0, Python 3.12.14 and Git 2.52.0. These runtimes can support Relay's Node broker and portable passphrase key mode, but no cloud broker installation or local-listener test was performed. Windows TPM/DPAPI-protected vaults cannot simply be copied there.

The actual managed cloud Chrome rejected `chrome://extensions/` under its HTTP/HTTPS-only navigation policy and exposed no supported extension-install capability. Relay's native fill path requires its companion in the target browser, so installing only the broker would not enable fills in that managed browser. Do not bypass this restriction through browser flags, profile edits or alternate control methods. Cloud service survival across environment restarts also remains unverified.

The current supported Relay path is the connected desktop Chrome profile with the paired companion and broker on the same Windows machine. ChatGPT's separate private cloud sign-in flow is described in the [official Dot computer guide](https://learn.chatgpt.com/docs/dots/computers-and-apps); the current Relay plugin has no integration with that private sign-in mechanism.

## One-time installation

1. Open `chrome://extensions` in the Chrome profile FraudBot uses. Enable Developer mode, click **Load unpacked**, and select this repository's `browser-companion` directory. This locally built extension needs access to HTTPS pages to find the focused login input, and to `http://127.0.0.1:4318` to contact Relay. Review those permissions before installing.
2. In the authenticated Relay console, open **Settings → Chrome autofill companion → Configure → Create pairing code**. Copy the code, open the **Relay Private Autofill** extension popup, paste it there, and click **Pair this browser**. The code expires in five minutes and works once. Never paste it in chat. The extension keeps a separate browser-only token in Chrome's local extension storage.
3. Save or generate the single password under **Settings → Shared website credential**. Under **Connected clients → Manage access**, enable shared browser autofill. For signup, also enable both the credential's new-account setting and the Dot's signup permission. These are owner-controlled grants; they are not enabled automatically.

Reload an already-open login page after installing the extension so its content script is present. Keep Relay and the private tunnel running. Refresh the connected MCP plugin's tool catalog in ChatGPT if it still lists only the original four tools. The catalog now has seven tools.

## Dot workflow

```text
Open the requested site in the paired regular Chrome browser.
Focus its email input.
fill_saved_username({origin: "https://current-site.example"})
Focus its password input.
fill_saved_password({origin: "https://current-site.example"})
Verify FILLED, then continue the site's sign-in flow normally.
```

For a new-account form, use `purpose: "signup"` on the fill call. Focus and fill the password confirmation input separately with the same tool and purpose. The password is saved once; signup does not generate a different password for each company. `FILLED` confirms the field value was set, not successful signup or authentication. The Dot verifies the website's result. It must respect host and site confirmations.

No clipboard password copy is needed. The MCP result contains only status, origin and field. The value goes over the authenticated loopback channel directly to the paired extension, which uses the native input setter and normal input/change events. It refuses a stale focus nonce, a mismatched origin/type, a form that posts to another origin, and password-change forms. The broker rechecks the client's grant before delivery. Ambiguous matching tabs require `tabId`.

## Scope and limits

Standard visible native HTML inputs are supported. Same-origin frames are supported; cross-origin frames, closed shadow roots, custom non-input editors, passkeys, SMS, push approval and CAPTCHA are not handled by this companion. A site's password rules and existing account password still determine whether the shared value is accepted. This extension does not click Submit, accept terms, change passwords, submit applications or turn off ChatGPT safeguards. The AI performs the rest of the authorized browser task using its own browser tools.

The optional `fill_saved_totp` uses an explicitly enrolled account's TOTP seed; one shared password does not imply that all sites share a TOTP seed. Shared email-code retrieval requires separately configured mailbox authority and is not added by this extension.

Revoke the browser in Relay's Chrome companion dialog or remove the extension to stop future delivery. Revoke or edit the Dot client separately to remove autofill authority. A shared credential grants the opted-in Dot fill capability on the exact HTTPS origin it requests; this is broader than a per-account grant and is displayed explicitly in the local console.

## Verification status

`list_accounts` reports the saved shared credential separately from browser readiness. With no paired extension it returns `BLOCKED: BROWSER_COMPANION_NOT_PAIRED`; with only offline paired extensions it returns `BLOCKED: BROWSER_COMPANION_OFFLINE`. `READY_TO_FILL` means a paired browser has contacted Relay recently. The requested input still needs matching, current focus; otherwise a fill returns `NO_MATCHING_FOCUSED_FIELD`. Codex or ChatGPT browser control access is a separate connection from Relay Private Autofill pairing.

The extension's background worker can idle. An offline status before focusing a login input can reflect the absence of recent contact. Open a fresh login page in the paired Chrome profile, or reload a page opened before installation, then focus a recognized email or password input before calling the fill tool. The focused field sends fresh metadata and wakes the companion. Opening the extension popup performs a one-time connection check; keeping it open is not required for filling.

Automated protocol tests exercise paired-only delivery, no secret in MCP results, origin/focus checks, pairing-code replay, revocation and signup grants. Tests execute the shipped content script against controlled input fixtures to verify its setter and rejection rules. On October 5, 2026, native desktop Chrome was paired and an official MCP client filled the local demo's email, password and TOTP fields; all three calls returned `FILLED`, and the website reached `/account` with the heading **You are signed in**. FraudBot then independently completed the same test through its installed ChatGPT connection in a fresh desktop Chrome tab, confirming all three `FILLED` results and the visible authenticated page. This verifies the Dot-to-companion path using fake credentials. Real employer authentication and the shared password's acceptance by external sites remain unverified.
