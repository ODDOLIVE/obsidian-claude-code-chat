import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import { exec } from "child_process";
import type ClaudeCodeChatPlugin from "./main";
import { t } from "./i18n";
import { AuthService, AuthStatus, extractLoginUrl } from "./AuthService";

const MODEL_OPTIONS: Array<[string, string]> = [
  ["claude-sonnet-4-6", "Sonnet 4.6"],
  ["claude-opus-4-6", "Opus 4.6"],
  ["claude-haiku-4-5-20251001", "Haiku 4.5"],
];

function checkPath(claudePath: string): Promise<string> {
  const cmd =
    process.platform === "win32"
      ? `where ${claudePath}`
      : `which ${claudePath} || where ${claudePath}`;
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err) {
        resolve(t("settings.pathNotFound"));
      } else {
        const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        resolve(first || t("settings.pathNotFound"));
      }
    });
  });
}

function generateClaudeMd(vaultName: string): string {
  return [
    t("vault.contextHeader", vaultName),
    "",
    t("vault.aboutHeader"),
    t("vault.aboutBody"),
    "",
    t("vault.purposeHeader"),
    t("vault.purposeBody"),
    "",
    t("vault.foldersHeader"),
    t("vault.foldersBody"),
    "",
    t("vault.notesHeader"),
    t("vault.notesSaveLoc"),
    t("vault.notesDateFmt"),
    "",
  ].join("\n");
}

