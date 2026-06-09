import { spawn, exec, ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { delimiter, isAbsolute } from "path";
import { promisify } from "util";
import { t } from "./i18n";
import { TEXT_EXTENSIONS } from "./types";
import type { AgentRunner, RunOptions, RunCallbacks } from "./AgentRunner";

const MAX_PROMPT_BYTES = 28_000;
const execAsync = promisify(exec);

// Gemini CLI stream-json events (v0.43.0, verified from source code).
// Event flow: init → message(delta:true)* → result{status:"success"}
//
// Session strategy: Gemini CLI's --resume relies on scanning JSONL files on disk,
// which causes EMFILE errors when many sessions exist and still fails to find
// sessions created via stream-json mode. Instead, we maintain conversation
// continuity by injecting prior messages directly into each prompt (history
// injection). The session ID we track is sourced from the init event and is
// used for plugin-side UI only (session list, auto-save), not for --resume.
//
// Prompt: written to stdin; "-p ." triggers headless mode (CLI appends "." to
// stdin content). A plain space fails through the Windows .cmd wrapper.
type GeminiEvent =
  | { type: "init"; session_id?: string; model?: string }
  | { type: "message"; role?: string; content?: string; delta?: boolean }
  | { type: "tool_use"; [key: string]: unknown }
  | { type: "tool_result"; [key: string]: unknown }
  | { type: "error"; severity?: string; message?: string }
  | { type: "result"; status?: string; error?: { message?: string } }
  | { type: string; [key: string]: unknown };

export class GeminiRunner implements AgentRunner {
  private proc: ChildProcess | null = null;
  private resolvedPath: string | null = null;

  async run(options: RunOptions, callbacks: RunCallbacks): Promise<void> {
    if (this.proc) {
      callbacks.onError(t("notice.previousRunRunning"));
      return;
    }

    // Build prompt: inject history for conversational continuity, then add current prompt.
    let historyItems = [...(options.history ?? [])];
    const buildWithHistory = (items: typeof historyItems) => {
      if (items.length === 0) return options.prompt;
      const lines = items
        .map((m) => `${m.role === "user" ? "User" : "Gemini"}: ${m.content}`)
        .join("\n\n");
      return `Previous conversation:\n${lines}\n\nCurrent message:\n${options.prompt}`;
    };

    // Trim oldest user+assistant pairs from history if the prompt would be too large.
    let fullPrompt = buildWithHistory(historyItems);
    while (historyItems.length >= 2 && Buffer.byteLength(fullPrompt, "utf-8") > MAX_PROMPT_BYTES) {
      historyItems = historyItems.slice(2);
      fullPrompt = buildWithHistory(historyItems);
    }

    // Inline attached file contents.
    for (const filePath of options.attachedFilePaths ?? []) {
      const ext = (filePath.split(".").pop() ?? "").toLowerCase();
      const header = `\n\n---\n${t("attach.attached", filePath)}\n`;
      const footer = `\n---`;
      if (TEXT_EXTENSIONS.includes(ext)) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const block = `${header}\`\`\`${ext}\n${content}\`\`\`${footer}`;
          fullPrompt += Buffer.byteLength(fullPrompt + block, "utf-8") <= MAX_PROMPT_BYTES
            ? block
            : `${header}${t("attach.binaryHint")}${footer}`;
        } catch (e) {
          fullPrompt += `\n\n${t("notice.fileReadFailed", filePath, (e as Error).message)}`;
        }
      } else {
        fullPrompt += `${header}${t("attach.binaryHint")}${footer}`;
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

    let execPath = options.execPath;
    if (!isAbsolute(execPath) || execPath === "gemini") {
      if (!this.resolvedPath) {
        this.resolvedPath = await GeminiRunner.findGeminiPath();
      }
      if (this.resolvedPath) execPath = this.resolvedPath;
    }

    const isWin = process.platform === "win32";
    const extraPath = isWin
      ? ""
      : `${delimiter}/usr/local/bin${delimiter}/opt/homebrew/bin`;

    // No --resume: session continuity is handled via history injection above.
    const args: string[] = [
      "-p", ".",   // "." triggers headless mode; actual prompt is written to stdin
      "-o", "stream-json",
      "--yolo",
      "--skip-trust",
    ];
    if (options.model) {
      args.push("-m", options.model);
    }

    const env: Record<string, string | undefined> = {
      ...process.env,
      PATH: (process.env.PATH ?? "") + extraPath,
      ELECTRON_RUN_AS_NODE: undefined,
    };

    if (options.useApiKey && options.apiKey) {
      env.GEMINI_API_KEY = options.apiKey;
    }

    const useShell = isWin && /\.(cmd|bat)$/i.test(execPath);

    let proc: ChildProcess;
    try {
      proc = spawn(execPath, args, {
        cwd: options.vaultPath,
        env,
        shell: useShell,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      callbacks.onError(t("notice.processError", (e as Error).message));
      return;
    }

    proc.stdin?.write(fullPrompt, "utf-8");
    proc.stdin?.end();

    this.proc = proc;
    let stdoutBuffer = "";
    let stderrAccum = "";
    let turnCompleted = false;

    proc.stdout?.setEncoding("utf-8");
    proc.stderr?.setEncoding("utf-8");

    proc.stdout?.on("data", (data: string) => {
      stdoutBuffer += data;
      let nl: number;
      while ((nl = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, nl).trim();
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
        if (!line) continue;
        if (this.handleLine(line, callbacks)) {
          turnCompleted = true;
        }
      }
    });

    proc.stderr?.on("data", (data: string) => {
      stderrAccum += data;
    });

    proc.on("error", (err) => {
      this.proc = null;
      const e = err as Error & { code?: string };
      if (e.code === "ENOENT") {
        callbacks.onError(t("notice.geminiNotFound", execPath));
      } else {
        callbacks.onError(t("notice.processError", err.message));
      }
    });

    proc.on("close", (code) => {
      this.proc = null;
      if (stdoutBuffer.trim()) {
        if (this.handleLine(stdoutBuffer.trim(), callbacks)) {
          turnCompleted = true;
        }
        stdoutBuffer = "";
      }
      if (code === 0) {
        if (!turnCompleted) callbacks.onComplete();
      } else {
        callbacks.onError(
          stderrAccum.trim() || `gemini exited with code ${code}`
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

  // Returns true when the turn is complete.
  private handleLine(line: string, callbacks: RunCallbacks): boolean {
    let event: GeminiEvent;
    try {
      event = JSON.parse(line) as GeminiEvent;
    } catch {
      return false;
    }

    switch (event.type) {
      case "init": {
        // Use the CLI-generated session_id for plugin-side tracking only (not for --resume).
        const sid = (event as { session_id?: string }).session_id;
        if (sid) callbacks.onSessionId(sid);
        break;
      }
      case "message": {
        const msg = event as { role?: string; content?: string; delta?: boolean };
        // delta:true = streaming chunk; delta:false = final full copy (skip to avoid duplication)
        if (msg.role === "assistant" && msg.delta === true && typeof msg.content === "string") {
          callbacks.onChunk(msg.content);
        }
        break;
      }
      case "result": {
        const res = event as { status?: string; error?: { message?: string } };
        if (res.status === "success") {
          callbacks.onComplete();
          return true;
        } else if (res.status === "error") {
          callbacks.onError(res.error?.message ?? "Gemini error");
        }
        break;
      }
      case "error": {
        const err = event as { severity?: string; message?: string };
        if (err.severity !== "warning") {
          callbacks.onError(err.message ?? "Gemini error");
        }
        break;
      }
    }
    return false;
  }

  static async findGeminiPath(): Promise<string> {
    const isWin = process.platform === "win32";
    const lookup = isWin ? "where gemini" : "which gemini";
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
    return "gemini";
  }
}
