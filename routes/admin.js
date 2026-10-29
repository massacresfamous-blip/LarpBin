const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);
const userRoles = new Set(['Criminal', 'Council', 'Moderator', 'Demon', 'Admin', 'Member']);

// Middleware to check admin status
function isAdmin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(403).send('Access denied');
    }
    if (req.session.adminImpersonatorId) {
        return res.status(403).send('Return to the admin account to access admin tools');
    }

    db.get('SELECT id, username, admin, role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            console.error('Error checking admin access:', err);
            return res.status(500).send('Database error');
        }
        if (!user || (user.admin !== 1 && user.role !== 'Admin')) {
            return res.status(403).send('Access denied');
        }
        req.adminUser = user;
        next();
    });
}

// Admin Panel Page
router.get('/', isAdmin, (req, res) => {
    res.render('pages/admin', {
        username: req.adminUser.username,
        userId: req.adminUser.id
    });
});

router.get('/accounts', isAdmin, (req, res) => {
    const search = String(req.query.search || '').trim();
    db.all(
        `SELECT id, username, COALESCE(role, 'Member') AS role
         FROM users WHERE username LIKE ? ORDER BY username COLLATE NOCASE LIMIT 25`,
        [`%${search}%`],
        (err, accounts) => {
            if (err) {
                console.error('Database error loading accounts:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json(accounts);
        }
    );
});

router.post('/switch-account', isAdmin, (req, res) => {
    const accountId = Number(req.body.accountId);
    if (!Number.isInteger(accountId) || accountId < 1) {
        return res.status(400).send('Valid account ID required');
    }

    db.get('SELECT id, username, admin, role, background_image FROM users WHERE id = ?', [accountId], (err, account) => {
        if (err) {
            console.error('Database error loading account:', err);
            return res.status(500).send('Database error');
        }
        if (!account) return res.status(404).send('Account not found');

        const adminId = req.adminUser.id;
        req.session.regenerate((sessionError) => {
            if (sessionError) {
                console.error('Session regeneration error:', sessionError);
                return res.status(500).send('Unable to switch accounts');
            }

            req.session.userId = account.id;
            req.session.userBackground = account.background_image || null;
            req.session.adminImpersonatorId = adminId;
            req.session.save((saveError) => {
                if (saveError) {
                    console.error('Session save error:', saveError);
                    return res.status(500).send('Unable to save account switch');
                }
                res.cookie('LoggedIn', true, { httpOnly: true });
                res.cookie('username', account.username, { httpOnly: true });
                res.cookie('user_id', account.id, { httpOnly: true });
                res.cookie('Admin', account.admin === 1 || account.role === 'Admin', { httpOnly: true });
                res.redirect('/');
            });
        });
    });
});

router.post('/return-to-admin', (req, res) => {
    const adminId = Number(req.session && req.session.adminImpersonatorId);
    if (!Number.isInteger(adminId) || adminId < 1) {
        return res.status(403).send('No admin account to return to');
    }

    db.get('SELECT id, username, background_image FROM users WHERE id = ? AND (admin = 1 OR role = ?)', [adminId, 'Admin'], (err, admin) => {
        if (err) {
            console.error('Database error validating admin account:', err);
            return res.status(500).send('Database error');
        }
        if (!admin) {
            req.session.destroy(() => res.status(403).send('Admin account is no longer available'));
            return;
        }

        req.session.userId = admin.id;
        req.session.userBackground = admin.background_image || null;
        delete req.session.adminImpersonatorId;
        req.session.save((saveError) => {
            if (saveError) {
                console.error('Session save error:', saveError);
                return res.status(500).send('Unable to restore admin account');
            }
            res.cookie('LoggedIn', true, { httpOnly: true });
            res.cookie('username', admin.username, { httpOnly: true });
            res.cookie('user_id', admin.id, { httpOnly: true });
            res.cookie('Admin', true, { httpOnly: true });
            res.redirect('/admin');
        });
    });
});

// API for paginated pastes
router.get('/pastes', isAdmin, (req, res) => {
    const limit = 10;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search ? `%${req.query.search}%` : '%';

    db.all(
        `SELECT * FROM pastes WHERE title LIKE ? 
         ORDER BY pinned DESC, created_at DESC LIMIT ? OFFSET ?`,
        [search, limit, offset],
        (err, pastes) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json(pastes);
        }
    );
});

// API for loading users
router.get('/users', isAdmin, (req, res) => {
    const search = req.query.search ? `%${req.query.search}%` : '%';

    db.all(
        `SELECT id, username, email, COALESCE(role, 'Member') AS role, custom_rules
         FROM users WHERE username LIKE ? ORDER BY id DESC`,
        [search],
        (err, users) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json(users);
        }
    );
});

