const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

router.get('/', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.render('pages/hoa', { loggedIn: false, user: null });
    }

    db.get('SELECT id FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            console.error('Error loading HOA page user:', err);
            return res.status(500).send('Database error');
        }
        if (!user) return res.render('pages/hoa', { loggedIn: false, user: null });
        res.render('pages/hoa', { loggedIn: true, user });
    });
});

module.exports = router;
