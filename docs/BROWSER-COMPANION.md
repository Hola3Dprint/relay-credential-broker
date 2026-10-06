# Shared password autofill in FraudBot's Chrome

This workflow uses one saved website password and one default email. FraudBot chooses and navigates the website; Relay fills its focused login inputs. Company adapters are not used. The extension runs in the same desktop Chrome profile used by the Dot, not in a cloud browser.

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

Automated protocol tests exercise paired-only delivery, no secret in MCP results, origin/focus checks, pairing-code replay, revocation and signup grants. Tests execute the shipped content script against controlled input fixtures to verify its setter and rejection rules. Live Chrome installation, browser pairing and a real Dot-to-field fill must also be verified before claiming end-to-end completion.
