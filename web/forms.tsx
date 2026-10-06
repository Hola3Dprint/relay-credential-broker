import { useState, type FormEvent } from "react";
import { ShieldCheck, CheckCircle2, Terminal, Copy } from "lucide-react";
import { api, type State, type Client } from "./api";
import { Button, Field } from "./components";
type Done = { onDone: () => void };
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Operation failed";
export function SetupForm({
  onDone,
  initialProtection,
}: Done & { initialProtection: string }) {
  const [mode, setMode] = useState(
    initialProtection === "passphrase" ? "passphrase" : "tpm",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/setup", { protection: mode });
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="form-intro">
        <ShieldCheck size={36} />
        <p>
          Protect your accounts on this device. After setup, enroll each website
          once.
        </p>
      </div>
      <Field label="Key protection">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="tpm">Windows TPM · hardware protected</option>
          <option value="dpapi">Windows DPAPI · this user account</option>
          {initialProtection === "passphrase" && (
            <option value="passphrase">
              Portable passphrase · development
            </option>
          )}
        </select>
      </Field>
      <p className="subtle">
        TPM setup requires a compatible, available Windows TPM. It reports an
        error if hardware protection cannot be established.
      </p>
      <div className="setup-list">
        <span>
          <CheckCircle2 size={16} />
          Encrypted credential and browser storage
        </span>
        <span>
          <CheckCircle2 size={16} />
          Private TOTP generation
        </span>
        <span>
          <CheckCircle2 size={16} />
          Scoped access for ChatGPT Dots
        </span>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Button busy={busy} type="submit">
        Set up broker
      </Button>
    </form>
  );
}
export function AccountForm({ onDone, state }: Done & { state: State }) {
  const [mode, setMode] = useState("native");
  const [generate, setGenerate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (mode === "configured")
    return (
      <>
        <Button secondary onClick={() => setMode("native")}>
          Use browser autofill
        </Button>
        <ConfiguredAccountForm onDone={onDone} />
      </>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(e.currentTarget);
        try {
          await api("/shared-credential", {
            email: data.get("email"),
            generate,
            signup: data.get("signup") === "on",
            ...(!generate ? { password: data.get("password") } : {}),
          });
          onDone();
        } catch (e) {
          setError(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="subtle">
        One email and one shared website password. FraudBot navigates each site,
        focuses a login field, and calls Relay to fill it privately. No company
        adapters or separate enrollments are needed.
      </p>
      <Field label="Default email">
        <input
          name="email"
          type="email"
          defaultValue={state.enrollmentEmail ?? ""}
          autoComplete="email"
          required
        />
      </Field>
      {!state.sharedCredentialConfigured && (
        <label className="check">
          <input
            type="checkbox"
            checked={generate}
            onChange={(e) => setGenerate(e.target.checked)}
          />
          Generate my shared password once
        </label>
      )}
      {generate ? (
        <p className="subtle">
          Relay generates a random password and stores it in the encrypted
          vault. The password is never returned to FraudBot.
        </p>
      ) : (
        <Field
          label={
            state.sharedCredentialConfigured
              ? "Shared password (leave blank to keep saved password)"
              : "Shared website password"
          }
        >
          <input
            name="password"
            type="password"
            autoComplete="off"
            required={!state.sharedCredentialConfigured}
          />
        </Field>
      )}
      <label className="check">
        <input
          type="checkbox"
          name="signup"
          defaultChecked={state.sharedSignup ?? false}
        />
        Allow this shared password in new-account forms
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy}>
        {generate
          ? "Generate and save shared credential"
          : "Save shared credential"}
      </Button>
      <Button secondary type="button" onClick={() => setMode("configured")}>
        Use a configured broker workflow
      </Button>
    </form>
  );
}
function ConfiguredAccountForm({ onDone }: Done) {
  const [provider, setProvider] = useState("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = (key: string) => String(f.get(key) ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const origin = advanced.trim() ? "" : new URL(value("origin")).origin;
      const site = advanced.trim()
        ? JSON.parse(advanced)
        : {
            id: value("id"),
            name: value("name"),
            identity: value("identity") || "business",
            origins: [origin],
            login: {
              url: new URL(value("loginUrl"), origin).href,
              ...(value("openSelector") ? { open: value("openSelector") } : {}),
              username: value("usernameSelector"),
              password: value("passwordSelector"),
              submit: value("submitSelector"),
              success: value("successSelector"),
            },
            sessionCheckUrl: new URL(value("checkUrl"), origin).href,
            taskPages: value("taskPages")
              .split("\n")
              .filter(Boolean)
              .map((v) => new URL(v, origin).href),
            ...(value("totpInput")
              ? {
                  mfa: {
                    input: value("totpInput"),
                    submit: value("totpSubmit"),
                    method: "totp",
                  },
                }
              : {}),
          };
      const credential =
        provider === "local" && value("username")
          ? {
              username: value("username"),
              password: String(f.get("password") ?? ""),
              ...(value("totpSecret")
                ? { totpSecret: value("totpSecret") }
                : {}),
              recoveryCodes: value("recoveryCodes").split("\n").filter(Boolean),
            }
          : undefined;
      await api("/accounts", {
        site,
        binding:
          provider === "local"
            ? { provider }
            : { provider, secretId: value("secretId") },
        ...(credential ? { credential } : {}),
      });
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="subtle">
        Enroll a site you own or are authorized to use. Secrets go directly to
        your local broker.
      </p>
      <div className="form-grid">
        <Field label="Account name">
          <input
            name="name"
            placeholder="Supplier account"
            required={!advanced}
          />
        </Field>
        <Field label="Site identifier">
          <input
            name="id"
            placeholder="supplier-x"
            pattern="[a-z0-9][a-z0-9_-]{0,63}"
            required={!advanced}
          />
        </Field>
        <Field label="Identity">
          <input name="identity" defaultValue="business" />
        </Field>
        <Field label="Website origin">
          <input
            name="origin"
            placeholder="https://supplier.example"
            type="url"
            required={!advanced}
          />
        </Field>
      </div>
      <Field label="Credential source">
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="local">Encrypted local vault</option>
          <option value="bitwarden">Bitwarden Secrets Manager</option>
        </select>
      </Field>
      {provider === "local" ? (
        <>
          <div className="form-grid">
            <Field label="Username or email">
              <input name="username" autoComplete="off" required={!advanced} />
            </Field>
            <Field label="Password">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required={!advanced}
              />
            </Field>
          </div>
          <Field label="TOTP seed (optional)">
            <input name="totpSecret" type="password" autoComplete="off" />
          </Field>
          <Field label="Recovery codes (optional, one per line)">
            <textarea name="recoveryCodes" rows={2} autoComplete="off" />
          </Field>
        </>
      ) : (
        <Field
          label="Bitwarden secret UUID"
          hint="The secret value must be a JSON credential object. See the README."
        >
          <input name="secretId" required />
        </Field>
      )}
      <details open={!advanced}>
        <summary>Sign-in adapter</summary>
        <p className="subtle">
          Use explicit CSS selectors. Each URL must be on an allowed origin.
        </p>
        <div className="form-grid">
          {[
            ["loginUrl", "Login URL", "/login"],
            ["checkUrl", "Session check URL", "/account"],
            [
              "openSelector",
              "Open sign-in form (optional)",
              'button[data-automation-id="utilityButtonSignIn"]',
            ],
            ["usernameSelector", "Username field", "#email"],
            ["passwordSelector", "Password field", "#password"],
            ["submitSelector", "Sign-in button", 'button[type="submit"]'],
            ["successSelector", "Signed-in marker", "[data-account-menu]"],
            ["totpInput", "TOTP field (optional)", "#code"],
            ["totpSubmit", "TOTP button (optional)", "#verify"],
          ].map(([name, label, placeholder]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                placeholder={placeholder}
                required={
                  !advanced &&
                  !name.startsWith("totp") &&
                  name !== "openSelector"
                }
              />
            </Field>
          ))}
        </div>
        <Field label="Pages Dots may read (one URL per line)">
          <textarea name="taskPages" rows={2} placeholder="/catalog" />
        </Field>
      </details>
      <details>
        <summary>Advanced adapter JSON</summary>
        <p className="subtle">
          Replaces the adapter fields above. Supports email MFA, signup, TOTP
          enrollment, password resets, and additional allowed origins.
          Credentials stay in the fields above.
        </p>
        <textarea
          aria-label="Advanced adapter JSON"
          className="code"
          rows={10}
          value={advanced}
          onChange={(e) => setAdvanced(e.target.value)}
          placeholder={'{ "id": "supplier-x", "name": "Supplier", ... }'}
        />
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy}>Enroll account</Button>
    </form>
  );
}
export function VaultForm({ onDone }: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/vault", {
        token: new FormData(e.currentTarget).get("token"),
      });
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="subtle">
        Use a machine-account token restricted to your automation secrets
        project. Relay encrypts it on this device.
      </p>
      <Field label="Bitwarden machine access token">
        <input name="token" type="password" autoComplete="off" required />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy}>Connect vault</Button>
    </form>
  );
}
export function MailboxForm({ onDone }: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("/mailbox", {
        host: f.get("host"),
        username: f.get("username"),
        password: f.get("password"),
        authservId: f.get("authservId"),
        port: Number(f.get("port")),
        folder: f.get("folder"),
        ...(f.get("aliasTemplate")
          ? { aliasTemplate: f.get("aliasTemplate") }
          : {}),
      });
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <p className="subtle">
        Connect an existing dedicated IMAP mailbox over TLS. Your provider must
        deliver signup aliases to this inbox. Relay does not create mailboxes.
      </p>
      <div className="form-grid">
        <Field label="IMAP host">
          <input name="host" required placeholder="imap.yourprovider.com" />
        </Field>
        <Field label="TLS port">
          <input name="port" type="number" defaultValue="993" required />
        </Field>
      </div>
      <Field label="Mailbox username">
        <input name="username" required type="email" autoComplete="off" />
      </Field>
      <Field label="Mailbox app password">
        <input name="password" type="password" required autoComplete="off" />
      </Field>
      <Field
        label="Trusted receiving mail server ID"
        hint="The authserv-id in your provider's Authentication-Results header. Relay requires aligned DKIM success."
      >
        <input name="authservId" required placeholder="mx.yourprovider.com" />
      </Field>
      <Field label="Folder">
        <input name="folder" defaultValue="INBOX" required />
      </Field>
      <Field
        label="Signup alias template (optional)"
        hint="Example: automation+{alias}@yourdomain.com"
      >
        <input
          name="aliasTemplate"
          placeholder="automation+{alias}@yourdomain.com"
        />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy}>Save mailbox</Button>
    </form>
  );
}
export function ClientForm({
  state,
  onDone,
  client,
}: Done & { state: State; client?: Client }) {
  const [selected, setSelected] = useState<string[]>(
    client?.accounts ?? state.accounts.map((a) => a.key),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; token: string }>();
  const [copied, setCopied] = useState(false);
  const [browser, setBrowser] = useState(
    client?.operations.includes("fill_saved_password") ?? false,
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (client) {
        await api(
          `/clients/${encodeURIComponent(client.id)}`,
          {
            accounts: selected,
            signup: f.get("signup") === "on",
            browser: f.get("browser") === "on",
            privateSignInDotUrl: f.get("privateSignInDotUrl") ?? "",
          },
          "PUT",
        );
        onDone();
        return;
      }
      setCreated(
        await api("/clients", {
          name: f.get("name"),
          accounts: selected,
          signup: f.get("signup") === "on",
          browser: f.get("browser") === "on",
          privateSignInDotUrl: f.get("privateSignInDotUrl") ?? "",
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (created)
    return (
      <div>
        <div className="form-intro">
          <CheckCircle2 size={36} />
          <h3>Dot access is ready</h3>
          <p>This client can use only the accounts you selected.</p>
        </div>
        <Field label="Client ID">
          <input readOnly value={created.id} />
        </Field>
        <p className="subtle">
          From the repository folder, run the tunnel setup script with this ID
          and your OpenAI tunnel ID. It uses the protected client token
          automatically.
        </p>
        <pre className="code-block">{`.\\scripts\\connect-dot.ps1 -ClientId '${created.id}' -TunnelId 'YOUR_TUNNEL_ID'`}</pre>
        <p className="subtle">
          Then add the tunnel in ChatGPT Plugins and enable Relay for your Dot.
          See{" "}
          <a
            href="https://developers.openai.com/api/docs/guides/secure-mcp-tunnels"
            target="_blank"
            rel="noreferrer"
          >
            OpenAI’s tunnel guide
          </a>{" "}
          and docs/CHATGPT-DOTS.md.
        </p>
        <Button
          secondary
          onClick={async () => {
            await navigator.clipboard.writeText(created.id);
            setCopied(true);
          }}
        >
          <Copy size={16} />
          {copied ? "Copied" : "Copy client ID"}
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  return (
    <form onSubmit={submit}>
      <div className="form-intro">
        <Terminal size={32} />
        <p>
          {client
            ? "Choose the accounts this Dot may use. Changes apply to its existing connection."
            : "Create private, scoped access for a ChatGPT Dot. Enrollment credentials stay on this device."}
        </p>
      </div>
      <Field label="Client name">
        <input
          name="name"
          defaultValue={client?.name ?? "ChatGPT Dot"}
          readOnly={!!client}
          required
        />
      </Field>
      <fieldset>
        <legend>Permitted accounts</legend>
        {state.accounts.map((a) => (
          <label className="check" key={a.key}>
            <input
              type="checkbox"
              checked={selected.includes(a.key)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, a.key]
                    : selected.filter((v) => v !== a.key),
                )
              }
            />
            {a.name}
            <small>{a.identity}</small>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          name="browser"
          checked={browser}
          onChange={(e) => setBrowser(e.target.checked)}
        />
        Allow the shared credential to fill focused fields on requested HTTPS
        sites
      </label>
      <Field label="Dot address for private sign-in (optional)">
        <input
          name="privateSignInDotUrl"
          type="url"
          disabled={!browser}
          placeholder="https://chatgpt.com/dots/…"
          defaultValue={
            client?.privateSignInDotId
              ? `https://chatgpt.com/dots/${client.privateSignInDotId}`
              : ""
          }
        />
      </Field>
      <p className="subtle">
        Adding a Dot address allows Relay to fill its ChatGPT private sign-in
        form with your shared email and password for the requested HTTPS
        website. Keep that Dot open in paired Chrome. Relay leaves Sign in and
        Save to Passwords to you. Leave the address blank to disable this
        access.
      </p>
      <label className="check">
        <input
          type="checkbox"
          name="signup"
          defaultChecked={
            client?.operations.includes("create_account") ?? false
          }
        />
        Allow configured account signup
      </label>
      <p className="subtle">
        ChatGPT controls its own action approvals. Relay cannot override them.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button busy={busy} disabled={!selected.length && !browser}>
        {client ? "Save access" : "Create Dot access"}
      </Button>
    </form>
  );
}
export function BrowserForm({ state, onDone }: Done & { state: State }) {
  const [pairing, setPairing] = useState<{
    code: string;
    expiresInSeconds: number;
  }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      {!state.browserCompanions?.length && (
        <p role="status">
          No Chrome companion is paired. Autofill is unavailable.
        </p>
      )}
      <p className="subtle">
        Install Relay Private Autofill in the Chrome profile FraudBot uses. Pair
        it once, then FraudBot can focus a login field and ask Relay to fill it.
      </p>
      <p className="subtle">
        Load the browser-companion folder from this Relay installation at
        chrome://extensions. The extension needs access to HTTPS pages to reach
        the focused login field, and to your local Relay broker.
      </p>
      {pairing ? (
        <>
          <Field label="One-time pairing code">
            <input readOnly type="password" value={pairing.code} />
          </Field>
          <p className="subtle">
            Paste this in the Relay extension popup. It expires in five minutes
            and works once.
          </p>
          <Button
            secondary
            onClick={async () => {
              await navigator.clipboard.writeText(pairing.code);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy pairing code"}
          </Button>
        </>
      ) : (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setPairing(await api("/browser/pairing-code", {}));
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Create pairing code
        </Button>
      )}
      {(state.browserCompanions ?? []).map((c) => (
        <p key={c.id}>
          {c.name} · paired{" "}
          <Button
            secondary
            onClick={async () => {
              try {
                await api(`/browser/companions/${c.id}`, {}, "DELETE");
                onDone();
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            Revoke browser
          </Button>
        </p>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button onClick={onDone}>Done</Button>
    </div>
  );
}
