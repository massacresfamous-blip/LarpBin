const express = require('express');
const bcrypt = require('bcrypt');

const MAX_PASTE_BYTES = 1024 * 1024;
const MAX_CHAT_LENGTH = 1000;

module.exports = function createCliApi(db) {
    const router = express.Router();

    router.post('/login', (req, res) => {
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
        const password = typeof req.body.password === 'string' ? req.body.password : '';
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        db.get('SELECT id, username, password, background_image FROM users WHERE username = ?', [username], async (error, user) => {
            if (error) {
                console.error('CLI login lookup failed:', error);
                return res.status(500).json({ error: 'Unable to sign in' });
            }
            if (!user) return res.status(401).json({ error: 'Invalid username or password' });

            try {
                if (!await bcrypt.compare(password, user.password)) {
                    return res.status(401).json({ error: 'Invalid username or password' });
                }

                req.session.regenerate((sessionError) => {
                    if (sessionError) {
                        console.error('CLI session creation failed:', sessionError);
                        return res.status(500).json({ error: 'Unable to start a session' });
                    }

                    req.session.userId = user.id;
                    req.session.userBackground = user.background_image || null;
                    req.session.save((saveError) => {
                        if (saveError) {
                            console.error('CLI session save failed:', saveError);
                            return res.status(500).json({ error: 'Unable to save session' });
                        }
                        res.json({ id: user.id, username: user.username });
                    });
                });
            } catch (compareError) {
                console.error('CLI password verification failed:', compareError);
                res.status(500).json({ error: 'Unable to verify sign-in' });
            }
        });
    });

    function requireCliLogin(req, res, next) {
        const userId = req.session && req.session.userId;
        if (!userId) return res.status(401).json({ error: 'Sign in to use chat and pastes' });

        db.get('SELECT id, username FROM users WHERE id = ?', [userId], (error, user) => {
            if (error) {
                console.error('CLI session lookup failed:', error);
                return res.status(500).json({ error: 'Unable to verify sign-in' });
            }
            if (!user) return res.status(401).json({ error: 'Sign in to use chat and pastes' });
            req.cliUser = user;
            next();
        });
    }

    router.get('/me', requireCliLogin, (req, res) => {
        res.json(req.cliUser);
    });

    router.post('/logout', requireCliLogin, (req, res) => {
        req.session.destroy((error) => {
            if (error) {
                console.error('CLI logout failed:', error);
                return res.status(500).json({ error: 'Unable to sign out' });
            }
            res.clearCookie('connect.sid');
            res.sendStatus(204);
        });
    });

    router.get('/chat', requireCliLogin, (req, res) => {
        const afterId = req.query.after === undefined ? null : Number(req.query.after);
        if (afterId !== null && (!Number.isSafeInteger(afterId) || afterId < 0)) {
            return res.status(400).json({ error: 'Invalid chat cursor' });
        }

        const sql = afterId === null
            ? `SELECT chat_messages.id, chat_messages.user_id, users.username, chat_messages.message, chat_messages.created_at
               FROM chat_messages JOIN users ON users.id = chat_messages.user_id
               ORDER BY chat_messages.id DESC LIMIT 30`
            : `SELECT chat_messages.id, chat_messages.user_id, users.username, chat_messages.message, chat_messages.created_at
               FROM chat_messages JOIN users ON users.id = chat_messages.user_id
               WHERE chat_messages.id > ? ORDER BY chat_messages.id ASC LIMIT 100`;
        const params = afterId === null ? [] : [afterId];

        db.all(sql, params, (error, messages) => {
            if (error) {
                console.error('CLI chat load failed:', error);
                return res.status(500).json({ error: 'Unable to load chat' });
            }
            res.json({ messages: afterId === null ? messages.reverse() : messages });
        });
    });

    router.post('/chat', requireCliLogin, (req, res) => {
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
        if (!message) return res.status(400).json({ error: 'Message cannot be empty' });
        if (message.length > MAX_CHAT_LENGTH) {
            return res.status(400).json({ error: `Messages must be ${MAX_CHAT_LENGTH} characters or fewer` });
        }

        const createdAt = new Date().toISOString();
        db.run(
            'INSERT INTO chat_messages (user_id, message, created_at) VALUES (?, ?, ?)',
            [req.cliUser.id, message, createdAt],
            function (error) {
                if (error) {
                    console.error('CLI chat send failed:', error);
                    return res.status(500).json({ error: 'Unable to send message' });
                }
                res.status(201).json({
                    id: this.lastID,
                    user_id: req.cliUser.id,
                    username: req.cliUser.username,
                    message,
                    created_at: createdAt
                });
            }
        );
    });

    router.get('/pastes', requireCliLogin, (req, res) => {
        db.all(
            `SELECT id, title, user_name AS username, created_at, content_size
             FROM pastes ORDER BY id DESC LIMIT 50`,
            [],
            (error, pastes) => {
                if (error) {
                    console.error('CLI paste list failed:', error);
                    return res.status(500).json({ error: 'Unable to load pastes' });
                }
                res.json({ pastes });
            }
        );
    });

    router.get('/pastes/:id', requireCliLogin, (req, res) => {
        const pasteId = Number(req.params.id);
        if (!Number.isSafeInteger(pasteId) || pasteId < 1) {
            return res.status(400).json({ error: 'Paste ID must be a positive number' });
        }

        db.get(
            `SELECT id, title, user_name AS username, content, created_at
             FROM pastes WHERE id = ?`,
            [pasteId],
            (error, paste) => {
                if (error) {
                    console.error('CLI paste load failed:', error);
                    return res.status(500).json({ error: 'Unable to load paste' });
                }
                if (!paste) return res.status(404).json({ error: 'Paste not found' });
                res.json(paste);
            }
        );
    });

    router.post('/pastes', requireCliLogin, (req, res) => {
        const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        const content = typeof req.body.content === 'string' ? req.body.content : '';
        if (!content.trim()) return res.status(400).json({ error: 'Paste content cannot be empty' });
        if (Buffer.byteLength(content, 'utf8') > MAX_PASTE_BYTES) {
            return res.status(413).json({ error: 'Pastes are limited to 1 MB in the command prompt app' });
        }
        if (title.length > 120) return res.status(400).json({ error: 'Titles must be 120 characters or fewer' });

        const pasteTitle = title || `Command Prompt Paste ${new Date().toISOString().slice(0, 10)}`;
        const createdAt = new Date().toISOString();
        const contentSize = Buffer.byteLength(content, 'utf8');
        db.run(
            `INSERT INTO pastes (title, content, created_at, user_name, content_size, text_color)
             VALUES (?, ?, ?, ?, ?, '#FFFFFF')`,
            [pasteTitle, content, createdAt, req.cliUser.username, contentSize],
            function (error) {
                if (error) {
                    console.error('CLI paste creation failed:', error);
                    return res.status(500).json({ error: 'Unable to create paste' });
                }
                res.status(201).json({
                    id: this.lastID,
                    title: pasteTitle,
                    username: req.cliUser.username,
                    created_at: createdAt,
                    content_size: contentSize
                });
            }
        );
    });

    return router;
};
