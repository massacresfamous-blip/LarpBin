# BreachBin Command Prompt

A Windows Command Prompt client for BreachBin, with an animated terminal logo, signed-in global chat, and commands for reading and creating pastes.

## Requirements

- Windows 10 or later
- Node.js 18 or newer
- A BreachBin server with the CLI API enabled

## Start

1. Extract the ZIP.
2. Double-click `start.bat`.
3. Use the default hosted BreachBin server URL, or enter another HTTPS server URL when prompted.
4. Sign in with your BreachBin username and password.
5. Type `/help` to see the available commands.

You can also run `node cli.js` from Command Prompt, or use `node cli.js --server https://your-breachbin-server` to choose another server. The client does not save your password.

## Commands

- `/chat` — join shared chat; type `/back` to return
- `/pastes` — list the latest 50 pastes
- `/paste <id>` — read a paste
- `/newpaste [title]` — create a paste; enter `.` on a line by itself to save
- `/help` — show commands
- `/logout` — sign out
- `/exit` — close the client

## Server setup

If your BreachBin server already includes `routes/cli-api.js`, the CLI endpoints are ready. Otherwise:

1. Copy `routes/cli-api.js` into the server's `routes` directory.
2. Ensure the server parses JSON request bodies with `express.json()`.
3. Create the `chat_messages` table and mount the API after session middleware. Example:

```js
await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);
app.use('/api/cli', require('./routes/cli-api')(db));
```

The API uses the server's existing Express, SQLite, bcrypt, and session dependencies. Chat and paste endpoints require an authenticated session.

## Contents

- `cli.js` — terminal client
- `start.bat` — Windows launcher
- `public/Media/toplogo.txt` — BreachBin terminal art
- `routes/cli-api.js` — server API source, for server setup if needed
