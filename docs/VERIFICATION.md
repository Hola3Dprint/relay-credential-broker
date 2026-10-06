# Verification record

Verified locally on Windows on October 5, 2026. This record distinguishes implemented behavior from integrations that still require the owner's provider enrollment.

## Functional checks

The October 5 focus investigation found that the observed native email input was recognized correctly but no browser companion was paired. Fixed `list_accounts` and fill calls to distinguish missing pairing, offline pairing and unmatched focus. After the owner installed and paired Relay Private Autofill, a fresh native Chrome demo page and focused input woke the companion. An official MCP stdio client returned `FILLED` for username, password and TOTP; submitting the fake login and verification forms reached `/account` with the heading **You are signed in**. Credential values were not exposed in the MCP responses. The shared password is saved locally; no real employer account was tested.

- TypeScript type checks and production React/Vite build passed.
- 36 tests passed across encryption, RFC 6238 TOTP, exact origins and task URLs, email code/link filtering and DKIM trust, real Chromium authentication, encrypted session restoration, expired-session renewal, modal sign-in, concurrent login deduplication, pending-reset fallback, human-verification blocking, serialized storage, admin/client separation, MCP HTTP initialization and tool calls, grant editing and immediate revocation. New tests cover one shared credential across origins, companion-only delivery, no secret in Dot responses, stale/ambiguous focus, pairing-code replay, revoked grants, signup approval, readiness status and the shipped content script's input setter and rejection rules.
- A separate official MCP stdio client discovered all seven tools, listed its scoped demo account, ensured password/TOTP sign-in, and read the authenticated catalog page. Run `node scripts/verify-mcp.mjs --client-id <your-demo-client-id>` to reproduce while the broker and demo fixture are running.
- GitHub Actions run `37412607098` passed the verification job for commit `d851c09`, including tests, type checks, production build and companion JavaScript syntax checks.
- Windows TPM bootstrap completed through the console. A separate Node process opened the same protected store successfully, verifying wrap and unwrap through Microsoft Platform Crypto Provider.
- Native .NET 8 service host compiled with no warnings or errors. All PowerShell helper scripts passed parser validation.
- The optional service-credential helper passed a CurrentUser DPAPI round trip in an isolated non-secret fixture. The real runtime key was not copied to a service credential file; boot service installation remains disabled on the development machine.
- npm reported zero known vulnerabilities; NuGet reported no vulnerable direct or transitive packages for the service host at verification time.

## UI verification

Concept: `docs/dashboard-concept.png`, generated with the built-in image tool. Final browser captures: `docs/dashboard-before-setup.png`, `docs/dashboard.png`, `docs/dashboard-mobile.png`, and `docs/dot-connection.png`.

Used the Codex in-app browser directly; no Playwright fallback was needed for UI verification. Requested the concept's 1505 × 1045 viewport; the IAB measured 1506 × 1046 because of its sizing rounding. Also checked the ordinary app-browser viewport and 390 × 844 mobile mode. Temporary viewport overrides were reset. Used `view_image` to inspect the concept and final desktop/mobile captures in the same QA pass.

| Comparison             | Concept and rendering evidence                                                           | Result / correction                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Layout                 | White left rail, large heading, mint setup band, account list, two lower panels          | Preserved; removed the generated operating-system title bar from the web app                                       |
| Typography             | Navy sans-serif headings and legible compact UI controls                                 | Bundled Inter locally to replace an unavailable font fallback                                                      |
| Color                  | True-white rail and panels, cool light-gray canvas, teal actions, mint selection         | Explicit palette tokens; no imagery overlays or added gradients                                                    |
| Spacing and containers | Open main flow, one setup band, bordered account list and lower panels                   | Corrected desktop gutters and empty-state height to match the concept                                              |
| Icons                  | Thin shield, home, user, activity and settings outlines                                  | Consistent outline icons and stroke weight                                                                         |
| Copy                   | Original heading, subtitle, setup text, account empty state, three steps, activity state | Initial above-the-fold copy matches; live setup/account/activity states intentionally change with real broker data |
| Responsive behavior    | Same order and component system extended to mobile                                       | Fixed navigation overflow; mobile document scroll width equals its 375px client width within the 390px viewport    |

