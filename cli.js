#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const readlinePromises = require('readline/promises');

const ANSI = {
    reset: '\u001b[0m',
    dim: '\u001b[2m',
    red: '\u001b[31m',
    brightRed: '\u001b[91m',
    white: '\u001b[97m',
    gray: '\u001b[90m',
    clear: '\u001b[2J\u001b[H'
};

function getServerUrl() {
    const serverIndex = process.argv.indexOf('--server');
    if (serverIndex >= 0 && !process.argv[serverIndex + 1]) {
        throw new Error('Provide a URL after --server');
    }
    const serverArgument = serverIndex >= 0 ? process.argv[serverIndex + 1] : null;
    const rawUrl = serverArgument || process.env.BREACHBIN_URL || 'https://spidery-spooky-monster-p795x44x6w5635x9-4000.app.github.dev';

    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('Use a valid server URL, such as http://localhost:4000');
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('The server URL must use HTTP or HTTPS and must not contain credentials');
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('Use HTTPS when connecting to a remote BreachBin server');
    }
    return url.origin;
}

function safeTerminalText(value) {
    return String(value)
        .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\))/g, '')
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
}

function safePasteText(value) {
    return String(value)
        .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\))/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ');
}

async function printLogo() {
    const logoPath = path.join(__dirname, 'public', 'Media', 'toplogo.txt');
    let logo;
    try {
        logo = fs.readFileSync(logoPath, 'utf8').trimEnd();
    } catch (error) {
        throw new Error(`Unable to load terminal logo: ${error.message}`);
    }

    const lines = logo.split(/\r?\n/);
    if (process.stdout.isTTY) {
        for (let frame = 0; frame < 5; frame += 1) {
            process.stdout.write(ANSI.clear);
            lines.forEach((line, index) => {
                const color = (index + frame) % 2 === 0 ? ANSI.brightRed : ANSI.red;
                process.stdout.write(`${color}${line}${ANSI.reset}\n`);
            });
            await new Promise((resolve) => setTimeout(resolve, 90));
        }
        process.stdout.write(ANSI.clear);
    }

    lines.forEach((line, index) => {
        const color = index % 2 === 0 ? ANSI.brightRed : ANSI.red;
        process.stdout.write(`${color}${line}${ANSI.reset}\n`);
    });
    process.stdout.write(`\n${ANSI.white}BREACHBIN COMMAND PROMPT${ANSI.reset}\n`);
    process.stdout.write(`${ANSI.gray}Chat and paste tools for signed-in users${ANSI.reset}\n\n`);
}

function askPassword() {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
        const fallback = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
        return fallback.question('Password (input visible in this terminal): ').finally(() => fallback.close());
    }

    process.stdout.write('Password: ');
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    return new Promise((resolve) => {
        let password = '';
        const finish = (value) => {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(Boolean(wasRaw));
            process.stdout.write('\n');
            resolve(value);
        };
        const onData = (chunk) => {
            for (const character of chunk.toString('utf8')) {
                if (character === '\u0003') {
                    process.stdout.write('\n');
                    process.exit(130);
                } else if (character === '\r' || character === '\n') {
                    return finish(password);
                } else if (character === '\u007f' || character === '\b') {
                    password = password.slice(0, -1);
                } else if (character >= ' ') {
                    password += character;
                }
            }
        };
        process.stdin.on('data', onData);
    });
}

