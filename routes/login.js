const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

// Login route with login check
router.get('/', (req, res) => {
    const loggedIn = Boolean(req.session && req.session.userId);
    
    if (loggedIn) {
        db.get('SELECT id FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error("Database error:", err);
                return res.status(500).send("Database error");
            }

            if (!user) {
                req.session.destroy(() => {});
                ['LoggedIn', 'username', 'Admin', 'user_id'].forEach((cookieName) => res.clearCookie(cookieName));
                return res.redirect('/login');
            }

            return res.redirect('/');
        });
    } else {
        ['LoggedIn', 'username', 'Admin', 'user_id'].forEach((cookieName) => res.clearCookie(cookieName));
        res.render('pages/login');
    }
});

// Logout route
router.get('/logout', (req, res) => {
    res.clearCookie('LoggedIn');
    res.clearCookie('username');
    res.clearCookie('Admin');
    res.clearCookie('connect.sid');
    res.clearCookie('user_id');
    req.session.destroy(() => res.redirect('/'));
});

// Login authentication
router.post('/', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).send("Error accessing the database");
        }

        if (!user) {
            return res.status(400).send("Invalid username or password");
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.regenerate((sessionError) => {
                if (sessionError) {
                    console.error('Session creation error:', sessionError);
                    return res.status(500).send('Unable to start a session');
                }

                req.session.userId = user.id;
                req.session.userBackground = user.background_image || null;
                req.session.save((saveError) => {
                    if (saveError) {
                        console.error('Session save error:', saveError);
                        return res.status(500).send('Unable to save session');
                    }

                    res.cookie('LoggedIn', true, { httpOnly: true });
                    res.cookie('username', username, { httpOnly: true });
                    res.cookie('user_id', user.id, { httpOnly: true });
                    res.cookie('Admin', user.admin === 1, { httpOnly: true });
                    res.redirect('/');
                });
            });
        } else {
            res.status(400).send("Invalid username or password");
        }
    });
});

module.exports = router;