The initial dashboard was faithfully verified against the concept, with no material remaining visual mismatch. Intentional deviations are the omitted OS title bar, connection indicators reflecting actual console authentication, and functional state changes after setup/login. Forms, errors, settings and the Dot grant dialog extend the same design system to the required workflows.

Verified console authentication, TPM setup, local demo enrollment and TOTP sign-in, subsequent login check, creation of a demo-only Dot client grant, the generated connection instructions, protected console access, and mobile navigation. Desktop screenshots show a real local demo account and real audit events, never invented production accounts or metrics.

## Live ChatGPT connection

On October 5, 2026, installed the official Windows amd64 tunnel-client 0.0.15 after checking its release SHA-256. Provisioned a dedicated Relay tunnel associated with the target ChatGPT workspace and a dedicated runtime credential through secure key setup. The ignored `.env.local` file is restricted to the owner and SYSTEM; it is not committed.

The official managed runtime reported a running process, healthy and ready. Its remote metadata fetch succeeded. ChatGPT initially created and connected **Relay Credential Broker** through that private tunnel and discovered `list_accounts`, `ensure_login`, `read_account_page` and `create_account`. The installed app displayed Connected. That first test used only the non-production local demo, with signup disabled. The later seven-tool catalog and shared credential grant are recorded below.

FraudBot then completed a live test through the installed Relay connection: `list_accounts` found `relay-demo / business`, `ensure_login` returned `AUTHENTICATED` with `reused: false`, and `read_account_page` returned PLA and PETG filament availability. FraudBot acknowledged the workflow and the isolated-browser boundary. No real account was enrolled, created or changed, and no application was submitted in this test. The private installation and Dot screenshots remain local deliverables rather than repository screenshots.

After Chrome companion pairing, FraudBot independently ran a second test through the installed seven-tool connection in a fresh regular desktop Chrome tab. `fill_saved_username`, `fill_saved_password` and `fill_saved_totp` all returned `FILLED`. FraudBot clicked the demo's Sign in and Verify controls, then confirmed `http://127.0.0.1:4320/account` with the visible heading **You are signed in**. A temporary browser inspection conflict interrupted its first final-page check; a read-only recheck succeeded without repeating any fills or submissions. This test used native browser autofill, without `ensure_login` or `read_account_page`. No real credentials or employer accounts were tested. Both the authenticated-page capture and FraudBot's result capture are private local deliverables.

## Cloud computer preflight

The owner subsequently requested Relay inside FraudBot's own cloud computer. FraudBot's read-only inspection reported Debian 13.6/x86_64 with Node.js 24.19.0, npm 11.9.0, Python 3.12.14 and Git 2.52.0. Writable workspace paths and ongoing-command support were reported; no files were created and no local listener or restart persistence was tested. Upload/Library materialization and GitHub connector tools were available, but private clone access was not verified.

The managed cloud Chrome blocked `chrome://extensions/` under an HTTP/HTTPS-only navigation policy. Its supported browser API exposed no extension-install capability. No software, companion, vault credential or tunnel key was installed or transferred to that cloud computer. The broker's portable key mode alone cannot provide native autofill without a supported companion delivery path. The working Windows connection remains in place. See BROWSER-COMPANION.md for the environment distinction and current limitation.

## Mac package verification

The owner requested installation on their own Mac. Added a Mac setup/start launcher, a cross-platform non-secret connection preparation helper and a Unix binary/credential-permission path in the private tunnel runner. The Mac launcher uses the existing portable AES-GCM/scrypt vault mode with local hidden passphrase entry. It refuses copied Windows key protectors and an occupied broker port, handles startup cancellation and stops a tunnel started by its launch.

