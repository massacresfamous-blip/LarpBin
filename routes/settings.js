const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
const uploadDirectory = path.resolve(__dirname, '..', 'public', 'uploads', 'backgrounds');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

function getDatabaseRow(sql, parameters = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, parameters, (err, row) => err ? reject(err) : resolve(row));
    });
}

function runDatabaseQuery(sql, parameters = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, parameters, function (err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
}

async function changeUsername(userId, username) {
    const transactionDb = new sqlite3.Database(dbPath);
    const getRow = (sql, parameters = []) => new Promise((resolve, reject) => {
        transactionDb.get(sql, parameters, (err, row) => err ? reject(err) : resolve(row));
    });
    const run = (sql, parameters = []) => new Promise((resolve, reject) => {
        transactionDb.run(sql, parameters, function (err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
    let transactionStarted = false;

    try {
        await run('BEGIN IMMEDIATE');
        transactionStarted = true;
        const account = await getRow('SELECT username, username_changed FROM users WHERE id = ?', [userId]);
        if (!account) return { status: 404, message: 'User not found' };
        if (Number(account.username_changed) === 1) {
            return { status: 409, message: 'Your one username change has already been used' };
        }
        if (account.username === username) return { status: 400, message: 'Choose a different username' };

        const existingUser = await getRow(
            'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?',
            [username, userId]
        );
        if (existingUser) return { status: 409, message: 'That username is already taken' };

        const update = await run(
            'UPDATE users SET username = ?, username_changed = 1 WHERE id = ? AND username_changed = 0',
            [username, userId]
        );
        if (update.changes !== 1) {
            return { status: 409, message: 'Your one username change has already been used' };
        }
        await run('UPDATE pastes SET user_name = ? WHERE user_name = ?', [username, account.username]);
        await run('COMMIT');
        transactionStarted = false;
        return { status: 200 };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
            return { status: 409, message: 'That username is already taken' };
        }
        throw error;
    } finally {
        if (transactionStarted) {
            await run('ROLLBACK').catch((error) => {
                console.error('Error rolling back username change:', error);
            });
        }
        await new Promise((resolve, reject) => {
            transactionDb.close((err) => err ? reject(err) : resolve());
        });
    }
}

function requireSignIn(req, res, next) {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    next();
}

function isAdmin(user) {
    return Number(user.admin) === 1 || String(user.role || '').toLowerCase() === 'admin';
}

function getImageExtension(data) {
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
    if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) return '.gif';
    if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    return null;
}

function removePreviousBackground(backgroundUrl) {
    const prefix = '/uploads/backgrounds/';
    if (typeof backgroundUrl !== 'string' || !backgroundUrl.startsWith(prefix)) return;
    fs.unlink(path.join(uploadDirectory, path.basename(backgroundUrl)), () => {});
}

router.get('/', requireSignIn, (req, res) => {
    db.get(
        `SELECT id, username, admin, role, background_image, username_changed,
                username_color, username_effect, username_size, username_weight,
                profile_layout, username_particle
         FROM users WHERE id = ?`,
        [req.session.userId],
        (err, user) => {
        if (err) {
            console.error('Error loading settings:', err);
            return res.status(500).send('Database error');
        }
        if (!user) return res.redirect('/login/logout');
        if (!/^#[0-9a-fA-F]{6}$/.test(user.username_color || '')) user.username_color = '#FFFFFF';
        res.render('pages/settings', {
            user,
            currentBackground: user.background_image,
            isAdmin: isAdmin(user),
            isImpersonating: Boolean(req.session.adminImpersonatorId),
            usernameChanged: req.query.usernameChanged === '1',
            appearanceSaved: req.query.appearanceSaved === '1',
            loggedIn: true
        });
        }
    );
});

router.post('/username', requireSignIn, async (req, res) => {
    if (req.session.adminImpersonatorId) {
        return res.status(403).send('Return to the admin account before changing a username');
    }

    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return res.status(400).send('Usernames must be 3–20 characters and use only letters, numbers, and underscores');
    }

    try {
        const result = await changeUsername(req.session.userId, username);
        if (result.status !== 200) return res.status(result.status).send(result.message);

        res.cookie('username', username, { httpOnly: true });
        res.redirect('/settings?usernameChanged=1');
    } catch (error) {
        console.error('Username change failed:', error);
        res.status(500).send('Unable to change username');
    }
});

router.post('/profile-appearance', requireSignIn, async (req, res) => {
    const usernameColor = typeof req.body.usernameColor === 'string' ? req.body.usernameColor : '';
    const usernameEffect = typeof req.body.usernameEffect === 'string' ? req.body.usernameEffect : '';
    const usernameSize = typeof req.body.usernameSize === 'string' ? req.body.usernameSize : '';
    const usernameWeight = typeof req.body.usernameWeight === 'string' ? req.body.usernameWeight : '';
    const profileLayout = typeof req.body.profileLayout === 'string' ? req.body.profileLayout : '';
    const usernameParticle = typeof req.body.usernameParticle === 'string' ? req.body.usernameParticle.trim() : '';
    const effectOptions = new Set(['none', 'glow', 'gradient']);
    const sizeOptions = new Set(['small', 'medium', 'large']);
    const weightOptions = new Set(['normal', 'bold']);
    const layoutOptions = new Set(['split', 'stacked', 'wide']);

    if (!/^#[0-9a-fA-F]{6}$/.test(usernameColor)
        || !effectOptions.has(usernameEffect)
        || !sizeOptions.has(usernameSize)
        || !weightOptions.has(usernameWeight)
        || !layoutOptions.has(profileLayout)
        || Array.from(usernameParticle).length > 12
        || /[\s<>\u0000-\u001f\u007f]/u.test(usernameParticle)) {
        return res.status(400).send('Invalid profile appearance settings');
    }

    try {
        const user = await getDatabaseRow('SELECT admin, role FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return res.status(404).send('User not found');

        if (isAdmin(user)) {
            await runDatabaseQuery(
                `UPDATE users
                 SET username_color = ?, username_effect = ?, username_size = ?,
                     username_weight = ?, profile_layout = ?, username_particle = ?
                 WHERE id = ?`,
                [usernameColor.toUpperCase(), usernameEffect, usernameSize, usernameWeight, profileLayout, usernameParticle, req.session.userId]
            );
        } else {
            await runDatabaseQuery(
                `UPDATE users SET username_color = ?, username_effect = ?, username_size = ?,
                 username_weight = ?, profile_layout = ? WHERE id = ?`,
                [usernameColor.toUpperCase(), usernameEffect, usernameSize, usernameWeight, profileLayout, req.session.userId]
            );
        }
        res.redirect('/settings?appearanceSaved=1');
    } catch (error) {
        console.error('Profile appearance update failed:', error);
        res.status(500).send('Unable to save profile appearance');
    }
});

router.post('/background', requireSignIn, async (req, res) => {
    const file = req.files && req.files.background;
    const data = file && !Array.isArray(file) ? file.data : null;
    if (!data || data.length === 0) return res.status(400).send('Choose an image first');
    if (data.length > 8 * 1024 * 1024) return res.status(400).send('Background images must be 8 MB or smaller');

    const extension = getImageExtension(data);
    if (!extension) return res.status(400).send('Use a PNG, JPEG, GIF, or WebP image');

    try {
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT background_image FROM users WHERE id = ?', [req.session.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!user) return res.status(404).send('User not found');

        await fs.promises.mkdir(uploadDirectory, { recursive: true });
        const filename = `${crypto.randomUUID()}${extension}`;
        const filePath = path.join(uploadDirectory, filename);
        const backgroundUrl = `/uploads/backgrounds/${filename}`;
        await fs.promises.writeFile(filePath, data, { flag: 'wx' });

        try {
            await new Promise((resolve, reject) => {
                db.run('UPDATE users SET background_image = ? WHERE id = ?', [backgroundUrl, req.session.userId], function (err) {
                    if (err) reject(err);
                    else if (this.changes === 0) reject(new Error('User not found'));
                    else resolve();
                });
            });
        } catch (error) {
            await fs.promises.unlink(filePath).catch(() => {});
            throw error;
        }

        req.session.userBackground = backgroundUrl;
        removePreviousBackground(user.background_image);
        req.session.save((err) => {
            if (err) {
                console.error('Error saving background session:', err);
                return res.status(500).send('Background saved, but session update failed. Sign in again.');
            }
            res.redirect('/settings');
        });
    } catch (error) {
        console.error('Background upload failed:', error);
        res.status(500).send('Unable to save background');
    }
});

router.post('/background/reset', requireSignIn, (req, res) => {
    db.get('SELECT background_image FROM users WHERE id = ?', [req.session.userId], (readError, user) => {
        if (readError) {
            console.error('Error loading background preference:', readError);
            return res.status(500).send('Database error');
        }
        if (!user) return res.status(404).send('User not found');

        db.run('UPDATE users SET background_image = NULL WHERE id = ?', [req.session.userId], function (updateError) {
            if (updateError) {
                console.error('Error resetting background:', updateError);
                return res.status(500).send('Database error');
            }

            req.session.userBackground = null;
            removePreviousBackground(user.background_image);
            req.session.save((sessionError) => {
                if (sessionError) {
                    console.error('Error saving reset background session:', sessionError);
                    return res.status(500).send('Background reset, but session update failed. Sign in again.');
                }
                res.redirect('/settings');
            });
        });
    });
});

module.exports = router;
