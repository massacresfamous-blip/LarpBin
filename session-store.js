const session = require('express-session');

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000;

class SQLiteSessionStore extends session.Store {
    constructor(database) {
        super();
        this.database = database;
        this.cleanupTimer = setInterval(() => {
            this.database.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()], (error) => {
                if (error) console.error('Session cleanup failed:', error);
            });
        }, 60 * 60 * 1000);
        this.cleanupTimer.unref();
    }

    get(sessionId, callback) {
        this.database.get(
            'SELECT data, expires_at FROM sessions WHERE sid = ?',
            [sessionId],
            (error, row) => {
                if (error) return callback(error);
                if (!row) return callback(null, null);
                if (row.expires_at <= Date.now()) {
                    return this.destroy(sessionId, (deleteError) => callback(deleteError, null));
                }

                try {
                    callback(null, JSON.parse(row.data));
                } catch (parseError) {
                    callback(parseError);
                }
            }
        );
    }

    set(sessionId, sessionData, callback = () => {}) {
        let serialized;
        try {
            serialized = JSON.stringify(sessionData);
        } catch (error) {
            return callback(error);
        }

        const cookieExpires = sessionData.cookie && sessionData.cookie.expires;
        const cookieMaxAge = sessionData.cookie && Number(sessionData.cookie.maxAge);
        const expiresAt = cookieExpires
            ? new Date(cookieExpires).getTime()
            : Date.now() + (Number.isFinite(cookieMaxAge) && cookieMaxAge > 0 ? cookieMaxAge : DEFAULT_TTL);

        this.database.run(
            `INSERT INTO sessions (sid, expires_at, data)
             VALUES (?, ?, ?)
             ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data`,
            [sessionId, expiresAt, serialized],
            callback
        );
    }

    touch(sessionId, sessionData, callback = () => {}) {
        const cookieExpires = sessionData.cookie && sessionData.cookie.expires;
        const cookieMaxAge = sessionData.cookie && Number(sessionData.cookie.maxAge);
        const expiresAt = cookieExpires
            ? new Date(cookieExpires).getTime()
            : Date.now() + (Number.isFinite(cookieMaxAge) && cookieMaxAge > 0 ? cookieMaxAge : DEFAULT_TTL);

        this.database.run(
            'UPDATE sessions SET expires_at = ? WHERE sid = ?',
            [expiresAt, sessionId],
            callback
        );
    }

    destroy(sessionId, callback = () => {}) {
        this.database.run('DELETE FROM sessions WHERE sid = ?', [sessionId], callback);
    }
}

module.exports = SQLiteSessionStore;
