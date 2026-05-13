import { Plugin, WorkspaceLeaf } from "obsidian";
import { ClaudeView, VIEW_TYPE_CLAUDE } from "./ClaudeView";
import { SessionManager } from "./SessionManager";
import { SaveManager } from "./SaveManager";
import { ClaudeCodeSettingsTab } from "./SettingsTab";
import { ClaudeCodeSettings } from "./types";
import { t } from "./i18n";

export type { ClaudeCodeSettings } from "./types";

export const DEFAULT_SETTINGS: ClaudeCodeSettings = {
  claudePath: "claude",
  saveFolder: "Claude Chats",
  defaultModel: "claude-sonnet-4-6",
  autoSave: true,
  apiKey: "",
  apiKeyOnly: false,
  workingDirectory: "",
  titleSync: true,
  attachmentsFolder: "",
};

export default class ClaudeCodeChatPlugin extends Plugin {
  settings!: ClaudeCodeSettings;
  sessionManager!: SessionManager;
  saveManager!: SaveManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.sessionManager = new SessionManager(this);
    await this.sessionManager.loadSessions();
    this.saveManager = new SaveManager(this.app, this.settings);

    this.injectStyles();

    this.registerView(
      VIEW_TYPE_CLAUDE,
      (leaf) =>
        new ClaudeView(leaf, this, this.sessionManager, this.saveManager)
    );

    this.addRibbonIcon("message-square", t("cmd.openChat"), () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-claude-code-chat",
      name: t("cmd.openChat"),
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "claude-chat-new",
      name: t("cmd.newChat"),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "n" }],
      callback: async () => {
        const view = await this.getOrOpenView();
        view?.startNewChat();
      },
    });

    this.addCommand({
      id: "claude-chat-save",
      name: t("cmd.saveChat"),
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "s" }],
      callback: async () => {
        const view = await this.getOrOpenView();
        await view?.saveCurrentChat();
      },
    });

    this.addSettingTab(new ClaudeCodeSettingsTab(this.app, this));
  }

  private injectStyles(): void {
    const styleEl = document.createElement("style");
    styleEl.id = "claude-code-chat-styles";
    styleEl.textContent = `
      .claude-user-msg::selection,
      .claude-user-msg *::selection {
        background: rgba(255, 255, 255, 0.45);
        color: var(--text-on-accent);
      }
    `;
    document.head.appendChild(styleEl);
    this.register(() => styleEl.remove());
  }

  private async getOrOpenView(): Promise<ClaudeView | null> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE);
    if (leaves.length === 0) {
      await this.activateView();
    }
    const after = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDE);
    const view = after[0]?.view;
    return view instanceof ClaudeView ? view : null;
  }

  onunload(): void {
    // Obsidian convention: do not detach views in onunload.
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLAUDE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CLAUDE, active: true });
      }
    }

    if (leaf) workspace.revealLeaf(leaf);
  }
}
