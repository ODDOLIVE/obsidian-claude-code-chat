import type ClaudeCodeChatPlugin from "./main";
import { ChatMessage, Provider } from "./types";

export interface SessionRecord {
  sessionId: string;
  startedAt: string;
  lastMessageAt: string;
  previewText: string;
  model: string;
  provider?: Provider;
  customName?: string;
  lastSavedPath?: string;
  sharedWithVSCode?: boolean;
}

const MAX_SESSIONS = 50;

export class SessionManager {
  private currentSessionId: string | null = null;
  private isNewSession = true;
  private sessions: SessionRecord[] = [];
  private chatHistories: Record<string, ChatMessage[]> = {};
  private pendingPreview: string | null = null;
  private pendingModel: string | null = null;
  private pendingCustomName: string | null = null;
  private pendingProvider: Provider | null = null;

  constructor(private plugin: ClaudeCodeChatPlugin) {}

  getSessionFlag(): "--continue" | "--resume" | null {
    if (!this.currentSessionId) return null;
    if (this.isNewSession) return "--resume";
    return "--continue";
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getCurrentPreview(): string {
    if (!this.currentSessionId) return "";
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    return rec?.previewText ?? "";
  }

  getCurrentCustomName(): string {
    if (!this.currentSessionId) return this.pendingCustomName ?? "";
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    return rec?.customName ?? "";
  }

  setCustomName(name: string): void {
    const trimmed = name.trim();
    if (this.currentSessionId) {
      const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
      if (rec) {
        rec.customName = trimmed || undefined;
        void this.saveSessions();
      }
    } else {
      this.pendingCustomName = trimmed || null;
    }
  }

  getLastSavedPath(): string | null {
    if (!this.currentSessionId) return null;
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    return rec?.lastSavedPath ?? null;
  }

  setLastSavedPath(path: string): void {
    if (!this.currentSessionId) return;
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    if (rec) {
      rec.lastSavedPath = path;
      void this.saveSessions();
    }
  }

  isCurrentSessionShared(): boolean {
    if (!this.currentSessionId) return false;
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    return rec?.sharedWithVSCode ?? false;
  }

  setSharedWithVSCode(shared: boolean): void {
    if (!this.currentSessionId) return;
    const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
    if (rec) {
      rec.sharedWithVSCode = shared;
      void this.saveSessions();
    }
  }

  setSessionId(id: string): void {
    this.currentSessionId = id;
    this.isNewSession = false;
    const now = new Date().toISOString();
    const existing = this.sessions.find((s) => s.sessionId === id);
    if (existing) {
      existing.lastMessageAt = now;
      if (!existing.previewText && this.pendingPreview) {
        existing.previewText = this.pendingPreview;
      }
      if (this.pendingModel) existing.model = this.pendingModel;
      if (this.pendingCustomName && !existing.customName) {
        existing.customName = this.pendingCustomName;
      }
    } else {
      this.sessions.push({
        sessionId: id,
        startedAt: now,
        lastMessageAt: now,
        previewText: this.pendingPreview ?? "",
        model: this.pendingModel ?? "",
        provider: this.pendingProvider ?? undefined,
        customName: this.pendingCustomName ?? undefined,
      });
    }
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
    void this.saveSessions();
  }

  newSession(): void {
    this.currentSessionId = null;
    this.isNewSession = true;
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
  }

  setPreview(text: string, model: string, provider?: Provider): void {
    const preview = text.slice(0, 50);
    this.pendingModel = model;
    if (provider) this.pendingProvider = provider;
    if (this.currentSessionId) {
      const rec = this.sessions.find((s) => s.sessionId === this.currentSessionId);
      if (rec) {
        if (!rec.previewText) rec.previewText = preview;
        rec.model = model;
        if (provider) rec.provider = provider;
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

  resumeSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    this.isNewSession = true;
    this.pendingPreview = null;
    this.pendingCustomName = null;
    this.pendingProvider = null;
  }

  getSessionProvider(sessionId: string): Provider {
    const rec = this.sessions.find((s) => s.sessionId === sessionId);
    return rec?.provider ?? "claude";
  }

  getMessages(sessionId: string): ChatMessage[] {
    return this.chatHistories[sessionId] ?? [];
  }

  async saveMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (!sessionId) return;
    this.chatHistories[sessionId] = messages.slice();
    this.pruneHistories();
    const data = await this.loadRaw();
    await this.plugin.saveData({ ...data, chatHistories: this.chatHistories });
  }

  private async loadRaw(): Promise<Record<string, unknown>> {
    const raw: unknown = await this.plugin.loadData();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  }

  private pruneHistories(): void {
    const validIds = new Set(this.sessions.map((s) => s.sessionId));
    for (const id of Object.keys(this.chatHistories)) {
      if (!validIds.has(id)) delete this.chatHistories[id];
    }
  }

  async saveSessions(): Promise<void> {
    this.sessions.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    if (this.sessions.length > MAX_SESSIONS) {
      const keep = new Set(
        this.sessions.slice(0, MAX_SESSIONS).map((s) => s.sessionId)
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
          sessions?: SessionRecord[];
          chatHistories?: Record<string, ChatMessage[]>;
        }
      | null;
    this.sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    this.chatHistories =
      data?.chatHistories && typeof data.chatHistories === "object"
        ? data.chatHistories
        : {};
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const idx = this.sessions.findIndex((s) => s.sessionId === sessionId);
    if (idx >= 0) this.sessions.splice(idx, 1);
    delete this.chatHistories[sessionId];
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      this.isNewSession = true;
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
    this.currentSessionId = null;
    this.isNewSession = true;
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
}
