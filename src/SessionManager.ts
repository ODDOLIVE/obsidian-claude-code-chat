import { hostname } from "os";
import type ClaudeCodeChatPlugin from "./main";
import { ChatMessage, Provider, SessionRecord } from "./types";

const MAX_SESSIONS = 50;

export class SessionManager {
  private currentConversationId: string | null = null;
  private sessions: SessionRecord[] = [];
  private chatHistories: Record<string, ChatMessage[]> = {};
  private pendingPreview: string | null = null;
  private pendingModel: string | null = null;
  private pendingCustomName: string | null = null;
  private pendingProvider: Provider | null = null;
  private currentProvider: Provider = "claude";

  constructor(private plugin: ClaudeCodeChatPlugin) {}

  // Set current provider for resume mode logic (9-B)
  setCurrentProvider(provider: Provider): void {
    this.currentProvider = provider;
  }

  // 9-B: Determine resume strategy (native --resume vs replay preamble)
  getResumeMode(): { mode: "native"; nativeId: string } | { mode: "replay" } | { mode: "new" } {
    if (!this.currentConversationId) return { mode: "new" };
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    if (!rec?.nativeSessionId) return { mode: "replay" };
    // Same PC, same provider: use native --resume. Otherwise: replay.
    if (rec.lastNativeHost === hostname() && (rec.provider ?? "claude") === this.currentProvider) {
      return { mode: "native", nativeId: rec.nativeSessionId };
    }
    return { mode: "replay" };
  }

  // Legacy API: getSessionFlag (used when resumeMode is "native")
  getSessionFlag(): "--continue" | "--resume" | null {
    const mode = this.getResumeMode();
    if (mode.mode === "native") {
      return "--resume";
    }
    return null;
  }

  // Backward-compatible current ID getter (returns conversationId as string)
  getCurrentSessionId(): string | null {
    return this.currentConversationId;
  }

  getCurrentPreview(): string {
    if (!this.currentConversationId) return "";
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    return rec?.previewText ?? "";
  }

  getCurrentCustomName(): string {
    if (!this.currentConversationId) return this.pendingCustomName ?? "";
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    return rec?.customName ?? "";
  }

  setCustomName(name: string): void {
    const trimmed = name.trim();
    if (this.currentConversationId) {
      const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
      if (rec) {
        rec.customName = trimmed || undefined;
        void this.saveSessions();
      }
    } else {
      this.pendingCustomName = trimmed || null;
    }
  }

  getLastSavedPath(): string | null {
    if (!this.currentConversationId) return null;
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    return rec?.lastSavedPath ?? null;
  }

  setLastSavedPath(path: string): void {
    if (!this.currentConversationId) return;
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    if (rec) {
      rec.lastSavedPath = path;
      void this.saveSessions();
    }
  }

  isCurrentSessionShared(): boolean {
    if (!this.currentConversationId) return false;
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    return rec?.sharedWithVSCode ?? false;
  }

  setSharedWithVSCode(shared: boolean): void {
    if (!this.currentConversationId) return;
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    if (rec) {
      rec.sharedWithVSCode = shared;
      void this.saveSessions();
    }
  }

  // Called when CLI returns a new native session ID (after replay or new conversation)
  setSessionId(id: string): void {
    const now = new Date().toISOString();
    if (!this.currentConversationId) {
      // New conversation: create conversationId
      this.currentConversationId = this.generateConversationId();
    }
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    if (rec) {
      rec.nativeSessionId = id;
      rec.lastNativeHost = hostname();
      rec.provider = this.currentProvider;
      rec.lastMessageAt = now;
      if (!rec.previewText && this.pendingPreview) {
        rec.previewText = this.pendingPreview;
      }
      if (this.pendingModel) rec.model = this.pendingModel;
      if (this.pendingCustomName && !rec.customName) {
        rec.customName = this.pendingCustomName;
      }
    } else {
      // Create new record with conversationId + nativeSessionId
      this.sessions.push({
        conversationId: this.currentConversationId,
        nativeSessionId: id,
        lastNativeHost: hostname(),
        provider: this.currentProvider,
        startedAt: now,
        lastMessageAt: now,
        previewText: this.pendingPreview ?? "",
        model: this.pendingModel ?? "",
        customName: this.pendingCustomName ?? undefined,
      });
    }
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
    void this.saveSessions();
  }

  // Alternative: set native session ID directly (for multi-PC resume)
  setNativeSessionId(nativeId: string): void {
    if (!this.currentConversationId) return;
    const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
    if (rec) {
      rec.nativeSessionId = nativeId;
      rec.lastNativeHost = hostname();
      rec.lastMessageAt = new Date().toISOString();
      void this.saveSessions();
    }
  }

  newSession(): void {
    this.currentConversationId = null;
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
  }

  setPreview(text: string, model: string, provider?: Provider): void {
    const preview = text.slice(0, 50);
    this.pendingModel = model;
    if (provider) this.pendingProvider = provider;
    if (this.currentConversationId) {
      const rec = this.sessions.find((s) => s.conversationId === this.currentConversationId);
      if (rec) {
        if (!rec.previewText) rec.previewText = preview;
        rec.model = model;
        // 9-B: Don't update rec.provider here — it tracks the provider that created nativeSessionId,
        // not the current UI selection. Updating it breaks getResumeMode() logic.
        void this.saveSessions();
      }
    } else {
      this.pendingPreview = preview;
    }
  }

