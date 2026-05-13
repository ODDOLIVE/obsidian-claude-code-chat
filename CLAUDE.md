# obsidian-claude-code-chat — 프로젝트 컨텍스트

## 플러그인 목적
Obsidian side panel에서 Claude Code CLI와 대화하는 플러그인.
API key 불필요. Claude Pro/Max 구독으로 인증된 로컬 claude CLI를 사용.

## 핵심 제약
- 추가 비용 발생 없어야 함 (API 직접 호출 금지)
- claude CLI를 child_process.spawn으로 호출하는 방식만 사용
- isDesktopOnly: true (Node.js child_process 의존)

## 기술 스택
- TypeScript
- Obsidian Plugin API (obsidian 패키지)
- Node.js built-in: child_process, path, fs
- 외부 npm 패키지 추가 금지 (번들 크기 및 의존성 최소화)

## Claude Code CLI 호출 방식
```bash
claude -p "프롬프트" \
  --model <model> \
  --output-format stream-json \
  --continue
```
- `-p` : non-interactive (print) 모드
- `--output-format stream-json` : 스트리밍 JSON 출력
- `--continue` : 직전 세션 이어가기
- `--resume <session-id>` : 특정 세션 재개
- cwd는 항상 vault 루트 경로로 설정

## stream-json 파싱 규칙
stdout에서 줄 단위로 JSON을 파싱한다.
assistant 메시지의 content 블록에서 type === "text"인 것만 추출.

## 파일별 역할
- src/main.ts : Plugin 클래스, 뷰 등록, 설정 로드
- src/ClaudeView.ts : ItemView (side panel UI, 채팅 렌더링)
- src/ClaudeRunner.ts : child_process.spawn으로 claude CLI 호출, 스트리밍 파싱
- src/SessionManager.ts : session_id 저장/불러오기, --continue/--resume 전환
- src/SaveManager.ts : 대화 내용을 .md 파일로 저장
- src/SettingsTab.ts : PluginSettingTab (claude 경로, 저장 폴더, 기본 모델)

## 설정 타입 (모든 파일에서 공유)
```typescript
interface ClaudeCodeSettings {
  claudePath: string;      // 기본값: "claude"
  saveFolder: string;      // 기본값: "Claude Chats"
  defaultModel: string;    // 기본값: "claude-sonnet-4-6"
  autoSave: boolean;       // 기본값: true
}
```

## 개발 단계
Phase 1: ClaudeView.ts — Side Panel UI
Phase 2: ClaudeRunner.ts — CLI 연동 + 스트리밍
Phase 3: SessionManager.ts — 세션 관리
Phase 4: SaveManager.ts — .md 저장
Phase 5: 파일 첨부 기능
Phase 6: SettingsTab.ts + 마무리
