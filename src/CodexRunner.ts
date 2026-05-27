import { spawn, exec, ChildProcess } from "child_process";
import { delimiter, isAbsolute } from "path";
import { promisify } from "util";
import { t } from "./i18n";
import type { AgentRunner, RunOptions, RunCallbacks } from "./AgentRunner";

const MAX_PROMPT_BYTES = 28_000;
const execAsync = promisify(exec);

// Codex CLI JSONL event shapes (openai/codex exec --json output).
// The CLI emits a stream of JSON lines. Known event types observed:
//   { type: "message", role: "assistant", content: "<text>" }
//   { type: "message_delta", content: "<incremental text>" }
//   { type: "session_started", session_id: "<uuid>" }
//   { type: "session_completed" | "done" }
//   { type: "error", message: "<text>" }
// Additional unknown types are silently ignored.
type CodexEvent =
  | { type: "message"; role?: string; content?: string; session_id?: string }
  | { type: "message_delta"; content?: string }
  | { type: "session_started"; session_id?: string }
  | { type: "session_completed" | "done" }
  | { type: "error"; message?: string }
  | { type: string; [key: string]: unknown };

export class CodexRunner implements AgentRunner {
  private proc: ChildProcess | null = null;
  private resolvedPath: string | null = null;

  async run(options: RunOptions, callbacks: RunCallbacks): Promise<void> {
    if (this.proc) {
      callbacks.onError(t("notice.previousRunRunning"));
      return;
    }

    if (Buffer.byteLength(options.prompt, "utf-8") > MAX_PROMPT_BYTES) {
      callbacks.onError(
        t(
          "error.promptTooLong",
          Math.round(Buffer.byteLength(options.prompt, "utf-8") / 1024),
          Math.round(MAX_PROMPT_BYTES / 1024)
        )
      );
      return;
    }

    let execPath = options.execPath;
    if (!isAbsolute(execPath) || execPath === "codex") {
      if (!this.resolvedPath) {
        this.resolvedPath = await CodexRunner.findCodexPath();
      }
      if (this.resolvedPath) execPath = this.resolvedPath;
    }

    const isWin = process.platform === "win32";
    const extraPath = isWin
      ? ""
      : `${delimiter}/usr/local/bin${delimiter}/opt/homebrew/bin`;

    // Build args: exec [resume <id>] <prompt> --json --model <model> -C <cwd>
    const args: string[] = ["exec"];

    if (options.sessionFlag === "--resume" && options.sessionId) {
      args.push("resume", options.sessionId);
    }

    args.push(options.prompt);
    args.push("--json");
    args.push("-m", options.model);
    // Skip git repo check so it works in any directory (vault may not be a repo)
    args.push("--skip-git-repo-check");
    // Use read-only sandbox to avoid accidental writes
    args.push("-s", "read-only");

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: (process.env.PATH ?? "") + extraPath,
      // Remove ELECTRON_RUN_AS_NODE to avoid Electron hijacking the subprocess
      ELECTRON_RUN_AS_NODE: undefined,
    };

    if (options.useApiKey && options.apiKey) {
      env.OPENAI_API_KEY = options.apiKey;
    }

    const useShell = isWin && /\.(cmd|bat)$/i.test(execPath);

    let proc: ChildProcess;
    try {
      proc = spawn(execPath, args, {
        cwd: options.vaultPath,
        env,
        shell: useShell,
      });
    } catch (e) {
      callbacks.onError(t("notice.processError", (e as Error).message));
      return;
    }

    this.proc = proc;
    let stdoutBuffer = "";
    let stderrAccum = "";
    let sessionEmitted = false;

    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");

    proc.stdout?.on("data", (data: string) => {
      stdoutBuffer += data;
      let nl: number;
      while ((nl = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line) continue;
        this.handleLine(line, callbacks, { sessionEmitted, setSessionEmitted: (v) => { sessionEmitted = v; } });
      }
    });

    proc.stderr?.on("data", (data: string) => {
      stderrAccum += data;
    });

    proc.on("error", (err) => {
      this.proc = null;
      const e = err as Error & { code?: string };
      if (e.code === "ENOENT") {
        callbacks.onError(t("notice.codexNotFound", execPath));
      } else {
        callbacks.onError(t("notice.processError", err.message));
      }
    });

    proc.on("close", (code) => {
      this.proc = null;
      if (stdoutBuffer.trim()) {
        this.handleLine(stdoutBuffer.trim(), callbacks, { sessionEmitted, setSessionEmitted: (v) => { sessionEmitted = v; } });
      }
      if (code === 0) {
        callbacks.onComplete();
      } else {
        callbacks.onError(
          stderrAccum.trim() || `codex exited with code ${code}`
        );
      }
    });
  }

  cancel(): void {
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  private handleLine(
    line: string,
    callbacks: RunCallbacks,
    state: { sessionEmitted: boolean; setSessionEmitted: (v: boolean) => void }
  ): void {
    let event: CodexEvent;
    try {
      event = JSON.parse(line) as CodexEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "session_started": {
        const sid = (event as { session_id?: string }).session_id;
        if (sid && !state.sessionEmitted) {
          state.setSessionEmitted(true);
          callbacks.onSessionId(sid);
        }
        break;
      }
      case "message": {
        const msg = event as { role?: string; content?: string; session_id?: string };
        // Emit session_id if present on message event (some versions include it here)
        if (msg.session_id && !state.sessionEmitted) {
          state.setSessionEmitted(true);
          callbacks.onSessionId(msg.session_id);
        }
        if (msg.role === "assistant" && typeof msg.content === "string") {
          callbacks.onChunk(msg.content);
        }
        break;
      }
      case "message_delta": {
        const delta = event as { content?: string };
        if (typeof delta.content === "string" && delta.content) {
          callbacks.onChunk(delta.content);
        }
        break;
      }
      case "error": {
        const err = event as { message?: string };
        callbacks.onError(err.message ?? "Codex error");
        break;
      }
    }
  }

  static async findCodexPath(): Promise<string> {
    const isWin = process.platform === "win32";
    const lookup = isWin ? "where codex" : "which codex";
    try {
      const { stdout } = await execAsync(lookup);
      const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (isWin) {
        const cmdShim = lines.find((l) => /\.(cmd|bat|exe)$/i.test(l));
        if (cmdShim) return cmdShim;
      }
      if (lines[0]) return lines[0];
    } catch {
      // fall through
    }
    return "codex";
  }
}