export class ClaudeCodeSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ClaudeCodeChatPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderSupportBox(containerEl);
    this.renderConnectionSection(containerEl);

    new Setting(containerEl)
      .setName(t("settings.claudePath"))
      .setDesc(t("settings.claudePathDesc"))
      .addText((text) =>
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- CLI binary name
          .setPlaceholder("claude")
          .setValue(this.plugin.settings.claudePath)
          .onChange(async (value) => {
            this.plugin.settings.claudePath = value.trim() || "claude";
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.checkPath"))
          .onClick(async () => {
            const result = await checkPath(this.plugin.settings.claudePath);
            new Notice(result, 6000);
          })
      );

    new Setting(containerEl)
      .setName(t("settings.defaultModel"))
      .setDesc(t("settings.defaultModelDesc"))
      .addDropdown((drop) => {
        for (const [id, label] of MODEL_OPTIONS) {
          drop.addOption(id, label);
        }
        drop
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (value) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.workingDirectory"))
      .setDesc(t("settings.workingDirectoryDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.workingDirectoryPlaceholder"))
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.titleSync"))
      .setDesc(t("settings.titleSyncDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.titleSync)
          .onChange(async (value) => {
            this.plugin.settings.titleSync = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.saveFolder"))
      .setDesc(t("settings.saveFolderDesc"))
      .addText((text) =>
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- default folder name with product noun
          .setPlaceholder("Claude Chats")
          .setValue(this.plugin.settings.saveFolder)
          .onChange(async (value) => {
            this.plugin.settings.saveFolder = value.trim() || "Claude Chats";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.attachmentsFolder"))
      .setDesc(t("settings.attachmentsFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.attachmentsFolderPlaceholder"))
          .setValue(this.plugin.settings.attachmentsFolder)
          .onChange(async (value) => {
            this.plugin.settings.attachmentsFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.autoSave"))
      .setDesc(t("settings.autoSaveDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSave)
          .onChange(async (value) => {
            this.plugin.settings.autoSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.generateClaudeMd"))
      .setDesc(t("settings.generateClaudeMdDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.generate"))
          .onClick(() => this.onGenerateClaudeMd())
      );

    new Setting(containerEl)
      .setName(t("settings.dangerZone"))
      .setHeading();

    new Setting(containerEl)
      .setName(t("settings.clearSessions"))
      .setDesc(t("settings.clearSessionsDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings.clear"))
          .setWarning()
          .onClick(() => this.onClearSessions())
      );
  }

  private renderSupportBox(containerEl: HTMLElement): void {
    const box = containerEl.createDiv({ cls: "claude-settings-support" });
    box.createDiv({
      cls: "claude-settings-support-text",
      text: t("settings.support"),
    });
    const link = box.createEl("a", {
      cls: "claude-settings-support-link",
      href: "https://ko-fi.com/oddolive",
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
    link.createEl("img", {
      cls: "claude-settings-support-img",
      attr: {
        src: "https://storage.ko-fi.com/cdn/kofi3.png?v=3",
        alt: "Buy me a coffee on Ko-fi",
      },
    });
  }

  private renderConnectionSection(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: "claude-conn-wrap" });

    new Setting(wrap)
      .setName(t("auth.section"))
      .setHeading();

    const statusEl = wrap.createDiv({ cls: "claude-conn-status" });
    statusEl.setText("…");

    wrap.createDiv({ cls: "claude-conn-note", text: t("auth.priorityNote") });

    const btnRow = wrap.createDiv({ cls: "claude-conn-btn-row" });

    const refreshBtn = btnRow.createEl("button", { text: t("auth.refresh") });
    const signInBtn = btnRow.createEl("button", {
      cls: "claude-conn-signin-btn",
      text: t("auth.signIn"),
    });
    const clearKeyBtn = btnRow.createEl("button", {
      text: t("auth.clearApiKey"),
    });

    wrap.createDiv({
      cls: "claude-conn-scope-note",
      text: t("auth.signOutScopeNote"),
    });

    const renderStatus = (s: AuthStatus | null) => {
      statusEl.empty();
      if (!s) {
        statusEl.setText("…");
        return;
      }
      const cliLine = statusEl.createDiv({
        cls: s.cliInstalled
          ? "claude-conn-status-line is-success"
          : "claude-conn-status-line is-error",
      });
      cliLine.setText(
        s.cliInstalled
          ? "✓ " + t("auth.cliInstalled", s.cliVersion)
          : "✗ " + t("auth.cliMissing")
      );
      if (!s.cliInstalled) {
        statusEl.createDiv({
          cls: "claude-conn-hint",
          text: t("auth.cliMissingDesc"),
        });
      }

      let authText: string;
      let authCls: string;
      if (s.effectiveMethod === "oauth") {
        authText = "✓ " + t("auth.signedInOauth");
        authCls = "claude-conn-status-line is-success";
      } else if (s.effectiveMethod === "apiKey") {
        authText = "✓ " + t("auth.signedInApiKey");
        authCls = "claude-conn-status-line is-success";
      } else {
        authText = "✗ " + t("auth.notSignedIn");
        authCls = "claude-conn-status-line is-error";
      }
      const authLine = statusEl.createDiv({ cls: authCls });
      authLine.setText(authText);
    };

    const refresh = async () => {
      renderStatus(null);
      try {
        const raw = await AuthService.detect(
          this.plugin.settings.claudePath,
          this.plugin.settings.apiKey
        );
        const adjusted: AuthStatus = this.plugin.settings.apiKeyOnly
          ? {
              ...raw,
              oauthDetected: false,
              effectiveMethod: AuthService.decideMethod(
                false,
                raw.apiKeyAvailable
              ),
            }
          : raw;
        renderStatus(adjusted);
        clearKeyBtn.disabled = !this.plugin.settings.apiKey;
        // Hide system-OAuth Sign-in button when plugin-scoped auth is enforced.
        if (this.plugin.settings.apiKeyOnly) signInBtn.addClass("claude-hidden");
        else signInBtn.removeClass("claude-hidden");
      } catch (e) {
        new Notice((e as Error).message);
      }
    };

    refreshBtn.onclick = () => void refresh();
    signInBtn.onclick = () => void this.startSignIn(refresh);
    clearKeyBtn.onclick = async () => {
      if (!this.plugin.settings.apiKey) {
        new Notice(t("auth.apiKeyAlreadyEmpty"));
        return;
      }
      this.plugin.settings.apiKey = "";
      await this.plugin.saveSettings();
      this.display();
      new Notice(t("auth.apiKeyCleared"));
    };

    void refresh();

    new Setting(wrap)
      .setName(t("auth.apiKeyOnly"))
      .setDesc(t("auth.apiKeyOnlyDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.apiKeyOnly)
          .onChange(async (value) => {
            this.plugin.settings.apiKeyOnly = value;
            await this.plugin.saveSettings();
            void refresh();
          })
      );

    new Setting(wrap)
      .setName(t("auth.apiKey"))
      .setDesc(t("auth.apiKeyDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(t("auth.apiKeyPlaceholder"))
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
            void refresh();
          });
      });
  }

  private async startSignIn(refresh: () => Promise<void>): Promise<void> {
    const claudePath = this.plugin.settings.claudePath;
    const modal = new SignInModal(this.app);
    modal.open();
    modal.append(t("auth.signInRunning") + "\n\n");

    let urlOpened = false;
    let cancel: (() => void) | null = null;
    modal.setOnClose(() => cancel?.());

    try {
      const handle = await AuthService.runLogin(
        claudePath,
        (chunk) => {
          modal.append(chunk);
          if (!urlOpened) {
            const url = extractLoginUrl(chunk);
            if (url) {
              urlOpened = true;
              window.open(url);
              modal.append("\n" + t("auth.openUrlHint", url) + "\n");
            }
          }
        },
        (code) => {
          modal.append(`\n[exit ${code}]\n`);
          if (code === 0) {
            new Notice(t("auth.signInDone"));
          } else {
            new Notice(t("auth.signInFailed", `exit ${code}`));
          }
          void refresh();
        }
      );
      cancel = handle.cancel;
    } catch (e) {
      const msg = (e as Error).message;
      modal.append(`\nFailed to start: ${msg}\n`);
      new Notice(t("auth.signInFailed", msg));
    }
  }

  private async onGenerateClaudeMd(): Promise<void> {
    const vault = this.app.vault;
    const vaultName = vault.getName();
    const path = "CLAUDE.md";
    const existing = vault.getAbstractFileByPath(path);
    const content = generateClaudeMd(vaultName);

    if (existing) {
      new ConfirmModal(
        this.app,
        t("settings.confirmOverwriteTitle"),
        t("settings.confirmOverwriteMsg"),
        async () => {
          try {
            await vault.adapter.write(path, content);
            new Notice(t("settings.claudeMdOverwritten"));
          } catch (e) {
            new Notice(t("settings.createFailed", (e as Error).message));
          }
        }
      ).open();
      return;
    }

    try {
      await vault.create(path, content);
      new Notice(t("settings.claudeMdCreated"));
    } catch (e) {
      new Notice(t("settings.createFailed", (e as Error).message));
    }
  }

  private onClearSessions(): void {
    new ConfirmModal(
      this.app,
      t("settings.confirmClearTitle"),
      t("settings.confirmClearMsg"),
      async () => {
        await this.plugin.sessionManager.clearSessions();
        new Notice(t("settings.sessionsCleared"));
      }
    ).open();
  }
}

class SignInModal extends Modal {
  private logEl!: HTMLElement;
  private onCloseCb: (() => void) | null = null;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: t("auth.signIn") });
    contentEl.createEl("p", { text: t("auth.signInDesc") });
    this.logEl = contentEl.createEl("pre", { cls: "claude-signin-log" });
  }

  append(text: string): void {
    if (!this.logEl) return;
    this.logEl.appendText(text);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setOnClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  onClose(): void {
    if (this.onCloseCb) this.onCloseCb();
    this.onCloseCb = null;
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private message: string,
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });

    const btnRow = contentEl.createDiv({ cls: "claude-confirm-btn-row" });

    const cancelBtn = btnRow.createEl("button", { text: t("settings.cancel") });
    cancelBtn.onclick = () => this.close();

    const confirmBtn = btnRow.createEl("button", {
      cls: "claude-confirm-btn-danger",
      text: t("settings.confirm"),
    });
    confirmBtn.onclick = async () => {
      await this.onConfirm();
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
