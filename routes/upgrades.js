const express = require('express');
const router = express.Router();

// Upgrades route
router.get('/', (req, res) => {
    res.render('pages/upgrades', {
        loggedIn: Boolean(req.session && req.session.userId),
        userId: req.session && req.session.userId
    });
});

module.exports = router;
