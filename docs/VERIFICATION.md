# Verification record

Verified locally on Windows on October 5, 2026. This record distinguishes implemented behavior from integrations that still require the owner's provider enrollment.

## Functional checks

The October 5 focus investigation found that the observed native email input was recognized correctly but no browser companion was paired. Fixed `list_accounts` and fill calls to distinguish missing pairing, offline pairing and unmatched focus. The updated 36-test suite, type checks and build passed. The live official MCP stdio client now reports `credentialSaved: true` and `BLOCKED: BROWSER_COMPANION_NOT_PAIRED` for both shared readiness and a fixture-origin username fill. The shared password is saved locally; companion pairing and actual field filling remain unverified.

- TypeScript type checks and production React/Vite build passed.
- 34 tests passed across encryption, RFC 6238 TOTP, exact origins and task URLs, email code/link filtering and DKIM trust, real Chromium authentication, encrypted session restoration, expired-session renewal, modal sign-in, concurrent login deduplication, pending-reset fallback, human-verification blocking, serialized storage, admin/client separation, MCP HTTP initialization and tool calls, grant editing and immediate revocation. New tests cover one shared credential across origins, companion-only delivery, no secret in Dot responses, stale/ambiguous focus, pairing-code replay, revoked grants, signup approval and the shipped content script's input setter and rejection rules.
- A separate official MCP stdio client discovered all seven tools, listed its scoped demo account, ensured password/TOTP sign-in, and read the authenticated catalog page. Run `node scripts/verify-mcp.mjs --client-id <your-demo-client-id>` to reproduce while the broker and demo fixture are running.
- GitHub Actions run `37410123663` passed for commit `7bb8cb2`, including tests, type checks, production build and companion JavaScript syntax checks.
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

The official managed runtime reports a running process, healthy and ready. Its remote metadata fetch succeeded. ChatGPT created and connected **Relay Credential Broker** through that private tunnel and discovered exactly `list_accounts`, `ensure_login`, `read_account_page` and `create_account`. The installed app displays Connected. The only enrolled account and client permission are the non-production local demo; signup is disabled by the broker grant.

FraudBot then completed a live test through the installed Relay connection: `list_accounts` found `relay-demo / business`, `ensure_login` returned `AUTHENTICATED` with `reused: false`, and `read_account_page` returned PLA and PETG filament availability. FraudBot acknowledged the workflow and the isolated-browser boundary. No real account was enrolled, created or changed, and no application was submitted in this test. The private installation and Dot screenshots remain local deliverables rather than repository screenshots.

## External checks still required

Shared password setup, the default-email save, the generated-password option, Chrome pairing instructions and the existing client permission dialog were checked through the Codex in-app browser. The Browser plugin was not available; the available CUA browser controlled all UI interactions. Page identity, meaningful DOM content, absence of an error overlay, console error/warning logs and actual interactions passed. Checked desktop/default viewport and 390 × 844 mobile sizing. Fixed a mobile dialog-button overflow; final dialog scroll width equals client width. Temporary viewport sizing was reset. Screenshots are local outputs, not repository artifacts.

The connected ChatGPT app's description and tool catalog were refreshed in place. Its tool detail dialog now lists six write tools and one read tool, including `fill_saved_username`, `fill_saved_password` and `fill_saved_totp`, while retaining the same app and connection IDs. The browser companion has not yet been installed or paired, and live Dot-to-field filling has not yet been verified. The real shared password has not been saved or generated. No Boeing-specific adapter was added and no Boeing account was created. The original four-tool live test remains valid for the isolated demo; a companion installation and live fill test are still required.

No real Bitwarden machine account, authentication mailbox, supplier signup/reset adapter, installed Windows service or machine reboot was configured during development. The current installation runs the broker and managed tunnel without a boot service. The code and setup path are included; real account operation depends on the owner's account credentials, site adapter correctness and Windows service identity.

The local runtime is configured with TPM protection and the non-production demo only. Runtime vault files and client tokens are excluded from the GitHub repository.
