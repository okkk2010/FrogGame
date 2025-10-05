# AGENTS.md

## Project overview
- Title: 개구리 키우기 (.io 웹 게임)
- Stack: Node.js + Express + Socket.IO, Matter.js, MySQL, React + TypeScript + PixiJS

## Setup / Run
- Install deps: npm ci
- Dev server: npm run dev
- Server only: npm run server
- Client only: npm run client
- Lint: npm run lint
- Test: npm test
- Build: npm run build

## Conventions
- TypeScript strict mode, ESLint + Prettier
- Folder layout: /server, /client, /shared
- Networking: use Socket.IO; avoid ad-hoc WS
- Physics: use Matter.js; no custom integrators unless discussed

## Gameplay rules (short)
- WASD 이동, 개구리 상태에서 Space 혓바닥 공격
- 1단계(올챙이): 물속 전용 이동
- 2단계(개구리): 물/땅 이동 + 공격

## Verification steps
- Before PR: npm run lint && npm test
- Server e2e smoke: npm run test:e2e
- Client build check: npm run build:client

## PR / Commit
- Conventional Commits (feat|fix|chore|refactor|test|docs)
- PR title: [scope] summary
- Include: 재현 절차, 기대 결과, 테스트 증거(스크린샷/로그)

## Security / Secrets
- 절대 .env를 커밋하지 말 것
- 테스트용 키는 scripts/.env.sample 참고

## Notes for agents
- If tests fail, fix and re-run until green
- Prefer minimal diffs; explain rationale in PR description
