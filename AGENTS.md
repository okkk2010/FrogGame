# AGENTS.md

## Project Overview
- Title: 개구리 키우기 (.io 웹 게임)
- Stack: Node.js + Express + Socket.IO, Matter.js, MySQL, React + TypeScript + PixiJS

## Architecture
- Client (React + Vite)
  - Rendering: PixiJS
  - Physics: Matter.js
  - Networking: Socket.IO client
  - Entry: `client/src/main.tsx`
  - App/UI: `client/src/App.tsx` (로그인/닉네임 입력 → 인게임)
  - Game loop: `client/src/game/FrogGame.tsx`
  - Socket URL helper: `client/src/config/network.ts`
- Server (Express)
  - HTTP + static hosting for `dist/`
  - Socket.IO server on same HTTP server
  - Entry: `server/index.js`
- Transport
  - Socket.IO over WebSocket (websocket transport 우선)
- State (server, in‑memory)
  - `players: Map<socketId, { x, y, stage, color, nickname }>`
- Events
  - Client → Server
    - `player:join` { x:number, y:number, stage:"tadpole"|"frog", nickname:string }
    - `player:update` { x:number, y:number, stage:"tadpole"|"frog" }
  - Server → Client
    - `players:sync` { [id]: { x, y, stage, color, nickname } }
    - `player:joined` { id, x, y, stage, color, nickname }
    - `player:updated` { id, x, y, stage }
    - `player:left` { id }

## Folder Layout
- `/client` — React + Vite 프론트엔드
  - `src/App.tsx` — 로그인(닉네임) → 인게임 HUD
  - `src/game/FrogGame.tsx` — PixiJS + Matter.js 게임 루프, Socket.IO 클라이언트, 이름표 렌더링
  - `src/config/network.ts` — 환경별 소켓 URL 결정
  - `vite.config.ts`, `index.html`
- `/server`
  - `index.js` — Express 정적 서빙 + Socket.IO 서버
- `/dist` — 클라이언트 프로덕션 빌드 결과(Express가 서빙)
- `/scripts/.env.sample` — 예시 환경변수

## Setup / Run
- Install deps: `npm ci`
- Dev (client+server 동시): `npm run dev`
- Server only: `npm run server`
- Client only: `npm run client`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm test` (현재 테스트 파일이 없으면 실패할 수 있음)

## Modes & Env Vars
- Local (DEV)
  - 클라이언트는 기본 `http://localhost:3000`으로 소켓 연결
- Server/Production
  - 동일 출처 배포: `npm run build` → `npm run server`
  - 출처 분리 배포 시:
    - Client(Vite): `VITE_SOCKET_URL=https://<socket-server>`
    - Server(Express): `CLIENT_ORIGIN=https://<client-origin>`
  - 공통: `PORT`(기본 3000), `NODE_ENV`(production 권장)

## Conventions
- TypeScript strict 모드, ESLint + Prettier
- 폴더 레이아웃: `/server`, `/client`, `/shared`
- Networking: Socket.IO 사용, 임의의 WS 직접 사용 금지
- Physics: Matter.js 사용, 커스텀 적분기 금지(논의 전까지)

## Gameplay Rules (Short)
- WASD 이동, 개구리 상태에서 Space 혓바닥 공격
- 1단계(올챙이): 물속 전용 이동(수면 위/바닥 클램프)
- 2단계(개구리): 물/땅 이동 + 공격
- 닉네임: 로그인 시 입력, 캐릭터 머리 위에 표기(타 플레이어에게도 보임)
- 체력 5칸이 있고 공격을 통해 상대방을 타격 가능
- 공격 1회당 체력 1칸이 소모
- 체력이 0이 되어 죽게 되면 다시 0포인트로 초기화, 올챙이로 시작

## Verification
- 최소: `npm run lint` 통과
- 빌드 스모크: `npm run build` → `npm run server` 후 접속 확인
- 테스트: 테스트 파일이 존재하면 `npm test`; 부재 시 생략

## PR / Commit
- Conventional Commits (feat|fix|chore|refactor|test|docs)
- PR title: `[scope] summary`
- Include: 재현 절차, 기대 결과, 증빙(스크린샷/로그)
- 변경 이유와 대안 설명(특히 네트워킹/물리 변경 시)

## Security / Secrets
- `.env` 커밋 금지
- 환경변수 예시는 `scripts/.env.sample` 참고

## Production Notes
- 프록시/로드밸런서에서 WebSocket 업그레이드 허용(Upgrade/Connection 헤더)
- 멀티 인스턴스 스케일링 시 Socket.IO Redis 어댑터 고려(현재 메모리 상태)
- CORS: DEV 또는 `CLIENT_ORIGIN` 설정 시에만 허용, 그 외 동일 출처

## Notes for Agents
- 최소 변경 원칙(Prefer minimal diffs)
- 린트 경고/오류 우선 해결
- 테스트가 존재하면 녹색까지 수정 후 재실행
- 네트워킹 이벤트/프로토콜 변경 시 클라/서버 양쪽 동기화 필수