function createApiClient(serverUrl) {
    let sessionCookie = '';

    async function request(endpoint, options = {}) {
        const headers = { Accept: 'application/json', ...options.headers };
        if (sessionCookie) headers.Cookie = sessionCookie;
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';

        let response;
        try {
            response = await fetch(`${serverUrl}/api/cli${endpoint}`, {
                ...options,
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                redirect: 'manual'
            });
        } catch (error) {
            throw new Error(`Could not reach ${serverUrl}: ${error.message}`);
        }

        const setCookies = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [response.headers.get('set-cookie')].filter(Boolean);
        const sessionHeader = setCookies.find((cookie) => cookie.startsWith('connect.sid='));
        if (sessionHeader) sessionCookie = sessionHeader.split(';', 1)[0];
        if (response.status === 204) return null;

        const responseText = await response.text();
        let data;
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch {
            throw new Error(`Server returned an unexpected response (HTTP ${response.status})`);
        }

        if (!response.ok) {
            throw new Error(data.error || `Request failed (HTTP ${response.status})`);
        }
        return data;
    }

    return {
        login: (username, password) => request('/login', { method: 'POST', body: { username, password } }),
        me: () => request('/me'),
        logout: () => request('/logout', { method: 'POST' }),
        getChat: (after) => request(`/chat${after === null ? '' : `?after=${after}`}`),
        sendChat: (message) => request('/chat', { method: 'POST', body: { message } }),
        getPastes: () => request('/pastes'),
        getPaste: (id) => request(`/pastes/${encodeURIComponent(id)}`),
        createPaste: (title, content) => request('/pastes', { method: 'POST', body: { title, content } })
    };
}

function printHelp() {
    console.log(`
${ANSI.white}Commands${ANSI.reset}
  /chat                 Join the signed-in global chat
  /pastes               List the latest 50 pastes
  /paste <id>           Read a paste
  /newpaste [title]     Create a paste; finish content with a line containing only .
  /help                 Show commands
  /logout               Sign out
  /exit                 Close the command prompt

In chat, type /back to return to the command prompt.`);
}

