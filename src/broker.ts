import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { randomUUID } from "node:crypto";
import { accountKey, type Account, type Store } from "./store.js";
import { CredentialProvider } from "./providers.js";
import { MailboxReader } from "./mailbox.js";
import { totp, generatePassword } from "./totp.js";
import type { Credential, LoginResult, Site } from "./schema.js";

const knownReasons = new Set([
  "ACCOUNT_NOT_ENROLLED",
  "HUMAN_VERIFICATION_REQUIRED",
  "AUTHENTICATION_FAILED",
  "MAIL_TIMEOUT",
  "MAIL_UNAVAILABLE",
  "MAILBOX_NOT_CONFIGURED",
  "MFA_NOT_CONFIGURED",
  "RECOVERY_CODES_EXHAUSTED",
  "SIGNUP_NOT_CONFIGURED",
  "RESET_NOT_CONFIGURED",
  "VAULT_NOT_CONNECTED",
  "VAULT_OPERATION_FAILED",
  "VAULT_INVALID_SECRET",
  "BITWARDEN_WRITE_REQUIRES_LOCAL_MIGRATION",
  "BWS_UNAVAILABLE",
  "ORIGIN_NOT_ALLOWED",
  "BROWSER_UNAVAILABLE",
]);
export function safeReason(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return knownReasons.has(code) ? code : "OPERATION_FAILED";
}
export class Broker {
  private browser?: Browser;
  private launch?: Promise<Browser>;
  private jobs = new Map<string, Promise<LoginResult>>();
  private usedMail = new Set<string>();
  readonly provider: CredentialProvider;
  constructor(readonly store: Store) {
    this.provider = new CredentialProvider(store);
  }
  private async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    this.launch ??= chromium
      .launch({
        headless: process.env.RELAY_HEADLESS !== "false",
        args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
      })
      .then((b) => {
        this.browser = b;
        return b;
      })
      .finally(() => {
        this.launch = undefined;
      });
    try {
      return await this.launch;
    } catch {
      throw new Error("BROWSER_UNAVAILABLE");
    }
  }
  private async context(account: Account): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const origins = account.site.origins;
    const context = await browser.newContext({
      storageState: account.session as
        Awaited<ReturnType<BrowserContext["storageState"]>> | undefined,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    context.setDefaultTimeout(account.site.timeoutMs);
    await context.routeWebSocket("**/*", (ws) => ws.close());
    await context.route("**/*", async (route) => {
      let allowed = false;
      try {
        const url = new URL(route.request().url());
        allowed =
          origins.includes(url.origin) &&
          !url.username &&
          !url.password &&
          (url.protocol === "https:" || url.hostname === "127.0.0.1");
      } catch {}
      if (allowed) await route.continue();
      else await route.abort("blockedbyclient");
    });
    return context;
  }
  private async navigate(page: Page, url: string, site: Site) {
    if (!site.origins.includes(new URL(url).origin))
      throw new Error("ORIGIN_NOT_ALLOWED");
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!site.origins.includes(new URL(page.url()).origin))
      throw new Error("ORIGIN_NOT_ALLOWED");
    await this.checkBlocked(page, site);
  }
  private async visible(page: Page, selector?: string) {
    return selector
      ? page
          .locator(selector)
          .first()
          .isVisible()
          .catch(() => false)
      : false;
  }
  private async checkBlocked(page: Page, site: Site) {
    const selectors = [
      ...site.blockedSelectors,
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      "[data-relay-human-verification]",
    ];
    for (const selector of selectors)
      if (await this.visible(page, selector))
        throw new Error("HUMAN_VERIFICATION_REQUIRED");
  }
  private async success(page: Page, selector: string, site: Site) {
    // Give delayed MFA/challenge and SPA state a bounded chance to appear.
    const deadline = Date.now() + site.timeoutMs;
    while (Date.now() < deadline) {
      await this.checkBlocked(page, site);
      if (await this.visible(page, selector)) return true;
      await page.waitForTimeout(150);
    }
    return false;
  }
  private mailbox() {
    if (!this.store.state.mailbox) throw new Error("MAILBOX_NOT_CONFIGURED");
    const used = this.store.state.usedMail ?? [];
    used.forEach((id) => this.usedMail.add(id));
    return new MailboxReader(
      this.store.state.mailbox,
      this.usedMail,
      async (id) => {
        await this.store.update((s) => {
          s.usedMail = [...(s.usedMail ?? []), id].slice(-500);
        });
      },
    );
  }
  private async mfa(
    page: Page,
    site: Site,
    credential: Credential,
    after: Date,
    account: Account,
  ) {
    if (!site.mfa || !(await this.visible(page, site.mfa.input))) return;
    let code: string;
    if (site.mfa.method === "totp") {
      if (!credential.totpSecret) throw new Error("MFA_NOT_CONFIGURED");
      if (Date.now() % 30000 > 27000) await page.waitForTimeout(3100);
      code = totp(credential.totpSecret);
    } else if (site.mfa.method === "email") {
      code = await this.mailbox().wait(
        site.mfa.mail!,
        after,
        credential.username,
        "code",
      );
    } else {
      code = credential.recoveryCodes.shift() ?? "";
      if (!code) throw new Error("RECOVERY_CODES_EXHAUSTED");
      // Reserve before using so crashes cannot replay the same code.
      await this.provider.set(account, credential);
    }
    await this.checkBlocked(page, site);
    await page.locator(site.mfa.input).fill(code);
    await page.locator(site.mfa.submit).click();
  }
  async ensureLogin(
    siteId: string,
    identity = "business",
  ): Promise<LoginResult> {
    const key = accountKey(siteId, identity);
    if (this.jobs.has(key)) return this.jobs.get(key)!;
    const job = this.login(key).finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
    return job;
  }
  private async login(key: string): Promise<LoginResult> {
    const account = this.store.state.accounts[key];
    if (!account)
      return {
        status: "BLOCKED",
        site: key.split(":")[0],
        identity: key.split(":")[1],
        reason: "ACCOUNT_NOT_ENROLLED",
      };
    const site = account.site;
    let context: BrowserContext | undefined;
    let result: LoginResult;
    try {
      context = await this.context(account);
      const page = await context.newPage();
      await this.navigate(page, site.sessionCheckUrl, site);
      const reused =
        !account.pendingPassword &&
        (await this.visible(page, site.login.success));
      if (!reused) {
        const credential = await this.provider.get(account);
        const originalPassword = credential.password;
        let submittedPending = !!account.pendingPassword;
        if (account.pendingPassword)
          credential.password = account.pendingPassword;
        await this.navigate(page, site.login.url, site);
        const started = new Date();
        await page.locator(site.login.username).fill(credential.username);
        await page.locator(site.login.password).fill(credential.password);
        await page.locator(site.login.submit).click();
        // Wait for either success, MFA, expiration, or a challenge, including dynamic forms.
        const deadline = Date.now() + site.timeoutMs;
        while (
          Date.now() < deadline &&
          !(await this.visible(page, site.login.success)) &&
          !(await this.visible(page, site.mfa?.input)) &&
          !(await this.visible(page, site.reset?.expired))
        ) {
          await this.checkBlocked(page, site);
          await page.waitForTimeout(150);
        }
        if (
          submittedPending &&
          !(await this.visible(page, site.login.success)) &&
          !(await this.visible(page, site.mfa?.input)) &&
          !(await this.visible(page, site.reset?.expired))
        ) {
          // A reset may have failed before changing the site. Try the previous password once.
          credential.password = originalPassword;
          submittedPending = false;
          await this.navigate(page, site.login.url, site);
          await page.locator(site.login.username).fill(credential.username);
          await page.locator(site.login.password).fill(credential.password);
          await page.locator(site.login.submit).click();
          const retryDeadline = Date.now() + site.timeoutMs;
          while (
            Date.now() < retryDeadline &&
            !(await this.visible(page, site.login.success)) &&
            !(await this.visible(page, site.mfa?.input)) &&
            !(await this.visible(page, site.reset?.expired))
          ) {
            await this.checkBlocked(page, site);
            await page.waitForTimeout(150);
          }
        }
        if (site.reset && (await this.visible(page, site.reset.expired))) {
          await this.reset(page, account, credential);
          await this.navigate(page, site.login.url, site);
          await page.locator(site.login.username).fill(credential.username);
          await page.locator(site.login.password).fill(credential.password);
          await page.locator(site.login.submit).click();
          await page.waitForTimeout(250);
        }
        await this.mfa(page, site, credential, started, account);
        if (!(await this.success(page, site.login.success, site)))
          throw new Error("AUTHENTICATION_FAILED");
        if (submittedPending && account.pendingPassword)
          await this.provider.set(account, credential);
      }
      const session = await context.storageState({ indexedDB: true });
      result = {
        status: "AUTHENTICATED",
        site: site.id,
        identity: site.identity,
        reused,
      };
      await this.store.update((s) => {
        const a = s.accounts[key];
        a.session = session;
        a.pendingPassword = undefined;
        a.result = result;
        a.checkedAt = new Date().toISOString();
      });
    } catch (error) {
      const reason = safeReason(error);
      result = {
        status:
          reason === "BROWSER_UNAVAILABLE" || reason.startsWith("VAULT_")
            ? "ERROR"
            : "BLOCKED",
        site: site.id,
        identity: site.identity,
        reason,
      };
      await this.store.update((s) => {
        s.accounts[key].result = result;
        s.accounts[key].checkedAt = new Date().toISOString();
      });
    } finally {
      await context?.close().catch(() => {});
    }
    await this.store.audit("ensure_login", result.status, key, result.reason);
    return result;
  }
  private async reset(page: Page, account: Account, credential: Credential) {
    const { site } = account;
    const flow = site.reset;
    if (!flow) throw new Error("RESET_NOT_CONFIGURED");
    const password = generatePassword();
    const after = new Date();
    // Persist the candidate first, to recover if the site changes it and the broker crashes.
    await this.store.update((s) => {
      s.accounts[accountKey(site.id, site.identity)].pendingPassword = password;
    });
    await this.navigate(page, flow.requestUrl, site);
    await page.locator(flow.username).fill(credential.username);
    await page.locator(flow.requestSubmit).click();
    const link = await this.mailbox().wait(
      flow.mail,
      after,
      credential.username,
      "link",
      flow.linkOrigins,
    );
    await this.navigate(page, link, site);
    await page.locator(flow.newPassword).fill(password);
    if (flow.confirmPassword)
      await page.locator(flow.confirmPassword).fill(password);
    await page.locator(flow.submit).click();
    if (!(await this.success(page, flow.success, site)))
      throw new Error("AUTHENTICATION_FAILED");
    credential.password = password;
    await this.provider.set(account, credential);
    await this.store.update((s) => {
      s.accounts[accountKey(site.id, site.identity)].pendingPassword =
        undefined;
    });
    await this.store.audit(
      "password_reset",
      "COMPLETE",
      accountKey(site.id, site.identity),
    );
  }
  async createAccount(
    siteId: string,
    identity = "business",
  ): Promise<LoginResult> {
    const key = accountKey(siteId, identity);
    const account = this.store.state.accounts[key];
    if (!account?.site.signup)
      return {
        status: "BLOCKED",
        site: siteId,
        identity,
        reason: "SIGNUP_NOT_CONFIGURED",
      };
    if (account.credential || account.binding.provider !== "local")
      return {
        status: "BLOCKED",
        site: siteId,
        identity,
        reason: "ACCOUNT_ALREADY_ENROLLED",
      };
    if (this.jobs.has(key))
      return {
        status: "BLOCKED",
        site: siteId,
        identity,
        reason: "OPERATION_IN_PROGRESS",
      };
    const job = this.signup(account).finally(() => this.jobs.delete(key));
    this.jobs.set(key, job);
    return job;
  }
  private async signup(account: Account): Promise<LoginResult> {
    const site = account.site;
    const flow = site.signup!;
    const key = accountKey(site.id, site.identity);
    let context: BrowserContext | undefined;
    try {
      const template = this.store.state.mailbox?.aliasTemplate;
      if (!template?.includes("{alias}"))
        throw new Error("MAILBOX_NOT_CONFIGURED");
      const credential: Credential = {
        username: template.replace(
          "{alias}",
          `${site.id}-${randomUUID().slice(0, 8)}`,
        ),
        password: generatePassword(),
        recoveryCodes: [],
      };
      // Record before submitting; an uncertain signup must be investigated, never retried blindly.
      await this.provider.set(account, credential);
      context = await this.context(account);
      const page = await context.newPage();
      await this.navigate(page, flow.url, site);
      const after = new Date();
      await page.locator(flow.username).fill(credential.username);
      await page.locator(flow.password).fill(credential.password);
      if (flow.confirmPassword)
        await page.locator(flow.confirmPassword).fill(credential.password);
      await page.locator(flow.submit).click();
      if (flow.verificationMail) {
        const link = await this.mailbox().wait(
          flow.verificationMail,
          after,
          credential.username,
          "link",
          flow.verificationOrigins,
        );
        await this.navigate(page, link, site);
      }
      if (!(await this.success(page, flow.success, site)))
        throw new Error("AUTHENTICATION_FAILED");
      if (flow.totpEnrollment) {
        const mfa = flow.totpEnrollment;
        await this.navigate(page, mfa.url, site);
        const seed = (await page.locator(mfa.secret).textContent())?.trim();
        if (!seed) throw new Error("MFA_NOT_CONFIGURED");
        credential.totpSecret = seed;
        await this.provider.set(account, credential);
        await page.locator(mfa.code).fill(totp(seed));
        await page.locator(mfa.submit).click();
        if (!(await this.success(page, mfa.success, site)))
          throw new Error("MFA_NOT_CONFIGURED");
        if (mfa.recoveryCodes)
          credential.recoveryCodes = (
            await page.locator(mfa.recoveryCodes).allTextContents()
          )
            .map((v) => v.trim())
            .filter(Boolean);
        await this.provider.set(account, credential);
      }
      const session = await context.storageState({ indexedDB: true });
      await this.store.update((s) => {
        s.accounts[key].session = session;
      });
      await this.store.audit("create_account", "COMPLETE", key);
      return {
        status: "AUTHENTICATED",
        site: site.id,
        identity: site.identity,
      };
    } catch (error) {
      const reason = safeReason(error);
      await this.store.audit("create_account", "BLOCKED", key, reason);
      return {
        status: "BLOCKED",
        site: site.id,
        identity: site.identity,
        reason,
      };
    } finally {
      await context?.close().catch(() => {});
    }
  }
  async readPage(siteId: string, identity: string, url: string) {
    const result = await this.ensureLogin(siteId, identity);
    if (result.status !== "AUTHENTICATED") return result;
    const account = this.store.state.accounts[accountKey(siteId, identity)];
    if (!account.site.taskPages.includes(url))
      return {
        status: "BLOCKED",
        reason: "TASK_PAGE_NOT_ALLOWED",
        site: siteId,
        identity,
      };
    const context = await this.context(account);
    try {
      const page = await context.newPage();
      await this.navigate(page, url, account.site);
      // Read visible text only; never DOM source, input values, cookies, headers, screenshots, or JS.
      let text = (await page.locator("body").innerText()).slice(0, 20000);
      const credential = await this.provider.get(account);
      for (const secret of [
        credential.username,
        credential.password,
        credential.totpSecret,
        ...credential.recoveryCodes,
        account.pendingPassword,
      ]) {
        if (secret) text = text.split(secret).join("[redacted]");
      }
      return { status: "AUTHENTICATED", site: siteId, identity, text };
    } finally {
      await context.close();
    }
  }
  async renewDue() {
    if (!this.store.state.ready) return;
    for (const account of Object.values(this.store.state.accounts)) {
      if (!account.checkedAt || account.result?.status !== "AUTHENTICATED")
        continue;
      if (
        Date.now() - Date.parse(account.checkedAt) >
        account.site.renewalMinutes * 60000
      )
        await this.ensureLogin(account.site.id, account.site.identity);
    }
  }
  async close() {
    await Promise.allSettled(this.jobs.values());
    await this.browser?.close();
  }
}
