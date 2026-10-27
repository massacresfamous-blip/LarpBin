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

function requireSignIn(req, res, next) {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    next();
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
    db.get('SELECT id, username, background_image FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            console.error('Error loading settings:', err);
            return res.status(500).send('Database error');
        }
        if (!user) return res.redirect('/login/logout');
        res.render('pages/settings', {
            user,
            currentBackground: user.background_image,
            loggedIn: true
        });
    });
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