function runCommandPrompt(api, username, serverUrl) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdout.isTTY) });
    const prompt = `${ANSI.brightRed}BREACHBIN${ANSI.reset} ${ANSI.gray}>${ANSI.reset} `;
    let mode = 'commands';
    let busy = false;
    let closing = false;
    let chatTimer = null;
    let chatCursor = null;
    let pasteTitle = '';
    let pasteLines = [];
    let pollInProgress = false;

    const showPrompt = () => {
        if (!closing) {
            rl.setPrompt(mode === 'chat' ? `${ANSI.red}CHAT${ANSI.reset} ${ANSI.gray}>${ANSI.reset} ` : mode === 'paste' ? `${ANSI.gray}...${ANSI.reset} ` : prompt);
            rl.prompt();
        }
    };

    const printMessages = (messages) => {
        for (const message of messages) {
            chatCursor = Math.max(chatCursor || 0, message.id);
            const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            console.log(`${ANSI.gray}${time}${ANSI.reset} ${ANSI.brightRed}${safeTerminalText(message.username)}${ANSI.reset}: ${safeTerminalText(message.message)}`);
        }
    };

    const pollChat = async (redrawPrompt = false) => {
        if (pollInProgress || mode !== 'chat') return;
        pollInProgress = true;
        try {
            const { messages } = await api.getChat(chatCursor);
            if (messages.length) {
                if (redrawPrompt && process.stdout.isTTY) process.stdout.write('\r\u001b[2K');
                printMessages(messages);
                if (redrawPrompt) showPrompt();
            }
        } catch (error) {
            console.error(`\n${ANSI.red}${safeTerminalText(error.message)}${ANSI.reset}`);
            if (error.message.includes('Sign in')) {
                clearInterval(chatTimer);
                mode = 'commands';
            }
            if (redrawPrompt) showPrompt();
        } finally {
            pollInProgress = false;
        }
    };

    const close = async (logout = false) => {
        closing = true;
        if (chatTimer) clearInterval(chatTimer);
        if (logout) {
            try {
                await api.logout();
                console.log('Signed out.');
            } catch (error) {
                console.error(`Sign-out failed: ${error.message}`);
            }
        }
        rl.close();
    };

    console.log(`Signed in as ${ANSI.white}${safeTerminalText(username)}${ANSI.reset}. Type ${ANSI.brightRed}/help${ANSI.reset} for commands.`);
    rl.on('close', () => {
        if (chatTimer) clearInterval(chatTimer);
        process.exitCode = 0;
    });

    rl.on('line', async (rawLine) => {
        const line = rawLine.trim();
        if (busy || closing) return;

        if (mode === 'paste') {
            if (line === '.') {
                busy = true;
                try {
                    const paste = await api.createPaste(pasteTitle, pasteLines.join('\n'));
                    console.log(`Paste saved: ${serverUrl}/paste?id=${paste.id}`);
                } catch (error) {
                    console.error(`${ANSI.red}${safeTerminalText(error.message)}${ANSI.reset}`);
                } finally {
                    mode = 'commands';
                    pasteTitle = '';
                    pasteLines = [];
                    busy = false;
                    showPrompt();
                }
                return;
            }
            pasteLines.push(rawLine);
            showPrompt();
            return;
        }

        if (mode === 'chat') {
            if (line.toLowerCase() === '/back') {
                clearInterval(chatTimer);
                chatTimer = null;
                mode = 'commands';
                console.log('Left chat.');
                showPrompt();
                return;
            }
            if (!line) {
                showPrompt();
                return;
            }
            busy = true;
            try {
                await api.sendChat(line);
            } catch (error) {
                console.error(`${ANSI.red}${safeTerminalText(error.message)}${ANSI.reset}`);
            } finally {
                busy = false;
                showPrompt();
            }
            return;
        }

        if (!line) return showPrompt();
        const [command, ...args] = line.split(/\s+/);
        const argument = args.join(' ');
        busy = true;
        try {
            switch (command.toLowerCase()) {
                case '/help':
                    printHelp();
                    break;
                case '/chat': {
                    const result = await api.getChat(null);
                    chatCursor = 0;
                    printMessages(result.messages);
                    mode = 'chat';
                    chatTimer = setInterval(() => pollChat(true), 2000);
                    console.log(`${ANSI.gray}Chat is live. Type /back to leave.${ANSI.reset}`);
                    break;
                }
                case '/pastes': {
                    const { pastes } = await api.getPastes();
                    if (!pastes.length) {
                        console.log('No pastes found.');
                    } else {
                        pastes.forEach((paste) => {
                            console.log(`${ANSI.brightRed}#${paste.id}${ANSI.reset} ${safeTerminalText(paste.title)} ${ANSI.gray}by ${safeTerminalText(paste.username)} · ${paste.content_size} bytes${ANSI.reset}`);
                        });
                    }
                    break;
                }
                case '/paste': {
                    if (!args[0]) {
                        console.log('Usage: /paste <id>');
                        break;
                    }
                    const paste = await api.getPaste(args[0]);
                    console.log(`\n${ANSI.white}${safeTerminalText(paste.title)}${ANSI.reset} ${ANSI.gray}by ${safeTerminalText(paste.username)} · #${paste.id}${ANSI.reset}\n`);
                    console.log(safePasteText(paste.content));
                    console.log();
                    break;
                }
                case '/newpaste':
                    pasteTitle = argument;
                    pasteLines = [];
                    mode = 'paste';
                    console.log('Enter paste content. Type a single . on its own line to save.');
                    break;
                case '/logout':
                    await close(true);
                    return;
                case '/exit':
                    await close();
                    return;
                default:
                    console.log('Unknown command. Type /help for commands.');
            }
        } catch (error) {
            console.error(`${ANSI.red}${safeTerminalText(error.message)}${ANSI.reset}`);
        } finally {
            busy = false;
            showPrompt();
        }
    });

    showPrompt();
}

async function main() {
    if (process.argv.includes('--help')) {
        console.log('Usage: npm run cli -- [--server https://your-breachbin-server]');
        console.log(`Default server: ${process.env.BREACHBIN_URL || 'https://spidery-spooky-monster-p795x44x6w5635x9-4000.app.github.dev'}`);
        console.log('Remote servers must use HTTPS.');
        return;
    }

    const serverUrl = getServerUrl();
    await printLogo();
    console.log(`Server: ${serverUrl}\n`);

    const loginRl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    const username = (await loginRl.question('Username: ')).trim();
    loginRl.close();
    const password = await askPassword();
    const api = createApiClient(serverUrl);

    try {
        const user = await api.login(username, password);
        runCommandPrompt(api, user.username, serverUrl);
    } catch (error) {
        console.error(`${ANSI.red}Sign-in failed: ${safeTerminalText(error.message)}${ANSI.reset}`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`${ANSI.red}${safeTerminalText(error.message)}${ANSI.reset}`);
    process.exitCode = 1;
});
