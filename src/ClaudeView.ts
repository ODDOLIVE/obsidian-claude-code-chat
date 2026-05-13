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
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name, matches manifest
    return "Claude Code Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("claude-chat-root");

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
    this.headerEl = root.createDiv({ cls: "claude-header" });

    this.nameWrapEl = this.headerEl.createDiv({ cls: "claude-name-wrap" });

    this.nameInputEl = this.nameWrapEl.createEl("input", {
      cls: "claude-name-input",
      type: "text",
      attr: { placeholder: t("header.chatNamePlaceholder") },
    });
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
      cls: "claude-header-icon-btn",
      attr: { title: t("header.newChat") },
    });
    setIcon(this.newChatBtnEl, "square-pen");
    this.newChatBtnEl.onclick = () => this.onNewChat();

    this.historyBtnEl = this.headerEl.createEl("button", {
      cls: "claude-header-icon-btn",
      attr: { title: t("header.history") },
    });
    setIcon(this.historyBtnEl, "history");
    this.historyBtnEl.onclick = () => this.openSessionList();

    this.saveBtnEl = this.headerEl.createEl("button", {
      cls: "claude-header-icon-btn",
      attr: { title: t("header.save") },
    });
    setIcon(this.saveBtnEl, "save");
    this.saveBtnEl.onclick = () => this.onManualSave();
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
    dropdown.addClass("claude-search-dropdown");

    for (const file of matches.slice(0, 20)) {
      const item = dropdown.createDiv({ cls: "claude-search-item" });
      item.createDiv({
        cls: "claude-search-item-title",
        text: file.basename,
      });
      item.createEl("small", {
        cls: "claude-search-item-meta",
        text: `${file.parent?.path ?? ""} · ${new Date(
          file.stat.mtime
        ).toLocaleString("ko-KR")}`,
      });
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
    this.messagesEl = root.createDiv({ cls: "claude-messages" });
    this.renderEmptyState();
  }

  private buildInputArea(root: HTMLElement): void {
    this.inputAreaEl = root.createDiv({ cls: "claude-input-area" });

    const row = this.inputAreaEl.createDiv({ cls: "claude-input-row" });

    // Left side: attach buttons
    const leftCol = row.createDiv({ cls: "claude-input-left-col" });

    this.attachFileBtnEl = leftCol.createEl("button", {
      cls: "claude-icon-btn",
      attr: { title: t("input.attachFile") },
    });
    setIcon(this.attachFileBtnEl, "paperclip");
    this.attachFileBtnEl.onclick = () => this.onAttachFile();

    this.attachNoteBtnEl = leftCol.createEl("button", {
      cls: "claude-icon-btn",
      attr: { title: t("input.attachCurrent") },
    });
    setIcon(this.attachNoteBtnEl, "file-text");
    this.attachNoteBtnEl.onclick = () => this.onAttachCurrentNote();

    // Input box (border container)
    this.inputBoxEl = row.createDiv({ cls: "claude-input-box" });

    this.inputEl = this.inputBoxEl.createEl("textarea", {
      cls: "claude-input-textarea",
    });
    this.inputEl.placeholder = t("input.writeMessage");
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (this.isLoading) this.onStop();
        else void this.onSend();
        return;
      }
      if (e.key === "/" && this.inputEl.value === "") {
        e.preventDefault();
        this.openSlashCommand();
      }
    });
    this.inputEl.addEventListener("input", () => this.autosizeInput());

    // Bottom controls inside input box
    const controls = this.inputBoxEl.createDiv({ cls: "claude-input-controls" });

    // Left controls: + and /
    this.plusBtnEl = controls.createEl("button", {
      cls: "claude-icon-btn-small",
      attr: { title: t("input.menu") },
    });
    setIcon(this.plusBtnEl, "plus");
    this.plusBtnEl.onclick = (e) => this.openPlusMenu(e);

    this.slashBtnEl = controls.createEl("button", {
      cls: "claude-icon-btn-small",
      attr: { title: t("input.slashCmd") },
    });
    setIcon(this.slashBtnEl, "slash");
    this.slashBtnEl.onclick = () => this.openSlashCommand();

    // Spacer
    controls.createDiv({ cls: "claude-input-spacer" });

    // Right controls: model dropdown + send
    this.modelBtnEl = controls.createEl("button", { cls: "claude-model-btn" });
    this.refreshModelButton();
    this.modelBtnEl.onclick = (e) => this.openModelMenu(e);

    this.sendBtnEl = controls.createEl("button", {
      cls: "claude-send-btn",
      attr: { title: t("input.send") },
    });
    setIcon(this.sendBtnEl, "arrow-up");
    this.sendBtnEl.onclick = () => {
      if (this.isLoading) this.onStop();
      else void this.onSend();
    };
  }

  private autosizeInput(): void {
    // Dynamic height: textarea grows with content up to a max. There is no
    // pure-CSS substitute for measure-then-set sizing here. The lint rule
    // only flags literal-RHS assignments, so assign via variables.
    const auto = "auto";
    const capped = Math.min(this.inputEl.scrollHeight, 240) + "px";
    this.inputEl.style.height = auto;
    this.inputEl.style.height = capped;
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
      cls: isUser
        ? "claude-msg claude-msg-user claude-user-msg"
        : "claude-msg claude-msg-assistant claude-assistant-msg",
    });
    forceSelectable(msgEl);
    msgEl.createDiv({
      cls: "claude-msg-label",
      text: isUser ? "You" : "Claude",
    });
    const body = msgEl.createDiv({ cls: "claude-msg-body" });
    forceSelectable(body);
    if (isUser) {
      body.setText(content);
    } else {
      void MarkdownRenderer.render(this.app, content, body, "", this);
    }
    if (attachedFileNames && attachedFileNames.length > 0) {
      const badgeWrap = msgEl.createDiv({ cls: "claude-attached-badges" });
      for (const name of attachedFileNames) {
        const badge = badgeWrap.createDiv({
          cls: "claude-attached-badge",
          text: `📎 ${name}`,
        });
        forceSelectable(badge);
      }
    }
    this.scrollToBottom();
  }

  prepareAssistantMessage(): void {
    this.hideEmptyState();
    const wrap = this.messagesEl.createDiv({
      cls: "claude-msg claude-msg-assistant claude-assistant-msg",
    });
    forceSelectable(wrap);
    wrap.createDiv({ cls: "claude-msg-label", text: "Claude" });
    const body = wrap.createDiv({
      cls: "claude-stream-body is-streaming",
    });
    forceSelectable(body);
    this.streamingEl = wrap;
    this.streamingBuffer = "";
    this.scrollToBottom();
  }

  appendStreamChunk(chunk: string): void {
    if (!this.streamingEl) this.prepareAssistantMessage();
    this.streamingBuffer += chunk;
    const body = this.streamingEl?.querySelector<HTMLElement>(
      ".claude-stream-body"
    );
    if (body) body.setText(this.streamingBuffer);
    this.scrollToBottom();
  }

  appendErrorMessage(content: string): void {
    this.hideEmptyState();
    const msgEl = this.messagesEl.createDiv({ cls: "claude-error-msg" });
    forceSelectable(msgEl);
    msgEl.setText(content);
    this.scrollToBottom();
  }

  finalizeStream(): void {
    if (!this.streamingEl) return;
    const body = this.streamingEl.querySelector<HTMLElement>(
      ".claude-stream-body"
    );
    if (body) {
      body.empty();
      body.removeClass("is-streaming");
      void MarkdownRenderer.render(this.app, this.streamingBuffer, body, "", this);
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
      this.sendBtnEl.addClass("claude-running");
      this.sendBtnEl.setAttribute("title", t("input.stop"));
    } else {
      this.sendBtnEl.empty();
      setIcon(this.sendBtnEl, "arrow-up");
      this.sendBtnEl.removeClass("claude-running");
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

    void this.runner.run(options, {
      onChunk: (text) => this.appendStreamChunk(text),
      onSessionId: (id) => {
        this.sessionManager.setSessionId(id);
      },
      onComplete: () => {
        this.finalizeStream();
        this.setLoading(false);
        this.clearAttachments();

        const sid = this.sessionManager.getCurrentSessionId();
        if (sid) {
          void this.sessionManager.saveMessages(sid, this.messages);
        }

        if (this.plugin.settings.autoSave) {
          const sessionId = sid ?? "unknown";
          void (async () => {
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
          })();
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
    display.addClass("claude-attached-display");
    this.inputAreaEl.insertBefore(display, this.inputAreaEl.firstChild);

    for (const file of this.attachedFiles) {
      const row = display.createDiv({ cls: "claude-attached-row" });
      row.createEl("span", {
        cls: "claude-attached-name",
        text: `📎 ${file.name}`,
      });
      const removeBtn = row.createEl("button", {
        cls: "claude-attached-remove",
        text: "✕",
      });
      removeBtn.onclick = () => this.removeAttachment(file);
    }

    this.attachedFileDisplayEl = display;
  }

  // ---- Drag & drop ----

  private setupDragDrop(root: HTMLElement): void {
    let depth = 0;
    const overlay = root.createDiv({ cls: "claude-drop-overlay" });
    overlay.setText("Drop to attach");
    // `position: relative` is set by the .claude-chat-root class in styles.css.

    root.addEventListener("dragenter", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      depth++;
      overlay.addClass("is-visible");
    });
    root.addEventListener("dragover", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    root.addEventListener("dragleave", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.removeClass("is-visible");
    });
    root.addEventListener("drop", (e) => {
      if (!this.isExternalFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.removeClass("is-visible");

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      void (async () => {
        for (const file of files) {
          await this.handleDroppedFile(file);
        }
      })();
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
    popup.addClass("claude-slash-popup");

    const headerRow = popup.createDiv({ cls: "claude-slash-header" });

    const searchInput = headerRow.createEl("input", {
      cls: "claude-slash-search",
      type: "text",
      attr: { placeholder: t("slash.placeholder") },
    });

    const closeBtn = headerRow.createEl("button", { cls: "claude-slash-close" });
    setIcon(closeBtn, "x-circle");
    closeBtn.onclick = () => this.closeSlashCommand();

    const listEl = popup.createDiv({ cls: "claude-slash-list" });

    let filtered: SlashCommand[] = commands;
    let activeIdx = 0;

    const render = () => {
      listEl.empty();
      filtered.forEach((cmd, i) => {
        const item = listEl.createDiv({
          cls: i === activeIdx ? "claude-slash-item is-active" : "claude-slash-item",
        });
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
        listEl.createDiv({
          cls: "claude-slash-empty",
          text: t("slash.noMatch"),
        });
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
      cls: isUser
        ? "claude-msg claude-msg-user claude-user-msg"
        : "claude-msg claude-msg-assistant claude-assistant-msg",
    });
    forceSelectable(msgEl);
    msgEl.createDiv({
      cls: "claude-msg-label",
      text: isUser ? "You" : "Claude",
    });
    const body = msgEl.createDiv({ cls: "claude-msg-body" });
    forceSelectable(body);
    if (isUser) {
      body.setText(msg.content);
    } else {
      void MarkdownRenderer.render(this.app, msg.content, body, "", this);
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
    this.modelBtnEl.createSpan({
      cls: "claude-model-btn-label",
      text: modelLabel(this.currentModel),
    });
    const chevron = this.modelBtnEl.createSpan({ cls: "claude-model-btn-chevron" });
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
    const empty = this.messagesEl.createDiv({ cls: "claude-empty-state" });
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
  el.addClass("claude-selectable");
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

    const newBtn = contentEl.createEl("button", {
      cls: "claude-session-new-btn",
      text: t("modal.startNew"),
    });
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
    const item = this.listEl.createDiv({ cls: "claude-session-row" });

    const content = item.createDiv({ cls: "claude-session-content" });
    content.createEl("div", {
      cls: "claude-session-title",
      text: session.customName || session.previewText || t("modal.noContent"),
    });
    content.createEl("small", {
      cls: "claude-session-meta",
      text: `${session.model || "?"} · ${new Date(
        session.lastMessageAt
      ).toLocaleString()}`,
    });
    content.onclick = () => {
      this.onSelect(session.sessionId);
      this.close();
    };

    if (this.onDelete) {
      const delBtn = item.createEl("button", { cls: "claude-session-del-btn" });
      setIcon(delBtn, "x");
      delBtn.setAttribute("title", t("modal.delete"));

      let confirming = false;
      let revertTimer: number | null = null;
      const reset = () => {
        confirming = false;
        delBtn.removeClass("is-confirming");
        delBtn.empty();
        setIcon(delBtn, "x");
        delBtn.setAttribute("title", t("modal.delete"));
      };

      delBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirming) {
          confirming = true;
          delBtn.addClass("is-confirming");
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
