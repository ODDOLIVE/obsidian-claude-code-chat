import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Modal,
  TFile,
  FuzzySuggestModal,
  App,
  Menu,
  Notice,
  normalizePath,
  setIcon,
} from "obsidian";
import type ClaudeCodeChatPlugin from "./main";
import { ClaudeRunner, RunOptions } from "./ClaudeRunner";
import { SessionManager, SessionRecord } from "./SessionManager";
import { SaveManager } from "./SaveManager";
import { ChatMessage, MAX_DROP_FILE_SIZE } from "./types";
import { t } from "./i18n";
import { AuthService } from "./AuthService";

export const VIEW_TYPE_CLAUDE = "claude-code-chat";

const MODELS: Array<{ id: string; label: string }> = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

export class ClaudeView extends ItemView {
  // Header
  private headerEl!: HTMLDivElement;
  private nameWrapEl!: HTMLDivElement;
  private nameInputEl!: HTMLInputElement;
  private newChatBtnEl!: HTMLButtonElement;
  private historyBtnEl!: HTMLButtonElement;
  private saveBtnEl!: HTMLButtonElement;
  private searchDropdownEl: HTMLElement | null = null;

  // Messages
  private messagesEl!: HTMLDivElement;
  private emptyStateEl: HTMLElement | null = null;

  // Input area
  private inputAreaEl!: HTMLDivElement;
  private attachFileBtnEl!: HTMLButtonElement;
  private attachNoteBtnEl!: HTMLButtonElement;
  private inputBoxEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private plusBtnEl!: HTMLButtonElement;
  private slashBtnEl!: HTMLButtonElement;
  private modelBtnEl!: HTMLButtonElement;
  private sendBtnEl!: HTMLButtonElement;
  private attachedFileDisplayEl: HTMLElement | null = null;
  private slashPopupEl: HTMLElement | null = null;

  // State
  private currentModel: string;
  private streamingEl: HTMLDivElement | null = null;
  private streamingBuffer = "";
  private attachedFiles: TFile[] = [];
  private isLoading = false;
  private wasCancelled = false;
  private messages: ChatMessage[] = [];

