import { useCallback, useEffect, useState } from "react";
import {
  Shield,
  House,
  UserRound,
  FileText,
  Settings,
  Plus,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  PlugZap,
  KeyRound,
  Mail,
  Trash2,
} from "lucide-react";
import { api, getToken, setToken, type State, type Client } from "./api";
import { AccountEmpty, Activity, Button, Field, Modal } from "./components";
import {
  AccountForm,
  ClientForm,
  BrowserForm,
  MailboxForm,
  SetupForm,
  VaultForm,
} from "./forms";
const blank: State = {
  ready: false,
  protection: "dpapi",
  vaultConnected: false,
  mailboxConnected: false,
  accounts: [],
  audit: [],
  clients: [],
};
type Page = "Overview" | "Accounts" | "Activity" | "Settings";
type Dialog =
  | "setup"
  | "account"
  | "vault"
  | "mailbox"
  | "client"
  | "browser"
  | "access"
  | null;
const settingsItems = [
  { Icon: KeyRound, title: "Shared website credential", dialog: "account" },
  { Icon: PlugZap, title: "Chrome autofill companion", dialog: "browser" },
  { Icon: Shield, title: "Device protection", dialog: "setup" },
  { Icon: KeyRound, title: "Credential vault", dialog: "vault" },
  { Icon: Mail, title: "Authentication mailbox", dialog: "mailbox" },
  { Icon: PlugZap, title: "ChatGPT Dots", dialog: "client" },
] as const;
export function App() {
  const [page, setPage] = useState<Page>("Overview");
  const [state, setState] = useState<State>(blank);
  const [modal, setModal] = useState<Dialog>(null);
  const [editingClient, setEditingClient] = useState<Client>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [connected, setConnected] = useState(false);
  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      setState(await api<State>("/state"));
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const open = (dialog: Dialog) =>
    setModal(getToken() && connected ? dialog : "access");
  const done = () => {
    setModal(null);
    setEditingClient(undefined);
    void refresh();
  };
  async function demo() {
    if (!getToken() || !connected) return setModal("access");
    if (!state.ready) return setModal("setup");
    setBusy("demo");
    setNotice("");
    try {
      const r = await api<{ status: string; reason?: string }>("/demo", {});
      setNotice(
        r.status === "AUTHENTICATED"
          ? "Demo signed in with TOTP. The encrypted session is ready to restore."
          : (r.reason ?? r.status),
      );
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function login(site: string, identity: string) {
    setBusy(`${site}:${identity}`);
    setNotice("");
    try {
      const r = await api<{ status: string; reason?: string }>(
        `/accounts/${site}/${identity}/login`,
        {},
      );
      setNotice(
        r.status === "AUTHENTICATED"
          ? "Signed in. The session is stored securely."
          : (r.reason?.replace(/_/g, " ").toLowerCase() ?? r.status),
      );
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const settingsText = [
    state.sharedCredentialConfigured
      ? "One shared password · saved in the encrypted vault"
      : "Save or generate your shared website password once",
    (state.browserCompanions?.length ?? 0)
      ? `${state.browserCompanions!.length} browser paired`
      : "No browser paired · autofill unavailable",
    state.ready
      ? `${state.protection.toUpperCase()} · configured`
      : "Complete one-time setup",
    state.vaultConnected
      ? "Bitwarden connected"
      : "Local vault available · Bitwarden optional",
    state.mailboxConnected
      ? "Mailbox configured"
      : "Connect a dedicated inbox for verification and recovery",
    "Create a scoped client and connect through Secure MCP Tunnel",
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Shield size={38} strokeWidth={1.8} />
          <div>
            <strong>Relay</strong>
            <span>Credential broker</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {(
            [
              [House, "Overview"],
              [UserRound, "Accounts"],
              [FileText, "Activity"],
              [Settings, "Settings"],
            ] as const
          ).map(([Icon, name]) => (
            <button
              key={name}
              className={page === name ? "selected" : ""}
              onClick={() => setPage(name)}
            >
              <Icon size={22} strokeWidth={1.7} />
              {name}
            </button>
          ))}
        </nav>
        <button className="connection" onClick={() => open("access")}>
          <i className={connected ? "online" : ""} />
          Local connection
        </button>
      </aside>
      <main>
        <div className="top-status">
          <i className={connected ? "online" : ""} />
          {connected
            ? state.ready
              ? "Broker online"
              : "Ready for setup"
            : "Broker offline"}
        </div>
        <header>
          <h1>
            {page === "Overview"
              ? "Sign in once. Keep moving."
              : page === "Accounts"
                ? "Your connected accounts."
                : page === "Activity"
                  ? "A clear record of every sign-in."
                  : "Private by design."}
          </h1>
          <p>
            {page === "Overview"
              ? "A private bridge between your accounts and your agents."
              : page === "Accounts"
                ? "Enroll, check, and renew your website sessions."
                : page === "Activity"
                  ? "Results and events, with your credentials kept private."
                  : "Connect your vault, mailbox, and ChatGPT Dots."}
          </p>
        </header>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {(page === "Overview" || page === "Accounts") && (
          <>
            {page === "Overview" && (
              <section className="setup-band">
                <Shield size={48} strokeWidth={1.7} />
                <div>
                  <h2>
                    {state.ready
                      ? "Your secure broker is ready"
                      : "Set up your secure broker"}
                  </h2>
                  <p>
                    {state.ready
                      ? "Enroll your accounts and connect Relay to your ChatGPT Dot."
                      : "Connect your vault, enroll an account, and let Relay handle sign-in."}
                  </p>
                </div>
                <Button onClick={() => open(state.ready ? "client" : "setup")}>
                  {state.ready ? "Connect a Dot" : "Start setup"}
                </Button>
              </section>
            )}
            <section className="accounts-section">
              <div className="section-heading">
                <h2>Connected accounts</h2>
                <Button secondary onClick={() => open("account")}>
                  <Plus size={20} />
                  Shared credential
                </Button>
              </div>
              <div className="account-list">
                {state.accounts.length ? (
                  state.accounts.map((a) => (
                    <div className="account-row" key={a.key}>
                      <div className="site-icon">
                        <ShieldCheck size={24} />
                      </div>
                      <div className="account-info">
                        <strong>{a.name}</strong>
                        <small>
                          {a.origin} · {a.identity}
                        </small>
                        <small>
                          {a.provider === "bitwarden"
                            ? "Bitwarden"
                            : "Encrypted local vault"}{" "}
                          ·{" "}
                          {a.mfa === "none" ? "Password" : a.mfa.toUpperCase()}
                        </small>
                      </div>
                      <div className="account-status">
                        <span className={`result ${a.status.toLowerCase()}`}>
                          {a.status === "AUTHENTICATED"
                            ? "Signed in"
                            : a.status === "ENROLLED"
                              ? "Enrolled"
                              : a.status.toLowerCase()}
                        </span>
                        {a.reason && (
                          <small>
                            {a.reason.replace(/_/g, " ").toLowerCase()}
                          </small>
                        )}
                      </div>
                      <Button
                        secondary
                        busy={busy === a.key}
                        onClick={() => void login(a.site, a.identity)}
                      >
                        <RefreshCw size={16} />
                        Check login
                      </Button>
                    </div>
                  ))
                ) : (
                  <AccountEmpty onDemo={() => void demo()} />
                )}
              </div>
              {busy === "demo" && (
                <p className="subtle" role="status">
                  Signing in to the local test website…
                </p>
              )}
            </section>
            {page === "Overview" && (
              <div className="bottom-grid">
                <section className="panel how">
                  <h2>How Relay works</h2>
                  {[
                    ["Enroll once", "Connect your vault and add an account."],
                    [
                      "Keep secrets private",
                      "Credentials stay on your device, never exposed to agents.",
                    ],
                    [
                      "Resume automatically",
                      "Relay handles sign-in, session renewal, and MFA for your agents.",
                    ],
                  ].map(([title, text], i) => (
                    <div className="step" key={title}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{title}</h3>
                        <p>{text}</p>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h2>Recent activity</h2>
                  <Activity items={state.audit} />
                </section>
              </div>
            )}
          </>
        )}
        {page === "Activity" && (
          <section className="panel">
            <div className="section-heading">
              <h2>Broker activity</h2>
              <Button secondary onClick={() => void refresh()}>
                <RefreshCw size={16} />
                Refresh
              </Button>
            </div>
            <Activity items={state.audit} full />
          </section>
        )}
        {page === "Settings" && (
          <>
            <section className="panel">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("/profile", {
                      email: new FormData(e.currentTarget).get("email"),
                    });
                    setNotice("Default email saved.");
                    await refresh();
                  } catch (e) {
                    setNotice((e as Error).message);
                  }
                }}
              >
                <Field label="Default account email">
                  <input
                    name="email"
                    type="email"
                    defaultValue={state.enrollmentEmail ?? ""}
                    required
                  />
                </Field>
                <Button secondary>Save default email</Button>
              </form>
            </section>
            <section className="settings-list">
              {settingsItems.map(({ Icon, title, dialog }, i) => (
                <div className="settings-row" key={title}>
                  <Icon size={24} />
                  <div>
                    <h3>{title}</h3>
                    <p>{settingsText[i]}</p>
                  </div>
                  <Button
                    secondary
                    disabled={dialog === "setup" && state.ready}
                    onClick={() => open(dialog)}
                  >
                    Configure
                    <ArrowRight size={16} />
                  </Button>
                </div>
              ))}
            </section>
            <section className="panel client-panel">
              <h2>Connected clients</h2>
              {state.clients.length ? (
                state.clients.map((c) => (
                  <div className="client-row" key={c.id}>
                    <PlugZap size={20} />
                    <div>
                      <strong>{c.name}</strong>
                      <small>
                        {c.accounts.length} permitted account
                        {c.accounts.length === 1 ? "" : "s"}
                        {c.operations.includes("fill_saved_password")
                          ? " · shared browser autofill"
                          : ""}
                      </small>
                    </div>
                    <Button
                      secondary
                      aria-label={`Manage access for ${c.name}`}
                      onClick={() => {
                        setEditingClient(c);
                        open("client");
                      }}
                    >
                      Manage access
                    </Button>
                    <button
                      className="icon-button"
                      aria-label={`Revoke ${c.name}`}
                      onClick={async () => {
                        try {
                          await api(`/clients/${c.id}`, {}, "DELETE");
                          await refresh();
                        } catch (e) {
                          setNotice((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="subtle">No clients connected yet.</p>
              )}
            </section>
          </>
        )}
        <footer>
          Protected on this device · No credentials exposed to agents
        </footer>
      </main>
      {modal && (
        <Modal
          title={
            {
              setup: "Set up your secure broker",
              account: "Your shared website credential",
              browser: "Pair Chrome autofill",
              vault: "Connect Bitwarden",
              mailbox: "Authentication mailbox",
              client: editingClient
                ? "Manage Dot access"
                : "Connect a ChatGPT Dot",
              access: "Connect your local console",
            }[modal]
          }
          onClose={done}
        >
          {modal === "setup" && (
            <SetupForm onDone={done} initialProtection={state.protection} />
          )}
          {modal === "account" && <AccountForm onDone={done} state={state} />}
          {modal === "browser" && <BrowserForm onDone={done} state={state} />}
          {modal === "vault" && <VaultForm onDone={done} />}
          {modal === "mailbox" && <MailboxForm onDone={done} />}
          {modal === "client" && (
            <ClientForm
              key={editingClient?.id ?? "new"}
              state={state}
              client={editingClient}
              onDone={done}
            />
          )}
          {modal === "access" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setToken(
                  String(new FormData(e.currentTarget).get("token") ?? ""),
                );
                await refresh();
                setModal(null);
              }}
            >
              <p className="subtle">
                Run <code>npm run console</code> from the repository folder to
                open an authenticated console, or enter your local console
                access token.
              </p>
              <Field label="Console access token">
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                />
              </Field>
              <Button>Connect console</Button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
