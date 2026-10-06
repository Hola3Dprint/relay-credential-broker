# Relay on your own Mac

Run the broker and Relay Private Autofill in ordinary Chrome on the same Mac. FraudBot uses that connected Mac's Chrome for the task. This does not install the companion into FraudBot's separate managed cloud browser.

## Requirements

- macOS 14 or later, on Apple silicon or Intel.
- Node.js 22 or newer; Node.js 24 is recommended.
- Ordinary Google Chrome with permission to load an unpacked extension.
- Access to this private GitHub repository or the source-only Mac ZIP.

Playwright's current [system requirements](https://playwright.dev/docs/intro#system-requirements) include macOS 14+. Chrome documents [loading an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Install and launch

Extract the source ZIP, or clone the repository using your existing GitHub authorization. In a local terminal inside the extracted repository:

```sh
npm run setup:mac
npm run start:mac
```

Setup installs the locked Node dependencies and the demo browser, then builds Relay. The launcher checks macOS/Node versions and refuses to start a second broker on port 4318. On the first launch it asks for a vault unlock passphrase of at least 20 characters and a confirmation. The terminal does not echo the input. Subsequent launches ask for the same vault unlock passphrase.

This passphrase protects the encrypted vault; it is separate from the one shared website password. The launcher passes it to Relay in the child-process environment, without saving it to a plaintext file or placing it in command arguments. It opens the authenticated local console. Keep that terminal open; Control-C stops the broker and any tunnel started by this launch.

In the console, select **Start setup → Portable passphrase**, complete setup, and run the local demo. Save the shared email/password locally and create a Dot client with the desired fill grants. Install `browser-companion/` in Chrome through Developer mode and **Load unpacked**, review its page permissions, then pair it using the console's one-time code. See [BROWSER-COMPANION.md](BROWSER-COMPANION.md). Reload login pages opened before installation.

The initial Mac implementation uses the existing AES-GCM/scrypt portable vault mode. Native macOS Keychain protection, LaunchAgent startup and automatic unlock after reboot are not implemented. No Windows TPM/DPAPI fallback or vault conversion occurs. Create a fresh Mac vault and enter the website credential locally; a copied Windows-protected vault is refused.

## Connect FraudBot privately

Connect the Mac through FraudBot's profile under **Computers → Your computer → Allow access**, and review the displayed permission. OpenAI currently allows one connected personal computer at a time. The cloud computer remains separate. See the [official Dot computer guide](https://learn.chatgpt.com/docs/dots/computers-and-apps).

Create a scoped client in the Mac Relay console and a dedicated Mac tunnel in OpenAI Platform. Use a separate tunnel from the still-running Windows installation while testing; two workers with separate vaults must not compete for one tunnel. Download the official `tunnel-client` release for your CPU: `darwin-arm64` on Apple silicon or `darwin-amd64` on Intel. Verify its published SHA-256 and extract the full bundle into `data/tools/tunnel-client/`, including its companion runtime files. Give the `tunnel-client` binary execute permission if needed.

Prepare non-secret connection metadata:

```sh
node scripts/connect-dot.mjs '<client-id-from-Mac-Relay>' '<Mac-tunnel-id>'
```

Provision the dedicated runtime credential through secure OpenAI key setup in Codex on the Mac. Approve the Mac repository's ignored `.env.local` destination and restrict it to the owner (`chmod 600 .env.local`). Keep credentials out of chat. The runner rejects a symlink, a file owned by another user or a credential file readable by the group/others. Do not copy the Windows runtime credential or vault as part of the source ZIP.

Stop the current Mac launcher, then start it with the private connection enabled:

```sh
npm run start:mac -- --with-dot
```

The launcher supplies the vault unlock passphrase to the official client's local MCP process and invokes its init, doctor and connect commands. The runner redacts credential and unlock values from diagnostics. In ChatGPT, connect the Mac tunnel as **Relay Mac** and enable that app for FraudBot. Follow [CHATGPT-DOTS.md](CHATGPT-DOTS.md) for the custom MCP connection and tool checks, using this Mac helper in place of the Windows PowerShell preparation script.

Ask FraudBot to use **Relay Mac** and the connected Mac's Chrome for the fake demo first. Verify `FILLED` for username/password/TOTP and the visible `/account` page before attempting real accounts. Do not treat the managed cloud browser or the old Windows Relay app as the Mac target.

## Verification

The repository includes a macOS GitHub Actions job for the full test/build suite and a separate launcher smoke check. That check starts the compiled broker with a public test-only passphrase, stops it, restarts it against the same encrypted temporary vault and verifies that the passphrase never appears in launcher output. It does not use real credentials, connect an OpenAI tunnel or install Chrome extensions.

The owner's actual Mac installation, local private credential setup, Chrome pairing and live Dot-to-Mac fill still require verification on that Mac. Portable software validation is not proof of those live connections.