  private runner = new ClaudeRunner();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ClaudeCodeChatPlugin,
    private sessionManager: SessionManager,
    private saveManager: SaveManager
  ) {
    super(leaf);
    this.currentModel = plugin.settings.defaultModel;
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDE;
  }

  getDisplayText(): string {
    return "Claude Code Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.style.cssText =
      "display:flex;flex-direction:column;height:100%;padding:8px;gap:8px;box-sizing:border-box;";

    this.buildHeader(root);
    this.buildMessages(root);
    this.buildInputArea(root);
    this.setupDragDrop(root);
    this.refreshNameInput();
  }

  async onClose(): Promise<void> {
    // No-op
  }

  // ---- Builders ----

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv();
    this.headerEl.style.cssText =
      "display:flex;gap:6px;align-items:center;flex-shrink:0;position:relative;";

    this.nameWrapEl = this.headerEl.createDiv();
    this.nameWrapEl.style.cssText = "flex:1;position:relative;";

    this.nameInputEl = this.nameWrapEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("header.chatNamePlaceholder") },
    });
    this.nameInputEl.style.cssText = `
      width:100%;
      padding:6px 10px;
      font-size:13px;
      border:1px solid var(--background-modifier-border);
      border-radius:6px;
      background:var(--background-primary);
      box-sizing:border-box;
    `;
    this.nameInputEl.addEventListener("input", () => {
      this.sessionManager.setCustomName(this.nameInputEl.value);
      this.refreshSearchDropdown();
    });
    this.nameInputEl.addEventListener("focus", () => {
      this.refreshSearchDropdown();
    });
    this.nameInputEl.addEventListener("blur", () => {
      window.setTimeout(() => this.closeSearchDropdown(), 150);
    });
    this.nameInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeSearchDropdown();
    });

    this.newChatBtnEl = this.headerEl.createEl("button", {
      attr: { title: t("header.newChat") },
    });
    this.newChatBtnEl.style.cssText = this.headerIconBtnStyle();
    setIcon(this.newChatBtnEl, "square-pen");
    this.newChatBtnEl.onclick = () => this.onNewChat();

    this.historyBtnEl = this.headerEl.createEl("button", {
      attr: { title: t("header.history") },
    });
    this.historyBtnEl.style.cssText = this.headerIconBtnStyle();
    setIcon(this.historyBtnEl, "history");
    this.historyBtnEl.onclick = () => this.openSessionList();

    this.saveBtnEl = this.headerEl.createEl("button", {
      attr: { title: t("header.save") },
    });
    this.saveBtnEl.style.cssText = this.headerIconBtnStyle();
    setIcon(this.saveBtnEl, "save");
    this.saveBtnEl.onclick = () => this.onManualSave();
  }

  private headerIconBtnStyle(): string {
    return `
      padding:6px;
      cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      width:32px;height:32px;
      border:1px solid var(--background-modifier-border);
      border-radius:6px;
      background:var(--background-primary);
      color:var(--text-muted);
    `;
  }

  private refreshSearchDropdown(): void {
    const query = this.nameInputEl.value.trim().toLowerCase();
    if (!query) {
      this.closeSearchDropdown();
      return;
    }
    const files = this.saveManager.listSavedFiles();
    const matches = files.filter((f) =>
      f.basename.toLowerCase().includes(query)
    );
    this.renderSearchDropdown(matches);
  }

  private renderSearchDropdown(matches: TFile[]): void {
    this.closeSearchDropdown();
    if (matches.length === 0) return;

    const dropdown = document.createElement("div");
    dropdown.style.cssText = `
      position:absolute;
      top:calc(100% + 4px);
      left:0;
      right:0;
      max-height:240px;
      overflow-y:auto;
      background:var(--background-primary);
      border:1px solid var(--background-modifier-border);
      border-radius:6px;
      box-shadow:0 4px 12px rgba(0,0,0,0.12);
      z-index:50;
      padding:4px;
    `;

    for (const file of matches.slice(0, 20)) {
      const item = dropdown.createDiv();
      item.style.cssText = `
        padding:6px 8px;
        border-radius:4px;
        cursor:pointer;
        font-size:12px;
      `;
      const titleEl = item.createDiv({ text: file.basename });
      titleEl.style.cssText =
        "font-weight:500;color:var(--text-normal);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const meta = item.createEl("small", {
        text: `${file.parent?.path ?? ""} · ${new Date(
          file.stat.mtime
        ).toLocaleString("ko-KR")}`,
      });
      meta.style.cssText = "opacity:0.6;";
      item.onmouseenter = () => {
        item.style.background = "var(--background-modifier-hover)";
      };
      item.onmouseleave = () => {
        item.style.background = "transparent";
      };
      item.onmousedown = (e) => {
        e.preventDefault();
        void this.resumeFromFile(file);
      };
    }

    this.nameWrapEl.appendChild(dropdown);
    this.searchDropdownEl = dropdown;
  }

  private closeSearchDropdown(): void {
    if (this.searchDropdownEl) {
      this.searchDropdownEl.remove();
      this.searchDropdownEl = null;
    }
  }

  private async resumeFromFile(file: TFile): Promise<void> {
    this.closeSearchDropdown();
    try {
      const parsed = await this.saveManager.loadFile(file);
      this.clearMessages();
      this.hideEmptyState();
      for (const msg of parsed.messages) {
        this.replayMessage(msg);
      }
      this.scrollToBottom();

      if (parsed.sessionId) {
        this.sessionManager.resumeSession(parsed.sessionId);
        await this.sessionManager.saveMessages(
          parsed.sessionId,
          parsed.messages
        );
        this.sessionManager.setLastSavedPath(file.path);
        this.sessionManager.setCustomName(file.basename);
      }
      if (parsed.model) this.setCurrentModel(parsed.model);
      this.nameInputEl.value = file.basename;
    } catch (e) {
      new Notice(t("notice.fileLoadFailed", (e as Error).message));
    }
  }

  private buildMessages(root: HTMLElement): void {
    this.messagesEl = root.createDiv();
    this.messagesEl.style.cssText =
      "flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px;user-select:text;-webkit-user-select:text;cursor:text;";
    this.renderEmptyState();
  }

  private buildInputArea(root: HTMLElement): void {
    this.inputAreaEl = root.createDiv();
    this.inputAreaEl.style.cssText =
      "display:flex;flex-direction:column;gap:6px;flex-shrink:0;";

    const row = this.inputAreaEl.createDiv();
    row.style.cssText = "display:flex;gap:6px;align-items:stretch;";

    // Left side: attach buttons
    const leftCol = row.createDiv();
    leftCol.style.cssText =
      "display:flex;flex-direction:column;gap:4px;justify-content:flex-end;";

    this.attachFileBtnEl = leftCol.createEl("button", {
      attr: { title: t("input.attachFile") },
    });
    this.attachFileBtnEl.style.cssText = this.iconBtnStyle();
    setIcon(this.attachFileBtnEl, "paperclip");
    this.attachFileBtnEl.onclick = () => this.onAttachFile();

    this.attachNoteBtnEl = leftCol.createEl("button", {
      attr: { title: t("input.attachCurrent") },
    });
    this.attachNoteBtnEl.style.cssText = this.iconBtnStyle();
    setIcon(this.attachNoteBtnEl, "file-text");
    this.attachNoteBtnEl.onclick = () => this.onAttachCurrentNote();

    // Input box (border container)
    this.inputBoxEl = row.createDiv();
    this.inputBoxEl.style.cssText = `
      flex:1;
      display:flex;
      flex-direction:column;
      border:1px solid var(--background-modifier-border);
      border-radius:10px;
      background:var(--background-primary);
      padding:8px 10px;
      gap:6px;
    `;

    this.inputEl = this.inputBoxEl.createEl("textarea");
    this.inputEl.placeholder = t("input.writeMessage");
    this.inputEl.style.cssText = `
      width:100%;
      resize:none;
      min-height:48px;
      max-height:240px;
      padding:0;
      border:none;
      outline:none;
      background:transparent;
      font-family:inherit;
      font-size:13px;
      line-height:1.5;
      color:var(--text-normal);
    `;
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (this.isLoading) this.onStop();
        else this.onSend();
        return;
      }
      if (e.key === "/" && this.inputEl.value === "") {
        e.preventDefault();
        this.openSlashCommand();
      }
    });
    this.inputEl.addEventListener("input", () => this.autosizeInput());

    // Bottom controls inside input box
    const controls = this.inputBoxEl.createDiv();
    controls.style.cssText =
      "display:flex;align-items:center;gap:6px;";

    // Left controls: + and /
    this.plusBtnEl = controls.createEl("button", {
      attr: { title: t("input.menu") },
    });
    this.plusBtnEl.style.cssText = this.smallIconBtnStyle();
    setIcon(this.plusBtnEl, "plus");
    this.plusBtnEl.onclick = (e) => this.openPlusMenu(e);

    this.slashBtnEl = controls.createEl("button", {
      attr: { title: t("input.slashCmd") },
    });
    this.slashBtnEl.style.cssText = this.smallIconBtnStyle();
    setIcon(this.slashBtnEl, "slash");
    this.slashBtnEl.onclick = () => this.openSlashCommand();

    // Spacer
    const spacer = controls.createDiv();
    spacer.style.cssText = "flex:1;";

    // Right controls: model dropdown + send
    this.modelBtnEl = controls.createEl("button");
    this.modelBtnEl.style.cssText = `
      display:flex;align-items:center;gap:4px;
      padding:4px 8px;
      background:transparent;
      border:none;
      cursor:pointer;
      font-size:12px;
      color:var(--text-muted);
      border-radius:4px;
    `;
    this.refreshModelButton();
    this.modelBtnEl.onclick = (e) => this.openModelMenu(e);

    this.sendBtnEl = controls.createEl("button", {
      attr: { title: t("input.send") },
    });
    this.sendBtnEl.style.cssText = `
      padding:6px 8px;
      cursor:pointer;
      border:none;
      border-radius:6px;
      background:var(--interactive-accent);
      color:var(--text-on-accent);
      display:flex;align-items:center;justify-content:center;
    `;
    setIcon(this.sendBtnEl, "arrow-up");
    this.sendBtnEl.onclick = () => {
      if (this.isLoading) this.onStop();
      else this.onSend();
    };
  }

  private iconBtnStyle(): string {
    return `
      padding:6px;
      cursor:pointer;
      background:transparent;
      border:1px solid var(--background-modifier-border);
      border-radius:8px;
      display:flex;align-items:center;justify-content:center;
      width:32px;height:32px;
      color:var(--text-muted);
    `;
  }

  private smallIconBtnStyle(): string {
    return `
      padding:4px;
      cursor:pointer;
      background:transparent;
      border:none;
      border-radius:4px;
      display:flex;align-items:center;justify-content:center;
      width:24px;height:24px;
      color:var(--text-muted);
    `;
  }

  private autosizeInput(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height =
      Math.min(this.inputEl.scrollHeight, 240) + "px";
  }

  // ---- Public API ----

  appendMessage(
    role: "user" | "assistant",
    content: string,
    attachedFileNames?: string[]
  ): void {
    this.hideEmptyState();
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    const isUser = role === "user";
    const msgEl = this.messagesEl.createDiv({
      cls: isUser ? "claude-user-msg" : "claude-assistant-msg",
    });
    msgEl.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
      align-self: ${isUser ? "flex-end" : "flex-start"};
      background: var(--${isUser ? "interactive-accent" : "background-secondary"});
      color: var(--${isUser ? "text-on-accent" : "text-normal"});
      word-break: break-word;
    `;
    forceSelectable(msgEl);
    const label = msgEl.createDiv({ text: isUser ? "You" : "Claude" });
    label.style.cssText = "font-size:11px;opacity:0.7;margin-bottom:4px;";
    const body = msgEl.createDiv();
    forceSelectable(body);
    if (isUser) {
      body.style.whiteSpace = "pre-wrap";
      body.setText(content);
    } else {
      MarkdownRenderer.render(this.app, content, body, "", this);
    }
    if (attachedFileNames && attachedFileNames.length > 0) {
      const badgeWrap = msgEl.createDiv();
      badgeWrap.style.cssText = "margin-top:6px;display:flex;flex-direction:column;gap:2px;";
      for (const name of attachedFileNames) {
        const badge = badgeWrap.createDiv({ text: `📎 ${name}` });
        badge.style.cssText = "font-size:11px;opacity:0.8;";
        forceSelectable(badge);
      }
    }
    this.scrollToBottom();
  }

  prepareAssistantMessage(): void {
    this.hideEmptyState();
    const wrap = this.messagesEl.createDiv();
    wrap.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
      align-self: flex-start;
      background: var(--background-secondary);
      color: var(--text-normal);
      word-break: break-word;
    `;
    forceSelectable(wrap);
    const label = wrap.createDiv({ text: "Claude" });
    label.style.cssText = "font-size:11px;opacity:0.7;margin-bottom:4px;";
    const body = wrap.createDiv({ cls: "claude-stream-body" });
    body.style.whiteSpace = "pre-wrap";
    forceSelectable(body);
    this.streamingEl = wrap;
    this.streamingBuffer = "";
    this.scrollToBottom();
  }

  appendStreamChunk(chunk: string): void {
    if (!this.streamingEl) this.prepareAssistantMessage();
    this.streamingBuffer += chunk;
    const body = this.streamingEl!.querySelector(
      ".claude-stream-body"
    ) as HTMLElement | null;
    if (body) body.setText(this.streamingBuffer);
    this.scrollToBottom();
  }

  appendErrorMessage(content: string): void {
    this.hideEmptyState();
    const msgEl = this.messagesEl.createDiv();
    msgEl.style.cssText = `
      padding: 10px 14px;
      margin: 6px 0;
      background: var(--background-modifier-error);
      border: 1px solid var(--text-error, #cc4444);
      border-radius: 8px;
      color: var(--text-on-accent, #ffffff);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      align-self: stretch;
    `;
    forceSelectable(msgEl);
    msgEl.setText(content);
    this.scrollToBottom();
  }

  finalizeStream(): void {
    if (!this.streamingEl) return;
    const body = this.streamingEl.querySelector(
      ".claude-stream-body"
    ) as HTMLElement | null;
    if (body) {
      body.empty();
      body.style.whiteSpace = "";
      MarkdownRenderer.render(this.app, this.streamingBuffer, body, "", this);
    }
    if (this.streamingBuffer) {
      this.messages.push({
        role: "assistant",
        content: this.streamingBuffer,
        timestamp: new Date().toISOString(),
      });
    }
    this.streamingEl = null;
    this.streamingBuffer = "";
    this.scrollToBottom();
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.attachFileBtnEl.disabled = loading;
    this.attachNoteBtnEl.disabled = loading;
    this.plusBtnEl.disabled = loading;
    this.slashBtnEl.disabled = loading;
    this.modelBtnEl.disabled = loading;
    if (loading) {
      this.sendBtnEl.empty();
      setIcon(this.sendBtnEl, "square");
      this.sendBtnEl.style.background = "var(--background-modifier-error)";
      this.sendBtnEl.setAttribute("title", t("input.stop"));
    } else {
      this.sendBtnEl.empty();
      setIcon(this.sendBtnEl, "arrow-up");
      this.sendBtnEl.style.background = "var(--interactive-accent)";
      this.sendBtnEl.setAttribute("title", t("input.send"));
    }
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  setCurrentModel(id: string): void {
    this.currentModel = id;
    this.refreshModelButton();
  }

  getAttachedFilePaths(): string[] {
    if (this.attachedFiles.length === 0) return [];
    const base =
      (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    return this.attachedFiles.map((f) => base + "/" + f.path);
  }

  clearAttachments(): void {
    this.attachedFiles = [];
    if (this.attachedFileDisplayEl) {
      this.attachedFileDisplayEl.remove();
      this.attachedFileDisplayEl = null;
    }
  }

  private addAttachment(file: TFile): boolean {
    if (this.attachedFiles.some((f) => f.path === file.path)) return false;
    this.attachedFiles.push(file);
    this.updateAttachmentDisplay();
    return true;
  }

  private removeAttachment(file: TFile): void {
    this.attachedFiles = this.attachedFiles.filter((f) => f.path !== file.path);
    this.updateAttachmentDisplay();
  }

  startNewChat(): void {
    this.onNewChat();
  }

  async saveCurrentChat(): Promise<void> {
    await this.onManualSave();
  }

  // ---- Handlers ----

  private async onSend(): Promise<void> {
    if (this.isLoading) return;
    const prompt = this.inputEl.value.trim();
    if (!prompt) return;
    this.wasCancelled = false;

    const apiKey = this.plugin.settings.apiKey?.trim() ?? "";
    const apiKeyOnly = this.plugin.settings.apiKeyOnly;

    // Strict guard: in API-token-only mode, refuse to fall back to OAuth.
    if (apiKeyOnly && !apiKey) {
      this.appendErrorMessage(t("error.apiKeyOnlyNoToken"));
      return;
    }

    const model = this.currentModel;
    this.sessionManager.setPreview(prompt, model);

    // Title sync: on the very first prompt of a new session, prepend a
    // "[Title: <customName>]" line so VS Code's Claude Code history view —
    // which derives its label from the first user message — shows the same
    // title we set here. UI keeps the original prompt; only the CLI payload
    // carries the prefix.
    const isFirstPrompt = !this.sessionManager.getCurrentSessionId();
    let cliPrompt = prompt;
    if (isFirstPrompt && this.plugin.settings.titleSync) {
      const customName = this.sessionManager.getCurrentCustomName();
      if (customName) {
        cliPrompt = `[Title: ${customName}]\n\n${prompt}`;
      }
    }

    const attachedNames = this.attachedFiles.map((f) => f.name);
    this.appendMessage("user", prompt, attachedNames);
    this.inputEl.value = "";
    this.autosizeInput();
    this.setLoading(true);
    this.prepareAssistantMessage();

    const vaultPath =
      (this.app.vault.adapter as { basePath?: string }).basePath ?? "";
    // Working directory used when spawning the CLI: user override > vault path.
    // Sharing the same cwd across Obsidian and VS Code lets Claude Code see the
    // same project sessions on both sides.
    const cwdOverride = this.plugin.settings.workingDirectory?.trim();
    const cwd = cwdOverride || vaultPath;

    const oauthDetected = AuthService.detectOAuth();
    // apiKeyOnly forces plugin-scoped auth: ignore system OAuth, use API key.
    const useApiKey = apiKeyOnly
      ? !!apiKey
      : !oauthDetected && !!apiKey;

    const options: RunOptions = {
      prompt: cliPrompt,
      model,
      claudePath: this.plugin.settings.claudePath,
      vaultPath: cwd,
      sessionFlag: this.sessionManager.getSessionFlag(),
      sessionId: this.sessionManager.getCurrentSessionId() ?? undefined,
      attachedFilePaths: this.getAttachedFilePaths(),
      apiKey,
      useApiKey,
    };

    this.runner.run(options, {
      onChunk: (text) => this.appendStreamChunk(text),
      onSessionId: (id) => {
        this.sessionManager.setSessionId(id);
      },
      onComplete: async () => {
        this.finalizeStream();
        this.setLoading(false);
        this.clearAttachments();

        const sid = this.sessionManager.getCurrentSessionId();
        if (sid) {
          void this.sessionManager.saveMessages(sid, this.messages);
        }

        if (this.plugin.settings.autoSave) {
          const sessionId = sid ?? "unknown";
          try {
            const savedPath = await this.saveManager.save(
              this.messages,
              this.currentModel,
              sessionId,
              this.nameInputEl.value,
              this.sessionManager.getLastSavedPath()
            );
            if (savedPath) this.sessionManager.setLastSavedPath(savedPath);
          } catch (e) {
            new Notice(t("notice.autoSaveFailed", (e as Error).message));
          }
        }
      },
      onError: (msg) => {
        if (this.wasCancelled) {
          this.wasCancelled = false;
          return;
        }
        this.finalizeStream();
        this.appendErrorMessage(`${t("session.errorPrefix")}\n\n${msg}`);
        this.setLoading(false);
        this.clearAttachments();
      },
    });
  }

  private onStop(): void {
    if (!this.runner.isRunning()) return;
    this.wasCancelled = true;
    this.runner.cancel();
    this.finalizeStream();
    this.appendMessage("assistant", t("session.cancelled"));
    this.setLoading(false);
    this.clearAttachments();
    const sid = this.sessionManager.getCurrentSessionId();
    if (sid) void this.sessionManager.saveMessages(sid, this.messages);
  }

  private onNewChat(): void {
    if (this.runner.isRunning()) {
      this.runner.cancel();
    }
    this.sessionManager.newSession();
    this.clearMessages();
    this.refreshNameInput();
  }

  private async onManualSave(): Promise<void> {
    if (this.messages.length === 0) {
      new Notice(t("notice.noConversationToSave"));
      return;
    }
    const sessionId =
      this.sessionManager.getCurrentSessionId() ?? "unknown";
    try {
      const savedPath = await this.saveManager.save(
        this.messages,
        this.currentModel,
        sessionId,
        this.nameInputEl.value,
        this.sessionManager.getLastSavedPath()
      );
      if (savedPath) this.sessionManager.setLastSavedPath(savedPath);
      new Notice(t("notice.saved"));
    } catch (e) {
      new Notice(t("notice.saveFailed", (e as Error).message));
    }
  }

  private onAttachFile(): void {
    new FileSuggestModal(this.app, (file: TFile) => {
      this.addAttachment(file);
    }).open();
  }

  private onAttachCurrentNote(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice(t("notice.noActiveNote"));
      return;
    }
    if (this.addAttachment(activeFile)) {
      new Notice(t("notice.attached", activeFile.name));
    }
  }

  private updateAttachmentDisplay(): void {
    if (this.attachedFileDisplayEl) {
      this.attachedFileDisplayEl.remove();
      this.attachedFileDisplayEl = null;
    }
    if (this.attachedFiles.length === 0) return;

    const display = document.createElement("div");
    this.inputAreaEl.insertBefore(display, this.inputAreaEl.firstChild);
    display.style.cssText = `
      display:flex;
      flex-direction:column;
      gap:4px;
      padding:6px 10px;
      background:var(--background-modifier-success);
      border-radius:4px;
      font-size:12px;
    `;

    for (const file of this.attachedFiles) {
      const row = display.createDiv();
      row.style.cssText = "display:flex;align-items:center;gap:8px;";
      const nameEl = row.createEl("span", { text: `📎 ${file.name}` });
      nameEl.style.cssText =
        "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const removeBtn = row.createEl("button", { text: "✕" });
      removeBtn.style.cssText =
        "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0 4px;";
      removeBtn.onclick = () => this.removeAttachment(file);
    }

    this.attachedFileDisplayEl = display;
  }

  // ---- Drag & drop ----

  private setupDragDrop(root: HTMLElement): void {
    let depth = 0;
    const overlay = root.createDiv();
    overlay.style.cssText = `
      position:absolute;
      inset:0;
      display:none;
      align-items:center;
      justify-content:center;
      background:rgba(0,0,0,0.25);
      border:2px dashed var(--interactive-accent);
      border-radius:8px;
      pointer-events:none;
      z-index:200;
      color:var(--text-on-accent);
      font-size:14px;
    `;
    overlay.setText("Drop to attach");
    root.style.position = "relative";

    root.addEventListener("dragenter", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      depth++;
      overlay.style.display = "flex";
    });
    root.addEventListener("dragover", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    root.addEventListener("dragleave", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.style.display = "none";
    });
    root.addEventListener("drop", async (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.style.display = "none";

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      for (const file of files) {
        await this.handleDroppedFile(file);
      }
    });
  }

  private isExternalFileDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes("Files");
  }

  private async handleDroppedFile(file: File): Promise<void> {
    if (file.size > MAX_DROP_FILE_SIZE) {
      new Notice(
        t(
          "attach.tooLarge",
          file.name,
          Math.round(MAX_DROP_FILE_SIZE / (1024 * 1024))
        )
      );
      return;
    }
    try {
      const tfile = await this.saveDroppedFile(file);
      if (this.addAttachment(tfile)) {
        new Notice(t("notice.attached", file.name));
      }
    } catch (err) {
      new Notice(t("attach.saveFailed", (err as Error).message));
    }
  }

  private async saveDroppedFile(file: File): Promise<TFile> {
    const folder = this.resolveAttachmentsFolder();
    await this.ensureVaultFolder(folder);

    const safe = file.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName = `${ts}-${safe}`;
    const path = normalizePath(`${folder}/${fileName}`);

    const buffer = await file.arrayBuffer();
    return await this.app.vault.createBinary(path, buffer);
  }

  private resolveAttachmentsFolder(): string {
    const override = this.plugin.settings.attachmentsFolder?.trim();
    if (override) return normalizePath(override);
    const save = this.plugin.settings.saveFolder || "Claude Chats";
    return normalizePath(`${save}/Chat attachments`);
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const path = normalizePath(folderPath);
    if (!this.app.vault.getAbstractFileByPath(path)) {
      try {
        await this.app.vault.createFolder(path);
      } catch {
        /* may race; ignore "already exists" */
      }
    }
  }

  // ---- Menus ----

  private openPlusMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("input.attachFile"))
        .setIcon("paperclip")
        .onClick(() => this.onAttachFile())
    );
    menu.addItem((item) =>
      item
        .setTitle(t("input.attachCurrent"))
        .setIcon("file-text")
        .onClick(() => this.onAttachCurrentNote())
    );
    menu.showAtMouseEvent(evt);
  }

  private openModelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    for (const m of MODELS) {
      menu.addItem((item) =>
        item
          .setTitle(m.label)
          .setChecked(m.id === this.currentModel)
          .onClick(() => this.setCurrentModel(m.id))
      );
    }
    menu.showAtMouseEvent(evt);
  }

  private openSlashCommand(): void {
    if (this.slashPopupEl) {
      this.closeSlashCommand();
      return;
    }

    const commands: SlashCommand[] = [
      ...MODELS.map<SlashCommand>((m) => ({
        id: "model",
        label: `${t("slash.modelPrefix")} ${m.label}`,
        hint: m.id,
        modelId: m.id,
      })),
      { id: "new-chat", label: t("slash.newChat"), hint: t("slash.newChatHint") },
      { id: "history", label: t("slash.history"), hint: t("slash.historyHint") },
      { id: "save", label: t("slash.save"), hint: t("slash.saveHint") },
      { id: "attach-file", label: t("slash.attachFile"), hint: t("slash.attachFileHint") },
      { id: "attach-note", label: t("slash.attachNote"), hint: t("slash.attachNoteHint") },
    ];

    const popup = document.createElement("div");
    popup.style.cssText = `
      display:flex;
      flex-direction:column;
      gap:4px;
      border:1px solid var(--background-modifier-border);
      border-radius:10px;
      background:var(--background-primary);
      box-shadow:0 4px 12px rgba(0,0,0,0.12);
      padding:8px;
      max-height:280px;
      flex-shrink:0;
    `;

    const headerRow = popup.createDiv();
    headerRow.style.cssText = "display:flex;gap:6px;align-items:center;";

    const searchInput = headerRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("slash.placeholder") },
    });
    searchInput.style.cssText = `
      flex:1;
      padding:6px 8px;
      border:none;
      outline:none;
      background:transparent;
      font-size:13px;
      color:var(--text-normal);
    `;

    const closeBtn = headerRow.createEl("button");
    closeBtn.style.cssText = `
      background:transparent;
      border:none;
      cursor:pointer;
      padding:4px;
      display:flex;align-items:center;justify-content:center;
      color:var(--text-muted);
      border-radius:50%;
      width:24px;height:24px;
    `;
    setIcon(closeBtn, "x-circle");
    closeBtn.onclick = () => this.closeSlashCommand();

    const listEl = popup.createDiv();
    listEl.style.cssText = `
      display:flex;flex-direction:column;
      overflow-y:auto;
      max-height:220px;
    `;

    let filtered: SlashCommand[] = commands;
    let activeIdx = 0;

    const render = () => {
      listEl.empty();
      filtered.forEach((cmd, i) => {
        const item = listEl.createDiv();
        const isActive = i === activeIdx;
        item.style.cssText = `
          padding:8px 10px;
          cursor:pointer;
          border-radius:6px;
          font-size:13px;
          background:${isActive ? "var(--background-modifier-hover)" : "transparent"};
        `;
        const text = cmd.hint
          ? `${cmd.label} — ${cmd.hint}`
          : cmd.label;
        item.setText(text);
        item.onmouseenter = () => {
          activeIdx = i;
          render();
        };
        item.onclick = () => {
          this.handleSlashCommand(cmd);
          this.closeSlashCommand();
        };
      });
      if (filtered.length === 0) {
        const empty = listEl.createDiv({ text: t("slash.noMatch") });
        empty.style.cssText = "padding:8px 10px;font-size:12px;opacity:0.6;";
      }
    };

    const applyFilter = (q: string) => {
      const lower = q.trim().toLowerCase();
      filtered = lower
        ? commands.filter(
            (c) =>
              c.label.toLowerCase().includes(lower) ||
              (c.hint?.toLowerCase().includes(lower) ?? false)
          )
        : commands;
      activeIdx = 0;
      render();
    };

    searchInput.addEventListener("input", () => applyFilter(searchInput.value));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeSlashCommand();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length > 0) {
          activeIdx = (activeIdx + 1) % filtered.length;
          render();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length > 0) {
          activeIdx =
            (activeIdx - 1 + filtered.length) % filtered.length;
          render();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const picked = filtered[activeIdx];
        if (picked) {
          this.handleSlashCommand(picked);
          this.closeSlashCommand();
        }
      }
    });

    const parent = this.inputAreaEl.parentElement;
    if (parent) parent.insertBefore(popup, this.inputAreaEl);
    this.slashPopupEl = popup;
    render();
    setTimeout(() => searchInput.focus(), 0);
  }

  private closeSlashCommand(): void {
    if (this.slashPopupEl) {
      this.slashPopupEl.remove();
      this.slashPopupEl = null;
      this.inputEl.focus();
    }
  }

  private handleSlashCommand(cmd: SlashCommand): void {
    switch (cmd.id) {
      case "model":
        if (cmd.modelId) this.setCurrentModel(cmd.modelId);
        break;
      case "new-chat":
        this.onNewChat();
        break;
      case "history":
        this.openSessionList();
        break;
      case "save":
        void this.onManualSave();
        break;
      case "attach-file":
        this.onAttachFile();
        break;
      case "attach-note":
        this.onAttachCurrentNote();
        break;
    }
  }

  private openSessionList(): void {
    const wasCurrent = (sid: string) =>
      this.sessionManager.getCurrentSessionId() === sid;
    new SessionListModal(
      this.app,
      this.sessionManager.getSessions(),
      (sessionId) => {
        this.sessionManager.resumeSession(sessionId);
        this.restoreSessionMessages(sessionId);
        this.refreshNameInput();
      },
      () => {
        this.sessionManager.newSession();
        this.clearMessages();
        this.refreshNameInput();
      },
      async (sessionId) => {
        const wasViewing = wasCurrent(sessionId);
        await this.sessionManager.deleteSession(sessionId);
        if (wasViewing) {
          this.clearMessages();
          this.refreshNameInput();
        }
      }
    ).open();
  }

  private restoreSessionMessages(sessionId: string): void {
    this.clearMessages();
    const history = this.sessionManager.getMessages(sessionId);
    if (history.length === 0) {
      this.appendMessage("assistant", t("session.resumedNoMessages"));
      return;
    }
    this.hideEmptyState();
    for (const msg of history) {
      this.replayMessage(msg);
    }
    this.scrollToBottom();
  }

  private replayMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    const isUser = msg.role === "user";
    const msgEl = this.messagesEl.createDiv({
      cls: isUser ? "claude-user-msg" : "claude-assistant-msg",
    });
    msgEl.style.cssText = `
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
      align-self: ${isUser ? "flex-end" : "flex-start"};
      background: var(--${isUser ? "interactive-accent" : "background-secondary"});
      color: var(--${isUser ? "text-on-accent" : "text-normal"});
      word-break: break-word;
    `;
    forceSelectable(msgEl);
    const label = msgEl.createDiv({ text: isUser ? "You" : "Claude" });
    label.style.cssText = "font-size:11px;opacity:0.7;margin-bottom:4px;";
    const body = msgEl.createDiv();
    forceSelectable(body);
    if (isUser) {
      body.style.whiteSpace = "pre-wrap";
      body.setText(msg.content);
    } else {
      MarkdownRenderer.render(this.app, msg.content, body, "", this);
    }
  }

  // ---- Helpers ----

  private refreshNameInput(): void {
    if (!this.nameInputEl) return;
    const name = this.sessionManager.getCurrentCustomName();
    const preview = this.sessionManager.getCurrentPreview();
    this.nameInputEl.value = name || preview || "";
  }

  private refreshModelButton(): void {
    if (!this.modelBtnEl) return;
    this.modelBtnEl.empty();
    const labelEl = this.modelBtnEl.createSpan({
      text: modelLabel(this.currentModel),
    });
    labelEl.style.fontWeight = "500";
    const chevron = this.modelBtnEl.createSpan();
    chevron.style.cssText = "display:flex;align-items:center;";
    setIcon(chevron, "chevron-down");
  }

  private clearMessages(): void {
    this.messagesEl.empty();
    this.messages = [];
    this.emptyStateEl = null;
    this.renderEmptyState();
  }

  private renderEmptyState(): void {
    if (this.emptyStateEl) return;
    const empty = this.messagesEl.createDiv();
    empty.style.cssText = `
      margin:auto;
      max-width:480px;
      text-align:center;
      opacity:0.75;
      font-size:13px;
      line-height:1.7;
      padding:20px 24px;
      background:var(--background-secondary);
      border-radius:10px;
      white-space:pre-wrap;
    `;
    empty.setText(
      `${t("empty.line1")}\n${t("empty.line2")}\n${t("empty.line3")}`
    );
    this.emptyStateEl = empty;
  }

  private hideEmptyState(): void {
    if (this.emptyStateEl) {
      this.emptyStateEl.remove();
      this.emptyStateEl = null;
    }
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

interface SlashCommand {
  id: "model" | "new-chat" | "history" | "save" | "attach-file" | "attach-note";
  label: string;
  hint?: string;
  modelId?: string;
}

function forceSelectable(el: HTMLElement): void {
  el.style.setProperty("user-select", "text", "important");
  el.style.setProperty("-webkit-user-select", "text", "important");
  el.style.cursor = "text";
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
  private onSelect: (file: TFile) => void;

  constructor(app: App, onSelect: (file: TFile) => void) {
    super(app);
    this.onSelect = onSelect;
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles();
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onSelect(file);
  }
}

class SessionListModal extends Modal {
  private listEl!: HTMLElement;

  constructor(
    app: App,
    private sessions: SessionRecord[],
    private onSelect: (sessionId: string) => void,
    private onNew: () => void,
    private onDelete?: (sessionId: string) => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("modal.history") });

    const newBtn = contentEl.createEl("button", { text: t("modal.startNew") });
    newBtn.style.cssText =
      "width:100%;margin-bottom:12px;padding:8px;cursor:pointer;";
    newBtn.onclick = () => {
      this.onNew();
      this.close();
    };

    this.listEl = contentEl.createDiv();
    this.renderList();
  }

  private renderList(): void {
    this.listEl.empty();
    if (this.sessions.length === 0) {
      this.listEl.createEl("p", { text: t("modal.noSaved") });
      return;
    }

    for (const session of this.sessions) {
      this.renderRow(session);
    }
  }

  private renderRow(session: SessionRecord): void {
    const item = this.listEl.createDiv();
    item.style.cssText = `
      display:flex;
      align-items:center;
      gap:8px;
      padding:10px;
      margin-bottom:6px;
      background: var(--background-secondary);
      border-radius:6px;
    `;

    const content = item.createDiv();
    content.style.cssText = "flex:1;min-width:0;cursor:pointer;";
    const title = content.createEl("div", {
      text: session.customName || session.previewText || t("modal.noContent"),
    });
    title.style.cssText =
      "font-size:13px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const meta = content.createEl("small", {
      text: `${session.model || "?"} · ${new Date(
        session.lastMessageAt
      ).toLocaleString()}`,
    });
    meta.style.cssText = "opacity:0.7;";
    content.onclick = () => {
      this.onSelect(session.sessionId);
      this.close();
    };

    if (this.onDelete) {
      const delBtn = item.createEl("button");
      delBtn.style.cssText = `
        background:transparent;
        border:none;
        cursor:pointer;
        padding:4px;
        color:var(--text-muted);
        border-radius:4px;
        display:flex;align-items:center;justify-content:center;
        flex-shrink:0;
      `;
      setIcon(delBtn, "x");
      delBtn.setAttribute("title", t("modal.delete"));

      let confirming = false;
      let revertTimer: number | null = null;
      const reset = () => {
        confirming = false;
        delBtn.style.color = "var(--text-muted)";
        delBtn.style.background = "transparent";
        delBtn.empty();
        setIcon(delBtn, "x");
        delBtn.setAttribute("title", t("modal.delete"));
      };

      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirming) {
          confirming = true;
          delBtn.style.color = "var(--text-on-accent)";
          delBtn.style.background = "var(--background-modifier-error)";
          delBtn.empty();
          setIcon(delBtn, "trash-2");
          delBtn.setAttribute("title", t("modal.confirmDelete"));
          revertTimer = window.setTimeout(reset, 3000);
          return;
        }
        if (revertTimer !== null) {
          window.clearTimeout(revertTimer);
          revertTimer = null;
        }
        if (this.onDelete) await this.onDelete(session.sessionId);
        this.sessions = this.sessions.filter(
          (s) => s.sessionId !== session.sessionId
        );
        item.remove();
        if (this.sessions.length === 0) {
          this.listEl.empty();
          this.listEl.createEl("p", { text: t("modal.noSaved") });
        }
      };
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
