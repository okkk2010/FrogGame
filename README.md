# Frog Game (.io)

Frog Game is a browser-based prototype for a frog-raising .io experience. The project couples a lightweight Node.js + Express server with a React + TypeScript client rendered with PixiJS and powered by Matter.js physics. The current focus is on showcasing core movement and combat interactions across the tadpole and frog life stages.

## Features
- Interactive demo that swaps between tadpole (water-only) and frog (land + water) movement states
- WASD keyboard movement with stage-aware speed caps and force tuning via Matter.js
- Space-bar tongue attack that snaps to the frog heading and registers successful hits
- Simple Express server that serves the production build and exposes a /health probe

## Tech Stack
- React 18, TypeScript, Vite, PixiJS for the client runtime and rendering
- Matter.js for lightweight physics simulation and collision handling
- Node.js 20+, Express 4 for serving the built client (Socket.IO integration planned)
- ESLint, Prettier, Vitest for quality tooling

## Getting Started
1. Install Node.js 20 or newer.
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Start the client in development mode (Vite dev server):
   ```bash
   npm run dev
   ```
   By default this proxies to the Vite host defined in client/vite.config.ts.
4. Optional: run the standalone Express server against a production build.
   ```bash
   npm run build
   npm run server
   ```
   The server will serve the static assets from dist/ and provide a health-check at http://localhost:3000/health.

## Available Scripts
- npm run dev - start the Vite-powered client dev server
- npm run client - same as npm run dev, kept for clarity
- npm run build - generate an optimized production build into dist/
- npm run server - serve the compiled client via Express
- npm run lint - run ESLint on the client source
- npm test - execute the Vitest unit test suite

## Local vs Server modes

- Local development
  - `npm run dev` launches the client (Vite) and server together.
  - The client connects to Socket.IO at `http://localhost:3000` by default.

- Server/production
  - Build client: `npm run build` (outputs `dist/`).
  - Start server: `npm run server` (serves `dist/` and Socket.IO on the same origin).
  - If hosting client and server on different origins, set:
    - Server: `CLIENT_ORIGIN=https://<client-domain>`
    - Client (Vite): `VITE_SOCKET_URL=https://<server-domain>`
  - See `scripts/.env.sample` for examples.

## Gameplay Notes
- Stage 1: Tadpole - movement restricted to the water area and tuned for slower acceleration
- Stage 2: Frog - land and water movement unlocked; space-bar triggers a tongue lash attack
- Every successful tongue hit increments the on-screen counter and relocates the target
- The UI lets you swap between stages to validate transitions and controls

## Project Structure
```
FrogGame/
|- client/              # React + PixiJS front-end
|  |- src/App.tsx       # HUD and stage controls
|  |- src/game/         # PixiJS + Matter.js gameplay loop
|  |- vite.config.ts    # Vite configuration for the client
|- server/
|  |- index.js          # Express server that serves the built client
|- package.json         # Root scripts and dependency list
|- tsconfig.json        # Shared TypeScript compiler options
|- .eslintrc.cjs        # ESLint configuration
|- README.md            # Project documentation (this file)
```

## Development Workflow
- Keep changes passing npm run lint and npm test
- Build the client with npm run build before deploying the static assets
- Environment variables can be provided through .env files; do not commit secrets, use scripts/.env.sample as a template if present

## Roadmap
- Add Socket.IO for real-time multiplayer sessions
- Persist player progress via a backing store such as MySQL
- Extend the combat demo with enemies and scoring rules
- Implement end-to-end smoke tests for the player lifecycle

## License
This project is currently unpublished; confirm licensing requirements before distribution.
