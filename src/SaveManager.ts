import { App, TFile, TFolder, normalizePath } from "obsidian";
import { ChatMessage, ClaudeCodeSettings } from "./types";

export interface ParsedChat {
  sessionId: string;
  model: string;
  messages: ChatMessage[];
}

export class SaveManager {
  constructor(private app: App, private settings: ClaudeCodeSettings) {}

  listSavedFiles(): TFile[] {
    const folder = normalizePath(this.settings.saveFolder);
    const tfolder = this.app.vault.getAbstractFileByPath(folder);
    if (!(tfolder instanceof TFolder)) return [];
    const out: TFile[] = [];
    for (const child of tfolder.children) {
      if (child instanceof TFile && child.extension === "md") out.push(child);
    }
    out.sort((a, b) => b.stat.mtime - a.stat.mtime);
    return out;
  }

  async loadFile(file: TFile): Promise<ParsedChat> {
    const text = await this.app.vault.read(file);
    return parseChat(text);
  }

  async save(
    messages: ChatMessage[],
    model: string,
    sessionId: string,
    customName?: string,
    previousPath?: string | null
  ): Promise<string> {
    if (messages.length === 0) return previousPath ?? "";

    const folder = normalizePath(this.settings.saveFolder);
    await this.ensureFolder(folder);

    const date = new Date();
    const dateStr = date
      .toISOString()
      .slice(0, 16)
      .replace("T", "-")
      .replace(":", "-");
    const shortId = (sessionId || "unknown").slice(0, 8);
    const safeName = customName ? sanitizeFileName(customName) : "";
    const fileName = safeName
      ? `${safeName}.md`
      : `${dateStr}-${shortId}.md`;
    const filePath = normalizePath(`${folder}/${fileName}`);

    const content = this.buildContent(messages, model, sessionId);

    if (previousPath && previousPath !== filePath) {
      const prev = this.app.vault.getAbstractFileByPath(previousPath);
      if (prev instanceof TFile) {
        const collision = this.app.vault.getAbstractFileByPath(filePath);
        if (collision && collision !== prev) {
          await this.app.vault.modify(prev, content);
          return prev.path;
        }
        await this.app.fileManager.renameFile(prev, filePath);
        const renamed = this.app.vault.getAbstractFileByPath(filePath);
        if (renamed instanceof TFile) {
          await this.app.vault.modify(renamed, content);
        }
        return filePath;
      }
    }

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
    return filePath;
  }

  private buildContent(
    messages: ChatMessage[],
    model: string,
    sessionId: string
  ): string {
    const now = new Date().toISOString();
    const lines: string[] = [
      "---",
      `date: ${now}`,
      `model: ${model}`,
      `session_id: ${sessionId}`,
      `tags: [claude-chat]`,
      "---",
      "",
    ];

    let currentDate = "";
    for (const msg of messages) {
      const ts = new Date(msg.timestamp);
      const dateStr = formatDate(ts);
      const timeStr = formatTime(ts);

      if (dateStr !== currentDate) {
        if (currentDate) lines.push("");
        lines.push(`# ${dateStr}`);
        lines.push("");
        currentDate = dateStr;
      }

      const role = msg.role === "user" ? "You" : "Claude";
      const body = indentContinuation(msg.content);
      lines.push(`- **${role}(${dateStr}, ${timeStr}):** ${body}`);
    }

    return lines.join("\n");
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const path = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) {
      await this.app.vault.createFolder(path);
    }
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function indentContinuation(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 1) return lines[0];
  return lines.map((l, i) => (i === 0 ? l : "  " + l)).join("\n");
}

const BULLET_RE =
  /^- (?:\*\*)?(You|Claude)\((\d{4}-\d{2}-\d{2}), (\d{1,2}:\d{2})\):(?:\*\*)? ?(.*)$/;

function parseChat(text: string): ParsedChat {
  let sessionId = "";
  let model = "";
  let body = text;

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    const fm = fmMatch[1];
    sessionId = (fm.match(/^session_id:\s*(.+)$/m)?.[1] ?? "").trim();
    model = (fm.match(/^model:\s*(.+)$/m)?.[1] ?? "").trim();
    body = text.slice(fmMatch[0].length);
  }

  for (const header of ["## Conversation", "## 대화 기록"]) {
    const idx = body.indexOf(header);
    if (idx >= 0) {
      body = body.slice(idx + header.length);
      break;
    }
  }

  const messages: ChatMessage[] = [];
  const lines = body.split(/\r?\n/);
  let current: { role: "user" | "assistant"; time: string; content: string[]; expectTime: boolean } | null = null;

  const flush = () => {
    if (current) {
      let ts = current.time;
      if (ts && /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(ts)) {
        // Convert "YYYY-MM-DD HH:MM" to ISO so downstream code sees a valid date.
        const iso = new Date(ts.replace(" ", "T")).toISOString();
        ts = iso;
      }
      messages.push({
        role: current.role,
        content: current.content.join("\n").trim(),
        timestamp: ts || new Date().toISOString(),
      });
      current = null;
    }
  };

  for (const line of lines) {
    // New bullet format: "- You(YYYY-MM-DD, HH:MM): ..."
    const m = line.match(BULLET_RE);
    if (m) {
      flush();
      current = {
        role: m[1] === "You" ? "user" : "assistant",
        time: `${m[2]} ${m[3]}`,
        content: m[4] ? [m[4]] : [],
        expectTime: false,
      };
      continue;
    }

    // Continuation (2-space indent) for the new bullet format
    if (current && !current.expectTime && /^ {2}/.test(line)) {
      current.content.push(line.slice(2));
      continue;
    }

    // Day-group header in new format → ignored (info only)
    if (/^# \d{4}-\d{2}-\d{2}\s*$/.test(line)) {
      continue;
    }

    // Legacy format
    if (line.startsWith("### 🧑 You") || line.startsWith("### You")) {
      flush();
      current = { role: "user", time: "", content: [], expectTime: true };
    } else if (line.startsWith("### 🤖 Claude") || line.startsWith("### Claude")) {
      flush();
      current = { role: "assistant", time: "", content: [], expectTime: true };
    } else if (line.trim() === "---") {
      flush();
    } else if (current) {
      if (current.expectTime) {
        if (line.trim() === "") {
          current.expectTime = false;
        } else {
          current.time = line.trim();
          current.expectTime = false;
        }
      } else {
        current.content.push(line);
      }
    }
  }
  flush();

  return { sessionId, model, messages };
}
