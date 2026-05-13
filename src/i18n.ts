type Lang = "en" | "ko";

const STRINGS = {
  en: {
    // Header
    "header.chatNamePlaceholder": "Chat name / search",
    "header.newChat": "New chat",
    "header.history": "Conversation history",
    "header.save": "Save chat",

    // Input area
    "input.writeMessage": "Write a message...",
    "input.menu": "Menu",
    "input.slashCmd": "Command (/)",
    "input.send": "Send",
    "input.stop": "Stop",
    "input.attachFile": "Attach file",
    "input.attachCurrent": "Attach current note",

    // Empty state
    "empty.line1": "💬 Start a conversation with Claude Code.",
    "empty.line2": "Enter to send, Shift+Enter for newline",
    "empty.line3": "Attach the current note or reference vault files.",

    // Notices / messages
    "notice.noActiveNote": "No active note.",
    "notice.unsupportedExt": (ext: string) => `Unsupported file type: .${ext}`,
    "notice.attached": (name: string) => `"${name}" attached`,
    "notice.noConversationToSave": "No conversation to save.",
    "notice.saved": "Conversation saved.",
    "notice.saveFailed": (msg: string) => `Save failed: ${msg}`,
    "notice.autoSaveFailed": (msg: string) => `Auto-save failed: ${msg}`,
    "notice.fileLoadFailed": (msg: string) => `File load failed: ${msg}`,
    "notice.previousRunRunning": "Previous request still running.",
    "notice.claudeNotFound": (path: string) =>
      `claude executable not found (${path}). Set an absolute path in Settings → claudePath.`,
    "notice.processError": (msg: string) => `Process error: ${msg}`,
    "notice.fileReadFailed": (path: string, msg: string) =>
      `[Failed to read file: ${path} — ${msg}]`,

    // Session resume / cancel
    "session.resumedNoMessages":
      "↩️ Resuming previous conversation. (No saved messages)",
    "session.cancelled": "_(Cancelled)_",
    "session.errorPrefix": "An error occurred.",

    // Slash command popup
    "slash.placeholder": "Select command... (model/session/save)",
    "slash.modelPrefix": "Model:",
    "slash.newChat": "Start new chat",
    "slash.newChatHint": "End current session and start fresh",
    "slash.history": "Open conversation history",
    "slash.historyHint": "Previous session list",
    "slash.save": "Save conversation",
    "slash.saveHint": "Save current conversation as .md",
    "slash.attachFile": "Attach file",
    "slash.attachFileHint": "Select file from vault",
    "slash.attachNote": "Attach current note",
    "slash.attachNoteHint": "Attach active note",
    "slash.noMatch": "No matching command.",

    // Session list modal
    "modal.history": "Conversation history",
    "modal.startNew": "+ Start new chat",
    "modal.noSaved": "No saved conversations.",
    "modal.noContent": "(No content)",
    "modal.delete": "Delete",
    "modal.confirmDelete": "Click again to confirm delete",

    // Settings
    "settings.support":
      "If this plugin helps you, you can support its development on Ko-fi. Thanks!",
    "settings.claudePath": "Claude CLI path",
    "settings.claudePathDesc":
      "Absolute path or 'claude' if on PATH. e.g. /opt/homebrew/bin/claude",
    "settings.checkPath": "Check path",
    "settings.pathNotFound": "Path not found.",
    "settings.defaultModel": "Default model",
    "settings.defaultModelDesc": "Default model for new conversations",
    "settings.saveFolder": "Save folder",
    "settings.saveFolderDesc": "Vault-relative path. e.g. Daily Notes/Claude",
    "settings.workingDirectory": "Claude working directory",
    "settings.workingDirectoryDesc":
      "Absolute path used as cwd when running the Claude CLI. Leave empty to use the vault folder. Set this to your VS Code workspace folder to share session history with the VS Code Claude Code extension. Chat .md files are still saved inside the vault under 'Save folder'.",
    "settings.workingDirectoryPlaceholder":
      "e.g. /Users/you/projects/my-app",
    "settings.titleSync": "Sync chat title to VS Code history",
    "settings.titleSyncDesc":
      "When ON, the first prompt of a new chat is sent with a leading '[Title: <name>]' line so VS Code's Claude Code history shows the same title. Disable if you don't want this prefix in your prompts. Only applies to brand-new chats.",
    "settings.autoSave": "Auto-save",
    "settings.autoSaveDesc": "Automatically save .md after each response",
    "settings.generateClaudeMd": "Generate CLAUDE.md",
    "settings.generateClaudeMdDesc":
      "Create a context file for Claude Code at vault root.",
    "settings.generate": "Create",
    "settings.dangerZone": "Danger zone",
    "settings.clearSessions": "Clear all chat history",
    "settings.clearSessionsDesc":
      "⚠️ All in-app chat history (sessions and messages) will be deleted. Saved .md files remain.",
    "settings.clear": "Clear history",
    "settings.confirmOverwriteTitle": "CLAUDE.md already exists",
    "settings.confirmOverwriteMsg": "Overwrite the existing file?",
    "settings.confirmClearTitle": "Clear saved sessions",
    "settings.confirmClearMsg":
      "Delete all conversation history? This cannot be undone.",
    "settings.cancel": "Cancel",
    "settings.confirm": "Confirm",
    "settings.claudeMdOverwritten": "CLAUDE.md overwritten.",
    "settings.claudeMdCreated": "CLAUDE.md created.",
    "settings.createFailed": (msg: string) => `Create failed: ${msg}`,
    "settings.sessionsCleared": "Session history cleared.",

    // Confirmation modal default field hint
    "confirm.alreadyExists": "Already exists",

    // Commands
    "cmd.openChat": "Open Claude Code Chat",
    "cmd.newChat": "Claude Chat: New chat",
    "cmd.saveChat": "Claude Chat: Save conversation",

    // Vault context
    "vault.contextHeader": (name: string) => `# ${name} — Vault Context`,
    "vault.aboutHeader": "## About this vault",
    "vault.aboutBody":
      "This file is created by the Claude Code Chat plugin.\nClaude Code reads it to understand the vault context.",
    "vault.purposeHeader": "## Purpose",
    "vault.purposeBody": "(Describe the purpose of this vault here)",
    "vault.foldersHeader": "## Frequently used folders",
    "vault.foldersBody": "(Describe folder structure here)",
    "vault.notesHeader": "## Notes",
    "vault.notesSaveLoc": "- Conversations saved to: Claude Chats/",
    "vault.notesDateFmt": "- Date format: YYYY-MM-DD",

    // Attachment label
    "attach.attached": (path: string) => `**Attached file:** \`${path}\``,
    "attach.binaryHint":
      "*(Binary/image file — use the Read tool to load it from the path above.)*",
    "attach.dropOnlyFirst":
      "Multiple files dropped. Only the first one is attached.",
    "attach.saveFailed": (msg: string) => `Could not save attachment: ${msg}`,
    "attach.tooLarge": (name: string, mb: number) =>
      `"${name}" exceeds the ${mb}MB attachment size limit. Skipped.`,
    "settings.attachmentsFolder": "Attachments folder",
    "settings.attachmentsFolderDesc":
      "Vault-relative folder for files dropped into the chat. Leave empty to use '<Save folder>/Chat attachments'.",
    "settings.attachmentsFolderPlaceholder":
      "e.g. Claude Chats/Chat attachments",

    "file.conversationHeader": "## Conversation",

    // Auth / Connection
    "auth.section": "Connection",
    "auth.statusTitle": "Status",
    "auth.refresh": "Refresh",
    "auth.cliInstalled": (v: string) => `CLI installed${v ? ` (${v})` : ""}`,
    "auth.cliMissing": "CLI not found",
    "auth.cliMissingDesc":
      "Install Claude Code CLI and set its path in 'Claude CLI path' below, or sign in via VS Code extension.",
    "auth.signedInOauth": "Signed in (OAuth)",
    "auth.signedInApiKey": "Using API token",
    "auth.notSignedIn": "Not signed in",
    "auth.effective": (m: string) => `Active method: ${m}`,
    "auth.signIn": "Sign in",
    "auth.signOut": "Sign out",
    "auth.signInDesc":
      "Sign in to Claude with your Anthropic account. Opens an OAuth URL in your browser.",
    "auth.signInRunning": "Running claude /login...",
    "auth.signInDone": "Sign-in finished. Refreshing status.",
    "auth.signInFailed": (msg: string) => `Sign-in failed: ${msg}`,
    "auth.signOutDone": "Signed out.",
    "auth.signOutFailed": (msg: string) => `Sign-out failed: ${msg}`,
    "auth.openUrlHint": (url: string) => `If a browser did not open, visit: ${url}`,
    "auth.apiKey": "Anthropic API token",
    "auth.apiKeyDesc":
      "Optional. Used only when no OAuth credentials are detected. Stored in plain text inside vault data.json — keep your vault private.",
    "auth.apiKeyPlaceholder": "sk-ant-...",
    "auth.priorityNote":
      "OAuth takes precedence over API token when both are available.",
    "auth.signOutScopeNote":
      "Sign-out only clears the plugin-scoped API token. The Claude CLI / VS Code extension OAuth session is left untouched. To log out system-wide, run `claude /logout` in a terminal.",
    "auth.clearApiKey": "Clear plugin API token",
    "auth.apiKeyCleared": "Plugin API token cleared.",
    "auth.apiKeyAlreadyEmpty": "No API token to clear.",
    "auth.apiKeyOnly": "Use API token only (do not affect system OAuth)",
    "auth.apiKeyOnlyDesc":
      "When ON, ignore the system OAuth credentials managed by Claude CLI / VS Code and authenticate using only the API token below. Lets you log in/out from this plugin without affecting other tools.",
    "error.apiKeyOnlyNoToken":
      "API token only mode is ON, but no API token is set. Enter a token in Settings → Connection.",
    "error.promptTooLong": (kb: number, limitKb: number) =>
      `Prompt size ${kb} kB exceeds the ${limitKb} kB command-line limit. Try a shorter message or detach some files.`,
  },
  ko: {
    // Header
    "header.chatNamePlaceholder": "대화 파일명 / 검색",
    "header.newChat": "새 대화",
    "header.history": "대화 기록",
    "header.save": "대화 저장",

    // Input area
    "input.writeMessage": "메시지를 입력하세요...",
    "input.menu": "메뉴",
    "input.slashCmd": "명령 (/)",
    "input.send": "전송",
    "input.stop": "중단",
    "input.attachFile": "파일 첨부",
    "input.attachCurrent": "현재 노트 첨부",

    // Empty state
    "empty.line1": "💬 Claude Code와 대화를 시작하세요.",
    "empty.line2": "Enter로 전송, Shift+Enter로 줄바꿈",
    "empty.line3": "현재 노트를 첨부하거나 vault 파일을 참조할 수 있습니다.",

    // Notices
    "notice.noActiveNote": "현재 열린 노트가 없습니다.",
    "notice.unsupportedExt": (ext: string) => `지원하지 않는 파일 타입입니다: .${ext}`,
    "notice.attached": (name: string) => `"${name}" 첨부됨`,
    "notice.noConversationToSave": "저장할 대화가 없습니다.",
    "notice.saved": "대화가 저장되었습니다.",
    "notice.saveFailed": (msg: string) => `저장 실패: ${msg}`,
    "notice.autoSaveFailed": (msg: string) => `자동 저장 실패: ${msg}`,
    "notice.fileLoadFailed": (msg: string) => `파일 로드 실패: ${msg}`,
    "notice.previousRunRunning": "이전 요청이 아직 실행 중입니다.",
    "notice.claudeNotFound": (path: string) =>
      `claude 실행 파일을 찾을 수 없습니다 (${path}). Settings에서 claudePath에 절대경로를 지정하세요.`,
    "notice.processError": (msg: string) => `프로세스 오류: ${msg}`,
    "notice.fileReadFailed": (path: string, msg: string) =>
      `[파일 읽기 실패: ${path} — ${msg}]`,

    // Session
    "session.resumedNoMessages":
      "↩️ 이전 대화를 재개합니다. (저장된 메시지 없음)",
    "session.cancelled": "_(중단됨)_",
    "session.errorPrefix": "오류가 발생했습니다.",

    // Slash command popup
    "slash.placeholder": "명령 선택... (모델/세션/저장)",
    "slash.modelPrefix": "모델:",
    "slash.newChat": "새 대화 시작",
    "slash.newChatHint": "현재 세션을 종료하고 새로 시작",
    "slash.history": "대화 기록 열기",
    "slash.historyHint": "이전 세션 목록",
    "slash.save": "대화 저장",
    "slash.saveHint": "현재 대화를 .md로 저장",
    "slash.attachFile": "파일 첨부",
    "slash.attachFileHint": "vault 내 파일 선택",
    "slash.attachNote": "현재 노트 첨부",
    "slash.attachNoteHint": "활성 노트 첨부",
    "slash.noMatch": "일치하는 명령이 없습니다.",

    // Session list modal
    "modal.history": "대화 기록",
    "modal.startNew": "＋ 새 대화 시작",
    "modal.noSaved": "저장된 대화가 없습니다.",
    "modal.noContent": "(내용 없음)",
    "modal.delete": "삭제",
    "modal.confirmDelete": "한 번 더 누르면 삭제됩니다",

    // Settings
    "settings.support":
      "이 plugin이 도움이 됐다면, Ko-fi에서 개발을 응원해 주세요. 감사합니다!",
    "settings.claudePath": "Claude CLI 경로",
    "settings.claudePathDesc":
      "절대 경로 또는 PATH에 있는 경우 'claude'만 입력. 예: /opt/homebrew/bin/claude",
    "settings.checkPath": "경로 확인",
    "settings.pathNotFound": "경로를 찾을 수 없습니다.",
    "settings.defaultModel": "기본 모델",
    "settings.defaultModelDesc": "대화 시작 시 기본으로 사용할 모델",
    "settings.saveFolder": "대화 저장 폴더",
    "settings.saveFolderDesc": "vault 내 상대 경로. 예: Daily Notes/Claude",
    "settings.workingDirectory": "Claude 작업 디렉토리",
    "settings.workingDirectoryDesc":
      "Claude CLI 실행 시 cwd로 사용할 절대 경로. 비워 두면 vault 폴더가 사용됩니다. VS Code workspace 폴더와 동일하게 지정하면 VS Code Claude Code 확장과 세션 기록이 공유됩니다. 채팅 .md 파일은 그대로 vault의 '대화 저장 폴더'에 저장됩니다.",
    "settings.workingDirectoryPlaceholder":
      "예: C:\\Users\\me\\projects\\my-app",
    "settings.titleSync": "VS Code 기록과 채팅 제목 동기화",
    "settings.titleSyncDesc":
      "켜면 새 채팅의 첫 prompt에 '[Title: <이름>]' 줄이 자동 추가되어 VS Code Claude Code 기록에 같은 제목으로 표시됩니다. prompt 본문에 제목이 추가되는 게 싫으면 끄세요. 새 대화의 첫 메시지에만 적용됩니다.",
    "settings.autoSave": "자동 저장",
    "settings.autoSaveDesc": "대화 완료 시 자동으로 .md 파일 저장",
    "settings.generateClaudeMd": "CLAUDE.md 자동 생성",
    "settings.generateClaudeMdDesc":
      "vault 루트에 Claude Code가 참조할 컨텍스트 파일을 생성합니다.",
    "settings.generate": "생성",
    "settings.dangerZone": "위험 영역",
    "settings.clearSessions": "전체 대화 기록 삭제",
    "settings.clearSessionsDesc":
      "⚠️ Plugin에 저장된 모든 대화 기록(세션·메시지)을 삭제합니다. 저장된 .md 파일은 유지됩니다.",
    "settings.clear": "기록 삭제",
    "settings.confirmOverwriteTitle": "CLAUDE.md가 이미 존재합니다",
    "settings.confirmOverwriteMsg": "기존 파일을 덮어쓰시겠습니까?",
    "settings.confirmClearTitle": "저장된 세션 초기화",
    "settings.confirmClearMsg":
      "모든 대화 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    "settings.cancel": "취소",
    "settings.confirm": "확인",
    "settings.claudeMdOverwritten": "CLAUDE.md를 덮어썼습니다.",
    "settings.claudeMdCreated": "CLAUDE.md를 생성했습니다.",
    "settings.createFailed": (msg: string) => `생성 실패: ${msg}`,
    "settings.sessionsCleared": "세션 기록을 삭제했습니다.",

    "confirm.alreadyExists": "이미 존재합니다",

    // Commands
    "cmd.openChat": "Claude Code Chat 열기",
    "cmd.newChat": "Claude Chat: 새 대화 시작",
    "cmd.saveChat": "Claude Chat: 대화 저장",

    // Vault context
    "vault.contextHeader": (name: string) => `# ${name} — Vault 컨텍스트`,
    "vault.aboutHeader": "## 이 Vault에 대해",
    "vault.aboutBody":
      "이 파일은 Claude Code Chat 플러그인이 생성한 컨텍스트 파일입니다.\nClaude Code는 이 파일을 자동으로 읽어 vault의 맥락을 파악합니다.",
    "vault.purposeHeader": "## Vault 사용 목적",
    "vault.purposeBody": "(여기에 vault의 목적을 작성하세요)",
    "vault.foldersHeader": "## 자주 사용하는 폴더 구조",
    "vault.foldersBody": "(여기에 폴더 구조를 설명하세요)",
    "vault.notesHeader": "## 참고 사항",
    "vault.notesSaveLoc": "- 대화 저장 위치: Claude Chats/",
    "vault.notesDateFmt": "- 날짜 형식: YYYY-MM-DD",

    "attach.attached": (path: string) => `**첨부 파일:** \`${path}\``,
    "attach.binaryHint":
      "*(이미지/이진 파일 — 위 경로에서 Read 도구로 로드하세요.)*",
    "attach.dropOnlyFirst":
      "여러 파일을 드롭했습니다. 첫 번째 파일만 첨부됩니다.",
    "attach.saveFailed": (msg: string) => `첨부 파일 저장 실패: ${msg}`,
    "attach.tooLarge": (name: string, mb: number) =>
      `"${name}" 파일이 첨부 크기 제한(${mb}MB)을 초과해 건너뜁니다.`,
    "settings.attachmentsFolder": "첨부 파일 저장 폴더",
    "settings.attachmentsFolderDesc":
      "채팅창에 드롭한 파일이 저장되는 vault 내 상대 경로. 비워 두면 '<대화 저장 폴더>/Chat attachments'에 저장됩니다.",
    "settings.attachmentsFolderPlaceholder":
      "예: Claude Chats/Chat attachments",

    "file.conversationHeader": "## 대화 기록",

    "auth.section": "연결",
    "auth.statusTitle": "상태",
    "auth.refresh": "새로고침",
    "auth.cliInstalled": (v: string) => `CLI 설치됨${v ? ` (${v})` : ""}`,
    "auth.cliMissing": "CLI를 찾을 수 없음",
    "auth.cliMissingDesc":
      "Claude Code CLI를 설치하고 아래 'Claude CLI 경로'에 지정하거나 VS Code 확장으로 로그인하세요.",
    "auth.signedInOauth": "로그인됨 (OAuth)",
    "auth.signedInApiKey": "API 토큰 사용 중",
    "auth.notSignedIn": "로그인되어 있지 않음",
    "auth.effective": (m: string) => `사용 중인 인증: ${m}`,
    "auth.signIn": "로그인",
    "auth.signOut": "로그아웃",
    "auth.signInDesc":
      "Anthropic 계정으로 Claude에 로그인합니다. 브라우저에서 OAuth URL이 열립니다.",
    "auth.signInRunning": "claude /login 실행 중...",
    "auth.signInDone": "로그인 완료. 상태를 새로고침합니다.",
    "auth.signInFailed": (msg: string) => `로그인 실패: ${msg}`,
    "auth.signOutDone": "로그아웃되었습니다.",
    "auth.signOutFailed": (msg: string) => `로그아웃 실패: ${msg}`,
    "auth.openUrlHint": (url: string) =>
      `브라우저가 자동으로 열리지 않으면 다음 URL을 여세요: ${url}`,
    "auth.apiKey": "Anthropic API 토큰",
    "auth.apiKeyDesc":
      "선택 사항. OAuth 자격 증명이 감지되지 않을 때만 사용됩니다. vault 내부 data.json에 평문으로 저장되므로 vault를 비공개로 유지하세요.",
    "auth.apiKeyPlaceholder": "sk-ant-...",
    "auth.priorityNote":
      "OAuth와 API 토큰이 모두 있으면 OAuth가 우선합니다.",
    "auth.signOutScopeNote":
      "로그아웃은 plugin에 저장된 API 토큰만 지웁니다. Claude CLI / VS Code 확장의 OAuth 세션은 건드리지 않습니다. 시스템 전체 로그아웃은 외부 터미널에서 `claude /logout`을 실행하세요.",
    "auth.clearApiKey": "Plugin API 토큰 지우기",
    "auth.apiKeyCleared": "Plugin API 토큰을 지웠습니다.",
    "auth.apiKeyAlreadyEmpty": "지울 API 토큰이 없습니다.",
    "auth.apiKeyOnly": "API 토큰만 사용 (시스템 OAuth에 영향 없음)",
    "auth.apiKeyOnlyDesc":
      "켜면 Claude CLI / VS Code가 관리하는 시스템 OAuth 자격 증명을 무시하고 아래 API 토큰만으로 인증합니다. 다른 도구에 영향 없이 plugin 단독으로 login/logout할 수 있습니다.",
    "error.apiKeyOnlyNoToken":
      "API 토큰 전용 모드가 켜져 있는데 API 토큰이 설정되어 있지 않습니다. Settings → 연결에서 토큰을 입력하세요.",
    "error.promptTooLong": (kb: number, limitKb: number) =>
      `Prompt 크기 ${kb} kB가 명령행 제한 ${limitKb} kB를 초과합니다. 메시지를 짧게 하거나 일부 첨부를 제거하세요.`,
  },
} as const;

type En = typeof STRINGS["en"];
type Key = keyof En;

export function getLang(): Lang {
  try {
    const lang = window.localStorage.getItem("language");
    return lang === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
}

export function t(key: Key): string;
export function t(key: Key, ...args: unknown[]): string;
export function t(key: Key, ...args: unknown[]): string {
  const lang = getLang();
  const dict = STRINGS[lang] as Record<string, unknown>;
  const fallback = STRINGS.en as Record<string, unknown>;
  const entry = dict[key] ?? fallback[key];
  if (typeof entry === "function") {
    return (entry as (...a: unknown[]) => string)(...args);
  }
  return (entry as string) ?? key;
}
