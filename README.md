# BreachBin

## Overview

BreachBin is a polished, anonymous paste-sharing platform with a cleaner interface, faster startup behavior, and a more modern brand identity.

## Features

1. **Content Sharing**: Publish paste-like content quickly and easily.
2. **Privacy-first flow**: Anonymous posting remains available for guests.
3. **Search and browsing**: Discover public posts faster.
4. **Cleaner admin tools**: Improved consistency for the dashboard and database setup.

## Installation

```bash
npm install
npm run start
```

The app runs on port 4000 by default. Set `PORT` to use a different port.

Sessions are stored in the SQLite database and survive application restarts. In production, set a stable `SESSION_SECRET`; in development, the app generates and saves one in `database/session-secret`.

## Windows Command Prompt app

The terminal client provides an animated BreachBin logo, signed-in global chat, and commands for reading and creating pastes. It requires Node.js 18 or newer and an available BreachBin server.

```cmd
npm run cli -- --server https://your-breachbin-server
```

The client defaults to the hosted BreachBin server at `https://spidery-spooky-monster-p795x44x6w5635x9-4000.app.github.dev`; users do not need to run a local server. Sign in with an existing BreachBin account, then use `/help` to see the available commands. Chat and paste commands require sign-in; passwords are not stored by the client. The terminal client requires Node.js 18 or newer.
