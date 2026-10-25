const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

// Dashboard route
router.get('/', (req, res) => {
    const sql = 'SELECT * FROM pastes ORDER BY created_at DESC';
    db.all(sql, [], (err, rows) => {
        if (err) {
            throw err;
        }
        res.render('pages/dashboard', { pastes: rows });
    });
});

module.exports = router;
