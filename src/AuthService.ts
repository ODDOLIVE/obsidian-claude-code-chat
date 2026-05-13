import { exec, spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { delimiter, isAbsolute, join } from "path";
import { promisify } from "util";
import { ClaudeRunner } from "./ClaudeRunner";

const execAsync = promisify(exec);

export type AuthMethod = "oauth" | "apiKey" | "none";

export interface AuthStatus {
  cliInstalled: boolean;
  cliVersion: string;
  oauthDetected: boolean;
  apiKeyAvailable: boolean;
  effectiveMethod: AuthMethod;
}

export interface LoginHandle {
  cancel: () => void;
}

export class AuthService {
  static decideMethod(oauth: boolean, hasKey: boolean): AuthMethod {
    if (oauth) return "oauth";
    if (hasKey) return "apiKey";
    return "none";
  }

  static detectOAuth(): boolean {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    if (!home) return false;
    const dir = join(home, ".claude");
    if (!existsSync(dir)) return false;
    const candidates = [
      ".credentials.json",
      "credentials.json",
      "auth.json",
      ".oauth.json",
      "oauth_account.json",
    ];
    return candidates.some((f) => existsSync(join(dir, f)));
  }

  static async detect(
    claudePath: string,
    apiKey: string
  ): Promise<AuthStatus> {
    const execPath = await AuthService.resolvePath(claudePath);

    let cliInstalled = false;
    let cliVersion = "";
    if (execPath) {
      try {
        const useShell =
          process.platform === "win32" && /\.(cmd|bat)$/i.test(execPath);
        const cmd = useShell
          ? `"${execPath}" --version`
          : JSON.stringify(execPath) + " --version";
        const { stdout } = await execAsync(cmd, {
          timeout: 8000,
          env: AuthService.envWithPath(),
        });
        cliVersion = stdout.trim().split(/\r?\n/)[0] ?? "";
        cliInstalled = true;
      } catch {
        cliInstalled = false;
      }
    }

    const oauthDetected = AuthService.detectOAuth();
    const apiKeyAvailable = !!apiKey.trim();
    const effectiveMethod = AuthService.decideMethod(
      oauthDetected,
      apiKeyAvailable
    );

    return {
      cliInstalled,
      cliVersion,
      oauthDetected,
      apiKeyAvailable,
      effectiveMethod,
    };
  }

  static async runLogin(
    claudePath: string,
    onOutput: (chunk: string) => void,
    onDone: (code: number) => void
  ): Promise<LoginHandle> {
    const execPath = await AuthService.resolvePath(claudePath);
    const isWin = process.platform === "win32";
    // Use shell on Windows so PATH lookup and .cmd/.exe extension resolution work.
    const useShell = isWin || /\.(cmd|bat)$/i.test(execPath);
    let proc: ChildProcess;
    try {
      const cmd = useShell && execPath.includes(" ")
        ? `"${execPath}"`
        : execPath;
      proc = spawn(cmd, ["/login"], {
        env: AuthService.envWithPath(),
        shell: useShell,
      });
    } catch (e) {
      onOutput(`spawn failed: ${(e as Error).message}\n`);
      onDone(1);
      return { cancel: () => undefined };
    }
    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");
    proc.stdout?.on("data", (d: string) => onOutput(d));
    proc.stderr?.on("data", (d: string) => onOutput(d));
    proc.on("error", (err) => onOutput(`error: ${err.message}\n`));
    proc.on("close", (code) => onDone(code ?? 0));
    return {
      cancel: () => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      },
    };
  }

  static async runLogout(claudePath: string): Promise<string> {
    const execPath = await AuthService.resolvePath(claudePath);
    if (!execPath) throw new Error("claude executable not found");
    const useShell =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(execPath);
    const cmd = useShell
      ? `"${execPath}" /logout`
      : JSON.stringify(execPath) + " /logout";
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 10000,
      env: AuthService.envWithPath(),
    });
    return (stdout || stderr || "").trim();
  }

  static envWithPath(): Record<string, string | undefined> {
    const isWin = process.platform === "win32";
    const extra = isWin ? "" : `${delimiter}/usr/local/bin${delimiter}/opt/homebrew/bin`;
    return {
      ...process.env,
      PATH: (process.env.PATH ?? "") + extra,
    };
  }

  private static async resolvePath(claudePath: string): Promise<string> {
    if (isAbsolute(claudePath)) return claudePath;
    return ClaudeRunner.findClaudePath();
  }
}

export function extractLoginUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/);
  return m ? m[0] : null;
}
