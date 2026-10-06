import { useState, type FormEvent } from "react";
import { ShieldCheck, CheckCircle2, Terminal, Copy } from "lucide-react";
import { api, type State } from "./api";
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
export function AccountForm({ onDone }: Done) {
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
                required={!advanced && !name.startsWith("totp")}
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
export function ClientForm({ state, onDone }: Done & { state: State }) {
  const [selected, setSelected] = useState<string[]>(
    state.accounts.map((a) => a.key),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; token: string }>();
  const [copied, setCopied] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      setCreated(
        await api("/clients", {
          name: f.get("name"),
          accounts: selected,
          signup: f.get("signup") === "on",
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
          Create private, scoped access for a ChatGPT Dot. Enrollment
          credentials stay on this device.
        </p>
      </div>
      <Field label="Client name">
        <input name="name" defaultValue="ChatGPT Dot" required />
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
        <input type="checkbox" name="signup" />
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
      <Button busy={busy} disabled={!selected.length}>
        Create Dot access
      </Button>
    </form>
  );
}
