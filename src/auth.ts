import { execFile } from "child_process";
import * as crypto from "crypto";
import * as vscode from "vscode";

export const PROVIDER_ID = "ietf";
const PROVIDER_LABEL = "IETF Account";
const SESSION_KEY = "ietf.sessions";

const OAUTH_CLIENT_ID = "ietf-annotations-vscode";
const AUTH_TIMEOUT_MS = 120_000;

/**
 * VS Code AuthenticationProvider for IETF Annotations using OAuth 2.0
 * with PKCE.
 *
 * When the user signs in, the extension opens the test server's authorize
 * endpoint in the system browser.  The server presents a user-selection
 * page and redirects back to VS Code via a `vscode://` URI carrying an
 * authorization code.  The extension exchanges that code (plus PKCE
 * verifier) for an access token.
 */
export class IetfAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.UriHandler, vscode.Disposable
{
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private _sessions: vscode.AuthenticationSession[] = [];

  /**
   * Pending OAuth flows keyed by `state`.  Each entry holds the PKCE
   * code verifier and a promise resolver so that `handleUri` can deliver
   * the authorization code back to `createSession`.
   */
  private _pendingFlows = new Map<
    string,
    {
      codeVerifier: string;
      resolve: (code: string) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly getServerUrl: () => string,
    private readonly output?: vscode.OutputChannel,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Load persisted sessions from secret storage.
   * Must be called once during extension activation before registering.
   */
  async initialize(): Promise<void> {
    const raw = await this.secrets.get(SESSION_KEY);
    if (!raw) {
      return;
    }
    try {
      this._sessions = JSON.parse(raw) as vscode.AuthenticationSession[];
    } catch {
      this._sessions = [];
    }
  }

  dispose(): void {
    this._onDidChangeSessions.dispose();
    // Reject any in-flight OAuth flows.
    for (const flow of this._pendingFlows.values()) {
      flow.reject(new Error("Auth provider disposed"));
    }
    this._pendingFlows.clear();
  }

  // ── AuthenticationProvider ─────────────────────────────────────────────

  async getSessions(
    _scopes?: readonly string[],
  ): Promise<vscode.AuthenticationSession[]> {
    return this._sessions;
  }

  /**
   * Start the OAuth 2.0 + PKCE flow.
   *
   * 1. Generate state + PKCE code verifier / challenge.
   * 2. Open the authorize endpoint in the system browser.
   * 3. Wait for the URI handler to deliver the auth code.
   * 4. Exchange the code for an access token.
   * 5. Fetch `/api/openid/userinfo` to populate the account label.
   */
  async createSession(
    _scopes: readonly string[],
  ): Promise<vscode.AuthenticationSession> {
    const serverUrl = this.getServerUrl();
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // The redirect URI must match what VS Code's URI handler listens on.
    const extensionId = "undefined_publisher.ietf-annotations";
    const redirectUri = `${vscode.env.uriScheme}://${extensionId}/auth-callback`;

    // Build the full authorize URL as a plain string so we have full
    // control over encoding.  Each value is individually percent-encoded.
    const qs = [
      `client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `response_type=code`,
      `scope=${encodeURIComponent("openid profile")}`,
      `state=${encodeURIComponent(state)}`,
      `code_challenge=${encodeURIComponent(codeChallenge)}`,
      `code_challenge_method=S256`,
    ].join("&");

    const authorizeUrl = `${serverUrl}/api/openid/authorize?${qs}`;
    this.output?.appendLine(`[OAuth] authorize URL: ${authorizeUrl}`);

    // Register the pending flow BEFORE opening the browser so handleUri
    // can never arrive before we're ready to receive the code.
    const codePromise = new Promise<string>((resolve, reject) => {
      this._pendingFlows.set(state, { codeVerifier, resolve, reject });
    });

    // vscode.Uri.parse() decodes percent-encoded query values internally,
    // then openExternal() passes the decoded URL to the OS which breaks on
    // spaces and special chars.  Open via execFile to preserve encoding.
    try {
      await openUrlInBrowser(authorizeUrl);
      this.output?.appendLine(`[OAuth] opened browser`);
    } catch (err) {
      this._pendingFlows.delete(state);
      throw new Error(`Failed to open browser: ${err}`);
    }

    // Wait for the callback with a timeout.
    let authCode: string;
    try {
      authCode = await Promise.race([
        codePromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("OAuth sign-in timed out")),
            AUTH_TIMEOUT_MS,
          ),
        ),
      ]);
    } finally {
      this._pendingFlows.delete(state);
    }

    // Exchange the auth code for an access token.
    const tokenResponse = await fetch(`${serverUrl}/api/openid/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: redirectUri,
        client_id: OAUTH_CLIENT_ID,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => "");
      throw new Error(
        `Token exchange failed (${tokenResponse.status}): ${text}`,
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    // Fetch user profile so we can populate the account label.
    const userinfoResponse = await fetch(`${serverUrl}/api/openid/userinfo`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let accountName = "unknown";
    if (userinfoResponse.ok) {
      const profile = (await userinfoResponse.json()) as {
        sub: string;
        name: string;
        email: string;
      };
      accountName = profile.name;
    }

    // Build and persist the session.
    const removed = this._sessions.slice();

    const session: vscode.AuthenticationSession = {
      id: `ietf-${Date.now()}`,
      accessToken: tokenData.access_token,
      account: { id: accountName, label: accountName },
      scopes: [],
    };

    this._sessions = [session];
    await this._persistSessions();
    this._onDidChangeSessions.fire({
      added: [session],
      removed,
      changed: [],
    });

    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this._sessions.find((s) => s.id === sessionId);
    if (!session) {
      return;
    }

    // No server-side logout needed — the OAuth access token simply expires.
    this._sessions = this._sessions.filter((s) => s.id !== sessionId);
    await this._persistSessions();
    this._onDidChangeSessions.fire({
      added: [],
      removed: [session],
      changed: [],
    });
  }

  // ── UriHandler ─────────────────────────────────────────────────────────

  /**
   * Called by VS Code when the system browser redirects back to
   * `vscode://undefined_publisher.ietf-annotations/auth-callback?code=...&state=...`
   */
  handleUri(uri: vscode.Uri): void {
    this.output?.appendLine(`[OAuth] handleUri called: ${uri.toString()}`);

    const params = new URLSearchParams(uri.query);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      this.output?.appendLine(`[OAuth] handleUri: missing code or state`);
      return;
    }

    const pending = this._pendingFlows.get(state);
    if (pending) {
      this.output?.appendLine(`[OAuth] handleUri: matched pending flow, resolving`);
      pending.resolve(code);
    } else {
      this.output?.appendLine(`[OAuth] handleUri: no matching pending flow for state=${state}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async _persistSessions(): Promise<void> {
    await this.secrets.store(SESSION_KEY, JSON.stringify(this._sessions));
  }
}

/* ── Browser opener ───────────────────────────────────────────────────── */

/**
 * Open a URL in the system's default browser without going through
 * vscode.Uri, which mangles query-string encoding.
 */
function openUrlInBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url];
    } else {
      cmd = "xdg-open";
      args = [url];
    }

    execFile(cmd, args, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/* ── PKCE helpers ──────────────────────────────────────────────────────── */

/** Generate a cryptographically random code verifier for PKCE. */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Derive the S256 code challenge from a code verifier. */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
