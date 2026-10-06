export type Account = {
  key: string;
  site: string;
  identity: string;
  name: string;
  origin: string;
  provider: string;
  status: string;
  reason?: string;
  checkedAt?: string;
  mfa: string;
};
export type Audit = {
  id: string;
  at: string;
  site?: string;
  action: string;
  status: string;
  reason?: string;
};
export type Client = {
  id: string;
  name: string;
  accounts: string[];
  operations: string[];
  privateSignInDotId?: string;
  createdAt: string;
};
export type State = {
  ready: boolean;
  protection: string;
  vaultConnected: boolean;
  mailboxConnected: boolean;
  accounts: Account[];
  audit: Audit[];
  clients: Client[];
  enrollmentEmail?: string;
  sharedCredentialConfigured?: boolean;
  sharedSignup?: boolean;
  browserCompanions?: {
    id: string;
    name: string;
    pairedAt: string;
    online: boolean;
  }[];
};
const params = new URLSearchParams(location.hash.slice(1));
if (params.has("token")) {
  sessionStorage.setItem("relay-console-token", params.get("token")!);
  history.replaceState(null, "", location.pathname);
}
export const getToken = () =>
  sessionStorage.getItem("relay-console-token") ?? "";
export function setToken(token: string) {
  sessionStorage.setItem("relay-console-token", token.trim());
}
export async function api<T>(
  path: string,
  data?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: data === undefined && method === "POST" ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${String(body.error ?? "REQUEST_FAILED")
        .replace(/_/g, " ")
        .toLowerCase()}${body.fields?.length ? ": " + body.fields.join(", ") : ""}`,
    );
  return body as T;
}
