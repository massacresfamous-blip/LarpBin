const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

// Signup route
router.get('/', (req, res) => {
    res.render('pages/signup');
});

router.post('/', async (req, res) => {
    const { username, email, password, confirmpwd } = req.body;

    if (password !== confirmpwd) {
        return res.status(400).send("Passwords do not match");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdAt = new Date().toISOString(); // Get current timestamp

    db.run(
        `INSERT INTO users (username, email, password, created_at, admin, role)
         SELECT ?, ?, ?, ?,
             CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 1 ELSE 0 END,
             CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'Admin' ELSE 'Member' END`,
        [username, email, hashedPassword, createdAt],
        function(err) {
            if (err) {
                return res.status(500).send("Error accessing the database");
            }
            res.redirect('/login');
        }
    );
});

module.exports = router;
