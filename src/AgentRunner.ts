import type { Provider } from "./types";

export interface RunOptions {
  prompt: string;
  model: string;
  execPath: string;
  vaultPath: string;
  sessionFlag: "--continue" | "--resume" | null;
  sessionId?: string;
  attachedFilePaths?: string[];
  apiKey?: string;
  useApiKey?: boolean;
  provider: Provider;
  /** Previous messages for providers that manage continuity via prompt injection (e.g. Gemini). */
  history?: ReadonlyArray<{ role: string; content: string }>;
}

export interface RunCallbacks {
  onChunk: (text: string) => void;
  onSessionId: (id: string) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export interface AgentRunner {
  run(options: RunOptions, callbacks: RunCallbacks): Promise<void>;
  cancel(): void;
  isRunning(): boolean;
}
