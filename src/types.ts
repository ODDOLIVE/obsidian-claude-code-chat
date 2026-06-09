export type Provider = "claude" | "codex" | "gemini";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// 9-B: conversationId-based session record for multi-PC/multi-provider support
export interface SessionRecord {
  conversationId: string;    // Plugin-generated UUID, stable across PC/provider changes
  nativeSessionId?: string;  // Current native session ID from CLI (changes when replaying)
  lastNativeHost?: string;   // Hostname of the machine that created nativeSessionId
  provider?: Provider;       // Last active provider
  startedAt: string;
  lastMessageAt: string;
  previewText: string;
  model: string;
  customName?: string;
  lastSavedPath?: string;
  sharedWithVSCode?: boolean;
}

export interface ClaudeCodeSettings {
  claudePath: string;
  saveFolder: string;
  defaultModel: string;
  autoSave: boolean;
  apiKey: string;
  apiKeyOnly: boolean;
  workingDirectory: string;
  titleSync: boolean;
  attachmentsFolder: string;
  // Codex provider
  codexPath: string;
  defaultProvider: Provider;
  openaiApiKey: string;
  codexApiKeyOnly: boolean;
  defaultModelCodex: string;
  // Gemini provider
  geminiPath: string;
  geminiApiKey: string;
  geminiApiKeyOnly: boolean;
  defaultModelGemini: string;
  // Permissions (9-A)
  permissionMode: "default" | "plan" | "acceptEdits" | "bypassPermissions";
  allowedTools: string;
  disallowedTools: string;
}

// File extensions whose contents are inlined into the prompt as text.
// Other files are referenced by path so the CLI can load them with its Read tool.
export const TEXT_EXTENSIONS = [
  // Markdown / data
  "md", "markdown", "txt", "rtf",
  "json", "jsonc", "yaml", "yml", "toml", "xml", "csv", "tsv", "ndjson",
  // Web
  "js", "mjs", "cjs", "ts", "jsx", "tsx", "html", "htm", "css", "scss", "sass", "less",
  // Backend / systems
  "py", "rb", "java", "kt", "kts", "scala", "groovy",
  "go", "rs", "c", "h", "cpp", "cc", "cxx", "hpp", "hh",
  "cs", "swift", "m", "mm",
  "php", "lua", "pl", "pm", "r", "jl", "dart", "ex", "exs",
  // Shell / scripting
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  // Config / build
  "ini", "cfg", "conf", "env", "properties",
  "dockerfile", "containerfile",
  "gradle", "make", "mk", "cmake",
  "lock", "gitignore", "gitattributes", "editorconfig", "npmrc",
  // SQL / query
  "sql", "graphql", "gql",
  // Logs
  "log",
];

// Files larger than this (in bytes) are rejected on drop to avoid bloating the vault.
export const MAX_DROP_FILE_SIZE = 50 * 1024 * 1024;