router.post('/update-user-rules', isAdmin, (req, res) => {
    const userId = Number(req.body.userId);
    const role = String(req.body.role || '').trim();
    const customRules = String(req.body.customRules || '').trim();

    if (!Number.isInteger(userId) || userId < 1 || !userRoles.has(role) || customRules.length > 1000) {
        return res.status(400).json({ error: 'Invalid role or custom rules' });
    }

    db.run(
        'UPDATE users SET role = ?, custom_rules = ? WHERE id = ?',
        [role || null, customRules, userId],
        function (err) {
            if (err) {
                console.error('Error updating user rules:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json({ success: true });
        }
    );
});

// API for loading comments
router.get('/comments', isAdmin, (req, res) => {
    const search = req.query.search ? `%${req.query.search}%` : '%';

    db.all(
        `SELECT comments.id, comments.paste_id, users.username, comments.comment, comments.created_at
         FROM comments
         JOIN users ON comments.user_id = users.id
         WHERE comments.comment LIKE ?
         ORDER BY comments.created_at DESC`,
        [search],
        (err, comments) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json(comments);
        }
    );
});


// Delete a paste
router.post('/delete', isAdmin, (req, res) => {
    const pasteId = req.body.pasteId;

    if (!pasteId) return res.status(400).send('Paste ID required');

    db.run('DELETE FROM pastes WHERE id = ?', [pasteId], (err) => {
        if (err) {
            console.error('Error deleting paste:', err);
            return res.status(500).send('Database error');
        }
        res.sendStatus(200);
    });
});

router.post('/toggle-pin', isAdmin, (req, res) => {
    const { pasteId, pinned } = req.body;

    if (!pasteId) return res.status(400).send('Paste ID required');

    db.run('UPDATE pastes SET pinned = ? WHERE id = ?', [pinned, pasteId], (err) => {
        if (err) {
            console.error('Error updating pinned status:', err);
            return res.status(500).send('Database error');
        }
        res.sendStatus(200);
    });
});

// Download Database
router.get('/download-db', isAdmin, (req, res) => {
    const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
    
    res.download(dbPath, 'breachbin.db', (err) => {
        if (err) {
            console.error('Error downloading database:', err);
            res.status(500).send('Error downloading database');
        }
    });
});

// Delete a comment
router.post('/delete-comment', isAdmin, (req, res) => {
    const commentId = req.body.commentId;

    if (!commentId) return res.status(400).send('Comment ID required');

    db.run('DELETE FROM comments WHERE id = ?', [commentId], (err) => {
        if (err) {
            console.error('Error deleting comment:', err);
            return res.status(500).send('Database error');
        }
        res.sendStatus(200);
    });
});

// Delete a user and their associated data
router.post('/delete-user', isAdmin, (req, res) => {
    const userId = Number(req.body.userId);

    if (!Number.isInteger(userId) || userId < 1) return res.status(400).send('Valid user ID required');

    db.run('DELETE FROM users WHERE id = ? AND id != (SELECT MIN(id) FROM users)', [userId], function (err) {
        if (err) {
            console.error('Error deleting user:', err);
            return res.status(500).send('Database error');
        }
        if (this.changes === 0) {
            return res.status(400).send('The first account cannot be deleted');
        }
        res.sendStatus(200);
    });
});

// Upload Database
router.post('/upload-db', isAdmin, (req, res) => {
    if (!req.files || !req.files.database) {
        return res.status(400).send('No file uploaded');
    }

    const dbFile = req.files.database;
    const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');

    dbFile.mv(dbPath, (err) => {
        if (err) {
            console.error('Error uploading database:', err);
            return res.status(500).send('Error uploading database');
        }

        res.send('Database uploaded successfully');
    });
});

module.exports = router;
