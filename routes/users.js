const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);
const logoText = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'Media', 'logo.txt'), 'utf8');

// Users route with login check and user info
router.get('/', (req, res) => {
    const loggedIn = req.cookies.LoggedIn === 'true';
    const username = req.cookies.username;
    const sql = `
        SELECT users.id, users.username, users.created_at,
            COALESCE(users.role, 'Member') AS role,
            COUNT(pastes.id) AS paste_count
        FROM users
        LEFT JOIN pastes ON users.username = pastes.user_name
        GROUP BY users.id
        ORDER BY users.role, users.username COLLATE NOCASE
    `;

    const renderUsers = (user) => {
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).send('Database error');
            }
            res.render('pages/users', { users: rows, loggedIn, user, logoText });
        });
    };

    if (!loggedIn || !username) {
        return renderUsers(null);
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Error fetching current user:', err);
            return res.status(500).send('Database error');
        }
        renderUsers(user || null);
    });
});

module.exports = router;
