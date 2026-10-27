const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const fileUpload = require('express-fileupload');
const sqlite3 = require('sqlite3').verbose();
const SQLiteSessionStore = require('./session-store');
const app = express();
const dbPath = path.resolve(__dirname, 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const PORT = process.env.PORT || 4000;
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
        process.exit(1);
    }
    console.log('Connected to the BreachBin database at', dbPath);
    setupDatabase()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Server running on port ${PORT}`);
            });
        })
        .catch((error) => {
            console.error('Database setup failed:', error.message);
            process.exit(1);
        });
});

// Set view engine to ejs
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: false, limit: '100mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use(fileUpload({ limits: { fileSize: 16 * 1024 * 1024 }, abortOnLimit: true }));
function getSessionSecret() {
if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production');
}
const secretPath = path.join(path.dirname(dbPath), 'session-secret');
try {
    return fs.readFileSync(secretPath, 'utf8').trim();
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        fs.writeFileSync(secretPath, secret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return secret;
    } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
        return fs.readFileSync(secretPath, 'utf8').trim();
    }
}
}

const sessionSecret = getSessionSecret();
app.use(session({
secret: sessionSecret,
store: new SQLiteSessionStore(db),
resave: false,
saveUninitialized: false,
cookie: { secure: false } // Use 'secure: true' if using HTTPS
}));
app.use((req, res, next) => {
    res.locals.userBackground = req.session && req.session.userBackground || null;
    res.locals.adminImpersonating = Boolean(req.session && req.session.adminImpersonatorId);
    next();
});
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Middleware for Passport.js
app.use(passport.initialize());
app.use(passport.session());


// Serialize and deserialize user
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

function runDatabaseQuery(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => err ? reject(err) : resolve());
    });
}

function getDatabaseRows(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => err ? reject(err) : resolve(rows));
    });
}

async function setupDatabase() {
    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
    )`);
    await runDatabaseQuery('CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at)');

    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS pastes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            pinned BOOLEAN NOT NULL DEFAULT 0,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            text_color TEXT NOT NULL DEFAULT '#FFFFFF',
            content_size INTEGER NOT NULL, 
            created_at TEXT NOT NULL
        )`);
    console.log('Pastes table created or already exists.');

    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            admin BOOLEAN NOT NULL DEFAULT 0,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            created_at TEXT NOT NULL,
            role TEXT,
            custom_rules TEXT NOT NULL DEFAULT '',
            profile_picture TEXT,
            banner TEXT,
            profile_music TEXT,
            background_image TEXT
        )`);
    const userColumns = await getDatabaseRows('PRAGMA table_info(users)');
    const existingColumns = new Set(userColumns.map((column) => column.name));
    const newColumns = [
        ['role', 'TEXT'],
        ['custom_rules', "TEXT NOT NULL DEFAULT ''"],
        ['profile_picture', 'TEXT'],
        ['banner', 'TEXT'],
        ['profile_music', 'TEXT'],
        ['background_image', 'TEXT']
    ];

    for (const [columnName, columnDefinition] of newColumns) {
        if (!existingColumns.has(columnName)) {
            await runDatabaseQuery(`ALTER TABLE users ADD COLUMN ${columnName} ${columnDefinition}`);
        }
    }

    await runDatabaseQuery("UPDATE users SET admin = 1, role = COALESCE(NULLIF(role, ''), 'Admin') WHERE id = (SELECT MIN(id) FROM users)");
    await runDatabaseQuery("UPDATE users SET role = 'Member' WHERE role IS NULL OR role = ''");
    console.log('Users table created or already exists.');

    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paste_id INTEGER NOT NULL,
            ip TEXT NOT NULL,
            user_agent TEXT NOT NULL,
            viewed_at TEXT NOT NULL,
            FOREIGN KEY(paste_id) REFERENCES pastes(id)
        )`);
    console.log('Views table created or already exists.');

    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paste_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            comment TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(paste_id) REFERENCES pastes(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
    await runDatabaseQuery(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    await runDatabaseQuery('CREATE INDEX IF NOT EXISTS chat_messages_id ON chat_messages(id)');
    console.log('Comments table created or already exists.');
}

// Routes
app.use('/api/cli', require('./routes/cli-api')(db));
app.use('/', require('./routes/homepage'));
app.use('/newpaste', require('./routes/newpaste'));
app.use('/users', require('./routes/users'));
app.use('/upgrades', require('./routes/upgrades'));
app.use('/buy', require('./routes/upgrades'));
app.use('/upgrade', (req, res) => res.redirect(301, '/upgrades'));
const infoRoutes = require('./routes/info');
['/faq', '/faq.php', '/prices', '/prices.php', '/donate', '/donate.php', '/contact', '/contact.php', '/terms', '/changelog'].forEach((route) => {
    app.use(route, infoRoutes);
});
app.use('/search', require('./routes/search'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/paste', require('./routes/viewpaste'));
app.use('/login', require('./routes/login'));
app.use('/signup', require('./routes/signup'));
app.use('/profile', require('./routes/profile'));
app.use('/settings', require('./routes/settings'));
app.use('/hoa', require('./routes/hoa'));
app.use('/admin', require('./routes/admin'));
