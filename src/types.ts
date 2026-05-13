export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
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