The macOS job in [GitHub Actions run 37417111743](https://github.com/Hola3Dprint/relay-credential-broker/actions/runs/37417111743) passed for code commit `205c986`: the existing test suite, type checks, production build, helper syntax checks and Mac broker startup/restart verification. The smoke check reopened the same encrypted temporary vault, verified clean shutdown and checked that the public test-only unlock passphrase did not appear in launcher output. The first launcher check exposed a startup/shutdown race, which was fixed before this passing run. Windows local checks also passed all 36 tests and the build.

The source-only Mac ZIP was checked for the Mac guide/launcher and absence of runtime data, dependencies and credential env files. The owner's actual Mac was not accessed or installed during this Windows session. Mac Chrome pairing, live Dot tunnel calls, private credential setup and real website fills still require verification on that Mac. Native Keychain/automatic reboot unlock is not implemented. See MAC.md for the target-machine setup.

## Native private sign-in trigger

On October 6, 2026, added `prepare_private_signin` and `private_signin_status`, a separate per-Dot access setting, and companion 0.2.0. The trigger arms a five-minute intent before the native request waits for an owner response. The companion matches the native private form and fills it locally; it never confirms Sign in or Save to Passwords. Full TypeScript, 47 tests across seven files, and production build passed. Tests exercise wrong Dot/origin, current grants, expiry, stale/changed forms, replay, credential-free results and demo isolation.

An empty native GitHub sign-in request was opened in FraudBot's actual owner-facing Chrome chat. Its current form showed the exact GitHub origin and standard username/password fields. The request was declined with no values entered; FraudBot confirmed the awaited request returned only after the owner response. The owner approved private-form access, which was saved for the existing client and bound to FraudBot's exact Dot address. The managed tunnel was restarted, and a scoped official MCP SDK client discovered all nine tools. The installed app description was updated and its catalog refresh initiated.

The owner reloaded Relay Private Autofill and closed an extension popup. Opening the configured FraudBot chat in the paired Chrome profile reconnected the companion; the scoped SDK check then returned `READY_TO_FILL`. The managed tunnel's status was healthy and ready, and its official diagnostic command passed. The installed app's details still showed the old seven-tool catalog on the last successful observation. Subsequent Chrome browser-control calls timed out, so catalog refresh completion and the non-submitting public-fake-credential test remain unverified. No credential was delivered. The private-form setter and trigger have not yet passed a live extension test. Both Windows and macOS jobs in [GitHub Actions run 37427678924](https://github.com/Hola3Dprint/relay-credential-broker/actions/runs/37427678924) passed for code commit `1a78937`.

## Remaining external checks

Shared password setup, the default-email save, the generated-password option, Chrome pairing instructions and the existing client permission dialog were checked through the Codex in-app browser. The Browser plugin was not available; the available CUA browser controlled all UI interactions. Page identity, meaningful DOM content, absence of an error overlay, console error/warning logs and actual interactions passed. Checked desktop/default viewport and 390 × 844 mobile sizing. Fixed a mobile dialog-button overflow; final dialog scroll width equals client width. Temporary viewport sizing was reset. Screenshots are local outputs, not repository artifacts.

The connected ChatGPT app's description and tool catalog were refreshed in place. Its tool detail dialog lists six write tools and one read tool, including `fill_saved_username`, `fill_saved_password` and `fill_saved_totp`, while retaining the same app and connection IDs. The owner enabled the shared login/signup fill grant and saved the shared password locally. FraudBot confirmed the seven tools and acknowledged the generic browser workflow. Its earlier username fill was blocked before companion pairing. The companion is now paired, and the official MCP client completed the native Chrome fake-account test described above. Native page identity, visible authenticated content and all three fill interactions passed, with no console errors or warnings. The screenshot remains a private local deliverable. No Boeing-specific adapter was added and no Boeing account was created.

No real Bitwarden machine account, authentication mailbox, supplier signup/reset adapter, installed Windows service or machine reboot was configured during development. The current installation runs the broker and managed tunnel without a boot service. Shared autofill depends on browser pairing, compatible native inputs and each site's authentication requirements. The optional legacy broker workflows still depend on their configured adapters.

The local runtime has TPM protection, the non-production demo and an owner-saved shared credential. Runtime vault files and client tokens are excluded from the GitHub repository.
