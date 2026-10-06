import { BitwardenClient, DeviceType, LogLevel } from "@bitwarden/sdk-napi";
import { credentialsSchema, type Credential } from "./schema.js";
import { accountKey, type Account, type Store } from "./store.js";

export class CredentialProvider {
  constructor(private store: Store) {}
  private async client() {
    if (!this.store.state.bwsToken) throw new Error("VAULT_NOT_CONNECTED");
    try {
      const client = new BitwardenClient(
        {
          apiUrl:
            process.env.RELAY_BITWARDEN_API_URL ?? "https://api.bitwarden.com",
          identityUrl:
            process.env.RELAY_BITWARDEN_IDENTITY_URL ??
            "https://identity.bitwarden.com",
          userAgent: "Relay/0.1.0",
          deviceType: DeviceType.SDK,
        },
        LogLevel.Error,
      );
      await client.auth().loginAccessToken(this.store.state.bwsToken);
      return client;
    } catch {
      throw new Error("VAULT_OPERATION_FAILED");
    }
  }
  async validateConnection() {
    await this.client();
  }
  async get(
    account: Pick<Account, "binding" | "credential">,
  ): Promise<Credential> {
    if (account.binding.provider === "local") {
      if (!account.credential) throw new Error("ACCOUNT_NOT_ENROLLED");
      return structuredClone(account.credential);
    }
    try {
      const client = await this.client();
      const secret = await client.secrets().get(account.binding.secretId);
      return credentialsSchema.parse(JSON.parse(secret.value));
    } catch {
      throw new Error("VAULT_INVALID_SECRET");
    }
  }
  async set(account: Account, credential: Credential) {
    if (account.binding.provider === "bitwarden") {
      try {
        const client = await this.client();
        const current = await client.secrets().get(account.binding.secretId);
        await client
          .secrets()
          .update(
            current.organizationId,
            current.id,
            current.key,
            JSON.stringify(credential),
            current.note,
            current.projectId ? [current.projectId] : [],
          );
      } catch {
        throw new Error("VAULT_OPERATION_FAILED");
      }
      return;
    }
    await this.store.update((s) => {
      s.accounts[
        accountKey(account.site.id, account.site.identity)
      ].credential = credential;
    });
  }
}
