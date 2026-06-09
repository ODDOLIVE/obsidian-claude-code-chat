import { ChatMessage, Provider } from "./types";

const MAX_PROMPT_BYTES = 28_000;

/**
 * Build replay preamble from conversation history.
 * Injects prior messages into the prompt for continuity across PC/provider boundaries (9-B).
 */
export function buildReplayPreamble(messages: ChatMessage[], provider: Provider): string {
  if (messages.length === 0) return "";

  const lines = messages
    .map((m) => `### ${m.role === "user" ? "User" : provider === "codex" ? "Codex" : provider === "gemini" ? "Gemini" : "Claude"}: ${m.content}`)
    .join("\n\n");

  return `以下は前回の会話記録です。このコンテキストを引き継いで返答してください。(このセクション自体への返答は不要です)\n\n${lines}\n\n---\n`;
}

/**
 * Trim oldest user+assistant pairs from history if total prompt exceeds MAX_PROMPT_BYTES.
 * Ensures prompt fits within OS command-line limits.
 */
export function trimHistoryIfNeeded(
  messages: ChatMessage[],
  fullPrompt: string
): ChatMessage[] {
  let result = [...messages];
  let prompt = fullPrompt;

  while (result.length >= 2 && Buffer.byteLength(prompt, "utf-8") > MAX_PROMPT_BYTES) {
    // Remove oldest pair (user + assistant)
    result = result.slice(2);
    // Rebuild preamble
    const preamble = buildReplayPreamble(result, "claude");
    prompt = preamble + fullPrompt;
  }

  return result;
}

/**
 * Build full prompt with history injection for replay (9-B).
 * Returns [finalPrompt, isTrimmed] so caller can decide whether to ref file instead.
 */
export function buildPromptWithHistory(
  currentPrompt: string,
  history: ChatMessage[],
  provider: Provider
): [string, boolean] {
  const preamble = buildReplayPreamble(history, provider);
  const fullPrompt = preamble + currentPrompt;

  if (Buffer.byteLength(fullPrompt, "utf-8") <= MAX_PROMPT_BYTES) {
    return [fullPrompt, false];
  }

  // Exceeded: trim and rebuild
  const trimmed = trimHistoryIfNeeded(history, currentPrompt);
  const trimmedPreamble = buildReplayPreamble(trimmed, provider);
  const finalPrompt = trimmedPreamble + currentPrompt;

  return [finalPrompt, true];
}