  getSessions(provider?: Provider): SessionRecord[] {
    const sorted = [...this.sessions].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt)
    );
    if (!provider) return sorted;
    return sorted.filter((s) => (s.provider ?? "claude") === provider);
  }

  resumeSession(conversationId: string): void {
    this.currentConversationId = conversationId;
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
  }

  getSessionProvider(conversationId: string): Provider {
    const rec = this.sessions.find((s) => s.conversationId === conversationId);
    return rec?.provider ?? "claude";
  }

  getMessages(conversationId: string): ChatMessage[] {
    return this.chatHistories[conversationId] ?? [];
  }

  async saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    if (!conversationId) return;
    this.chatHistories[conversationId] = messages.slice();
    this.pruneHistories();
    const data = await this.loadRaw();
    await this.plugin.saveData({ ...data, chatHistories: this.chatHistories });
  }

  private async loadRaw(): Promise<Record<string, unknown>> {
    const raw: unknown = await this.plugin.loadData();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  }

  private pruneHistories(): void {
    const validIds = new Set(this.sessions.map((s) => s.conversationId));
    for (const id of Object.keys(this.chatHistories)) {
      if (!validIds.has(id)) delete this.chatHistories[id];
    }
  }

  async saveSessions(): Promise<void> {
    this.sessions.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    if (this.sessions.length > MAX_SESSIONS) {
      const keep = new Set(
        this.sessions.slice(0, MAX_SESSIONS).map((s) => s.conversationId)
      );
      this.sessions = this.sessions.slice(0, MAX_SESSIONS);
      for (const id of Object.keys(this.chatHistories)) {
        if (!keep.has(id)) delete this.chatHistories[id];
      }
    }
    const data = await this.loadRaw();
    await this.plugin.saveData({
      ...data,
      sessions: this.sessions,
      chatHistories: this.chatHistories,
    });
  }

  async loadSessions(): Promise<void> {
    const data = (await this.plugin.loadData()) as
      | {
          sessions?: unknown[];
          chatHistories?: Record<string, ChatMessage[]>;
        }
      | null;

    // Migration: upgrade old sessionId-based records to conversationId-based
    let sessions: SessionRecord[] = [];
    if (Array.isArray(data?.sessions)) {
      sessions = data.sessions.map((rec: unknown) => {
        const r = rec as Record<string, unknown>;
        // If conversationId already exists, keep it; otherwise use sessionId
        if (!r.conversationId && r.sessionId) {
          r.conversationId = r.sessionId as string;
          // nativeSessionId takes the old sessionId value
          r.nativeSessionId = r.sessionId as string;
        }
        // Ensure conversationId exists
        if (!r.conversationId) {
          r.conversationId = this.generateConversationId();
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return r as any as SessionRecord;
      });
    }
    this.sessions = sessions;

    // Migrate chatHistories keys from old sessionId to conversationId
    let oldHistories: Record<string, ChatMessage[]> = {};
    if (data?.chatHistories && typeof data.chatHistories === "object") {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      oldHistories = data.chatHistories as Record<string, ChatMessage[]>;
    }

    const migratedHistories: Record<string, ChatMessage[]> = {};
    for (const [key, messages] of Object.entries(oldHistories)) {
      // Find the session record that either has this key as conversationId or old sessionId
      const rec = this.sessions.find((s) => {
        if (s.conversationId === key) return true;
        // Check for old sessionId field (migration)
        const sRaw = s as unknown as Record<string, unknown>;
        return sRaw.sessionId === key;
      });
      if (rec) {
        migratedHistories[rec.conversationId] = messages;
      } else {
        // Keep unmapped histories under their original key (shouldn't happen)
        migratedHistories[key] = messages;
      }
    }
    this.chatHistories = migratedHistories;
  }

  async deleteSession(conversationId: string): Promise<void> {
    if (!conversationId) return;
    const idx = this.sessions.findIndex((s) => s.conversationId === conversationId);
    if (idx >= 0) this.sessions.splice(idx, 1);
    delete this.chatHistories[conversationId];
    if (this.currentConversationId === conversationId) {
      this.currentConversationId = null;
      this.pendingPreview = null;
      this.pendingCustomName = null;
    }
    const data = await this.loadRaw();
    await this.plugin.saveData({
      ...data,
      sessions: this.sessions,
      chatHistories: this.chatHistories,
    });
  }

  async clearSessions(): Promise<void> {
    this.sessions = [];
    this.chatHistories = {};
    this.currentConversationId = null;
    this.pendingPreview = null;
    this.pendingModel = null;
    this.pendingProvider = null;
    const data = await this.loadRaw();
    await this.plugin.saveData({
      ...data,
      sessions: [],
      chatHistories: {},
    });
  }

  private generateConversationId(): string {
    return this.randomUUID();
  }

  // Polyfill for crypto.randomUUID in Obsidian environment
  private randomUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Export SessionRecord for backward compatibility with ClaudeView
export type { SessionRecord } from "./types";
