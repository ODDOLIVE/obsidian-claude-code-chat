# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-13
### Added
- Side-panel chat view backed by the Claude Code CLI (`claude -p ... --output-format stream-json`).
- Session manager with continue and resume flows, including chat history search and individual/all-history deletion.
- Save chats as Markdown — date-grouped bullets, customizable filename, in-place rename on save.
- Slash command popup with arrow-key navigation, click selection, and search filter.
- Header actions: filename input with search dropdown, new chat, history, save.
- Authentication: OAuth (shared with Claude CLI / VS Code extension) and plugin-scoped API token, with an "API token only" mode.
- Internationalization: English by default, Korean when Obsidian language is set to `ko`.
- Working directory override so chats can be shared with the VS Code Claude Code extension.
- Drag & drop attachments, multi-attachment support, configurable attachments folder, 50 MB per-file size cap.
- Automatic inline-to-path fallback for large attachments to stay within the OS command-line argv limit.
- Settings: Ko-fi support callout at the top of the settings tab.
- Privacy notice in Settings about API token plaintext storage in vault `data.json`.
