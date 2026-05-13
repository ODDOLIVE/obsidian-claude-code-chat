import { spawn, exec, ChildProcess } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { delimiter, isAbsolute, join } from "path";
import { promisify } from "util";
import { t } from "./i18n";
import { TEXT_EXTENSIONS } from "./types";

// Hard cap for the prompt we hand to `claude -p "..."`. Windows command-line
// limit is around 32 KB; we stay under it with margin for the rest of argv.
const MAX_PROMPT_BYTES = 28_000;

const execAsync = promisify(exec);

export interface RunOptions {
  prompt: string;
  model: string;
  claudePath: string;
  vaultPath: string;
  sessionFlag: "--continue" | "--resume" | null;
  sessionId?: string;
  attachedFilePaths?: string[];
  apiKey?: string;
  useApiKey?: boolean;
}

export interface RunCallbacks {
  onChunk: (text: string) => void;
  onSessionId: (id: string) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export class ClaudeRunner {
  private proc: ChildProcess | null = null;
  private resolvedPath: string | null = null;

  async run(options: RunOptions, callbacks: RunCallbacks): Promise<void> {
    if (this.proc) {
      callbacks.onError(t("notice.previousRunRunning"));
      return;
    }

    let fullPrompt = options.prompt;
    const pathOnlyBlock = (filePath: string): string =>
      `\n\n---\n${t("attach.attached", filePath)}\n${t("attach.binaryHint")}\n---`;

    if (options.attachedFilePaths && options.attachedFilePaths.length > 0) {
      for (const filePath of options.attachedFilePaths) {
        const ext = (filePath.split(".").pop() ?? "").toLowerCase();
        if (TEXT_EXTENSIONS.includes(ext)) {
          try {
            const fileContent = readFileSync(filePath, "utf-8");
            const block = `\n\n---\n${t("attach.attached", filePath)}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n---`;
            // Auto-fallback: if inlining this file would push the prompt
            // past the OS argv limit, attach by path instead.
            if (Buffer.byteLength(fullPrompt + block, "utf-8") > MAX_PROMPT_BYTES) {
              fullPrompt += pathOnlyBlock(filePath);
            } else {
              fullPrompt += block;
            }
          } catch (e) {
            fullPrompt += `\n\n${t(
              "notice.fileReadFailed",
              filePath,
              (e as Error).message
            )}`;
          }
        } else {
          // Binary / image: reference path so Claude can load it via its Read tool.
          fullPrompt += pathOnlyBlock(filePath);
        }
      }
    }

    if (Buffer.byteLength(fullPrompt, "utf-8") > MAX_PROMPT_BYTES) {
      callbacks.onError(
        t(
          "error.promptTooLong",
          Math.round(Buffer.byteLength(fullPrompt, "utf-8") / 1024),
          Math.round(MAX_PROMPT_BYTES / 1024)
        )
      );
      return;
    }

    const args: string[] = [
      "-p",
      fullPrompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      options.model,
    ];

    if (options.sessionFlag === "--continue") {
      args.push("--continue");
    } else if (options.sessionFlag === "--resume" && options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    const isWin = process.platform === "win32";
    const extraPath = isWin
      ? ""
      : `${delimiter}/usr/local/bin${delimiter}/opt/homebrew/bin`;

    let execPath = options.claudePath;
    if (!isAbsolute(execPath)) {
      if (!this.resolvedPath) {
        this.resolvedPath = await ClaudeRunner.findClaudePath();
      }
      if (this.resolvedPath) execPath = this.resolvedPath;
    }

    const useShell = isWin && /\.(cmd|bat)$/i.test(execPath);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: (process.env.PATH ?? "") + extraPath,
    };
    // Auth precedence: OAuth > API key.
    // If we are NOT using API key (OAuth mode or no auth), strip any inherited
    // ANTHROPIC_API_KEY so the CLI falls back to its OAuth credentials.
    if (options.useApiKey && options.apiKey) {
      env.ANTHROPIC_API_KEY = options.apiKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }

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

    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");

    proc.stdout?.on("data", (data: string) => {
      stdoutBuffer += data;
      let nl: number;
      while ((nl = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line) continue;
        this.handleLine(line, callbacks);
      }
    });

    proc.stderr?.on("data", (data: string) => {
      stderrAccum += data;
    });

    proc.on("error", (err) => {
      this.proc = null;
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        callbacks.onError(t("notice.claudeNotFound", execPath));
      } else {
        callbacks.onError(t("notice.processError", err.message));
      }
    });

    proc.on("close", (code) => {
      this.proc = null;
      if (stdoutBuffer.trim()) {
        this.handleLine(stdoutBuffer.trim(), callbacks);
        stdoutBuffer = "";
      }
      if (code === 0) {
        callbacks.onComplete();
      } else {
        callbacks.onError(
          stderrAccum.trim() || `claude exited with code ${code}`
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

  private handleLine(line: string, callbacks: RunCallbacks): void {
    let json: {
      type?: string;
      subtype?: string;
      session_id?: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }

    if (json.type === "assistant") {
      const blocks = json.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") {
          callbacks.onChunk(block.text);
        }
      }
    } else if (json.type === "result") {
      if (json.session_id) callbacks.onSessionId(json.session_id);
    } else if (json.type === "system" && json.subtype === "init") {
      if (json.session_id) callbacks.onSessionId(json.session_id);
    }
  }

  static async findClaudePath(): Promise<string> {
    const isWin = process.platform === "win32";
    const lookup = isWin ? "where claude" : "which claude";
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

    // Fallback: VS Code extension bundled native binary
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    if (home) {
      const extDir = join(home, ".vscode", "extensions");
      if (existsSync(extDir)) {
        try {
          const dirs = readdirSync(extDir)
            .filter((d) => d.startsWith("anthropic.claude-code-"))
            .sort()
            .reverse();
          const exeName = isWin ? "claude.exe" : "claude";
          for (const d of dirs) {
            const candidate = join(extDir, d, "resources", "native-binary", exeName);
            if (existsSync(candidate)) return candidate;
          }
        } catch {
          // fall through
        }
      }
    }

    return "claude";
  }
}
