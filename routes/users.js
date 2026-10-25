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
    // Check if user is logged in
    const loggedIn = req.cookies.LoggedIn === 'true';
    if (!loggedIn) {
        // If not logged in, redirect to the login page
    }
    
    const username = req.cookies.username; // Assuming username is stored in the cookie
    // Retrieve user info from the database using username
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            throw err;
        }
        const sql = `
            SELECT users.id, users.username, users.created_at, COUNT(pastes.id) AS paste_count
            FROM users
            LEFT JOIN pastes ON users.username = pastes.user_name
            GROUP BY users.id
        `;
        db.all(sql, [], (err, rows) => {
            if (err) {
                throw err;
            }
            res.render('pages/users', { users: rows, loggedIn: loggedIn, user: user, logoText });
        });
    });
});

module.exports = router;
