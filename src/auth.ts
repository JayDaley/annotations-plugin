import * as vscode from "vscode";
import { AnnotationApiClient } from "./api";

export const PROVIDER_ID = "ietfAnnotations";
const PROVIDER_LABEL = "IETF Annotations";
const SESSION_KEY = "ietfAnnotations.sessions";

/**
 * VS Code AuthenticationProvider for IETF Annotations.
 *
 * Registering this provider surfaces a "IETF Annotations" entry in the
 * Accounts menu (the person icon in the bottom-left of VS Code), giving the
 * user a single, consistent place to sign in and out — no need to run a
 * separate "Login" command.
 */
export class IetfAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private _sessions: vscode.AuthenticationSession[] = [];

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly getClient: () => AnnotationApiClient,
  ) {}

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

  /**
   * Return all stored sessions.
   * VS Code calls this to populate the Accounts menu and resolve
   * `vscode.authentication.getSession` calls from anywhere in the extension.
   */
  async getSessions(
    _scopes?: readonly string[],
  ): Promise<vscode.AuthenticationSession[]> {
    return this._sessions;
  }

  /**
   * Prompt the user for credentials, call the annotation server, and store
   * the resulting session so VS Code shows the account in the Accounts menu.
   *
   * @throws if the user cancels or the server rejects the credentials.
   */
  async createSession(
    _scopes: readonly string[],
  ): Promise<vscode.AuthenticationSession> {
    const username = await vscode.window.showInputBox({
      title: `${PROVIDER_LABEL} — Sign In`,
      prompt: "Username",
      placeHolder: "Enter your username",
      ignoreFocusOut: true,
    });
    if (!username) {
      throw new Error("Sign-in cancelled");
    }

    const password = await vscode.window.showInputBox({
      title: `${PROVIDER_LABEL} — Sign In`,
      prompt: "Password",
      password: true,
      placeHolder: "Enter your password",
      ignoreFocusOut: true,
    });
    if (!password) {
      throw new Error("Sign-in cancelled");
    }

    let result: { token: string; expires: string };
    try {
      result = await this.getClient().login(username, password);
    } catch (err) {
      throw new Error(
        `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const session: vscode.AuthenticationSession = {
      id: `ietf-${Date.now()}`,
      accessToken: result.token,
      account: { id: username, label: username },
      scopes: [],
    };

    this._sessions = [session];
    await this._persistSessions();
    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });

    return session;
  }

  /**
   * Remove a session (called when the user clicks "Sign Out" in the Accounts
   * menu). Calls the server logout endpoint as a best-effort side-effect.
   *
   * @param sessionId - The `id` of the session to remove.
   */
  async removeSession(sessionId: string): Promise<void> {
    const session = this._sessions.find((s) => s.id === sessionId);
    if (!session) {
      return;
    }

    await this.getClient()
      .logout()
      .catch(() => {
        // best-effort — server token may have already expired
      });

    this._sessions = this._sessions.filter((s) => s.id !== sessionId);
    await this._persistSessions();
    this._onDidChangeSessions.fire({
      added: [],
      removed: [session],
      changed: [],
    });
  }

  private async _persistSessions(): Promise<void> {
    await this.secrets.store(SESSION_KEY, JSON.stringify(this._sessions));
  }

  dispose(): void {
    this._onDidChangeSessions.dispose();
  }
}
