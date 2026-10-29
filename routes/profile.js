const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', 'database', 'breachbin.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);

function getImageExtension(data) {
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
    if (data.length >= 6 && /^GIF8[79]a$/.test(data.toString('ascii', 0, 6))) return '.gif';
    if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    return null;
}

function isAnimatedImage(data, extension) {
    if (extension === '.gif') return true;
    if (extension === '.png') return data.includes(Buffer.from('acTL'));
    if (extension === '.webp') {
        return data.includes(Buffer.from('ANIM')) || data.includes(Buffer.from('ANMF'));
    }
    return false;
}

function getAudioExtension(data) {
    if (data.length >= 3 && data.toString('ascii', 0, 3) === 'ID3') return '.mp3';
    if (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return '.mp3';
    if (data.length >= 4 && data.toString('ascii', 0, 4) === 'OggS') return '.ogg';
    if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return '.wav';
    if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp' && data.toString('ascii', 8, 12).startsWith('M4A')) return '.m4a';
    return null;
}

function removeUploadedImage(imageUrl, folder) {
    const prefix = `/uploads/${folder}/`;
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith(prefix)) return;
    fs.unlink(path.resolve(__dirname, '..', 'public', 'uploads', folder, path.basename(imageUrl)), () => {});
}

function hasProfileMusicAccess(user) {
    return Number(user.admin) === 1 || String(user.role || 'Member').trim().toLowerCase() !== 'member';
}

router.post('/:userId/customize', async (req, res) => {
    const userId = Number(req.params.userId);
    if (!req.session || Number(req.session.userId) !== userId) {
        return res.status(403).send('Access denied');
    }

    const requestedUploads = [
        ['profile_picture', 'profiles'],
        ['banner', 'banners'],
        ['profile_music', 'music']
    ].filter(([field]) => req.files && req.files[field]);

    if (requestedUploads.length === 0) {
        return res.status(400).send('Choose a profile picture or banner to upload');
    }

    let user;
    try {
        user = await new Promise((resolve, reject) => {
            db.get('SELECT admin, role, profile_picture, banner, profile_music FROM users WHERE id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    } catch (error) {
        console.error('Error loading profile for image upload:', error);
        return res.status(500).send('Database error');
    }
    if (!user) return res.status(404).send('User not found');

    const role = String(user.role || 'Member').toLowerCase();
    const canUseAnimatedImages = role !== 'member';
    const canUseProfileMusic = hasProfileMusicAccess(user);
    const validatedUploads = [];
    for (const [field, folder] of requestedUploads) {
        const file = req.files[field];
        const data = file && !Array.isArray(file) ? file.data : null;
        const isMusic = field === 'profile_music';
        const maxSize = isMusic ? 12 * 1024 * 1024 : 8 * 1024 * 1024;
        if (!data || data.length === 0 || data.length > maxSize) {
            return res.status(400).send(isMusic ? 'Audio must be smaller than 12 MB' : 'Images must be smaller than 8 MB');
        }

        if (isMusic) {
            if (!canUseProfileMusic) return res.status(403).send('Music uploads require a role other than Member');
            const extension = getAudioExtension(data);
            if (!extension) return res.status(400).send('Use an MP3, OGG, WAV, or M4A audio file');
            validatedUploads.push({ field, folder, data, extension });
            continue;
        }

        const extension = getImageExtension(data);
        if (!extension) return res.status(400).send('Use a PNG, JPEG, GIF, or WebP image');
        if (!canUseAnimatedImages && isAnimatedImage(data, extension)) return res.status(403).send('Animated images require a role other than Member');
        validatedUploads.push({ field, folder, data, extension });
    }

    const savedFiles = [];
    try {
        const imageUrls = {};
        for (const { field, folder, data, extension } of validatedUploads) {
            const uploadDirectory = path.resolve(__dirname, '..', 'public', 'uploads', folder);
            await fs.promises.mkdir(uploadDirectory, { recursive: true });
            const filename = `${crypto.randomUUID()}${extension}`;
            const filePath = path.join(uploadDirectory, filename);
            await fs.promises.writeFile(filePath, data, { flag: 'wx' });
            savedFiles.push(filePath);
            imageUrls[field] = `/uploads/${folder}/${filename}`;
        }

        const changed = await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET
                    profile_picture = COALESCE(?, profile_picture),
                    banner = COALESCE(?, banner),
                    profile_music = COALESCE(?, profile_music)
                 WHERE id = ?`,
                [imageUrls.profile_picture || null, imageUrls.banner || null, imageUrls.profile_music || null, userId],
                function (err) {
                    if (err) reject(err);
                    else resolve(this.changes);
                }
            );
        });

        if (changed === 0) {
            await Promise.all(savedFiles.map((filePath) => fs.promises.unlink(filePath).catch(() => {})));
            return res.status(404).send('User not found');
        }
        if (imageUrls.profile_picture) removeUploadedImage(user.profile_picture, 'profiles');
        if (imageUrls.banner) removeUploadedImage(user.banner, 'banners');
        if (imageUrls.profile_music) removeUploadedImage(user.profile_music, 'music');
        res.redirect(`/profile?uid=${userId}`);
    } catch (error) {
        await Promise.all(savedFiles.map((filePath) => fs.promises.unlink(filePath).catch(() => {})));
        console.error('Profile image upload failed:', error);
        res.status(500).send('Unable to save profile images');
    }
});

// Profile route
router.get('/', (req, res) => {
    const userId = req.query.uid;

    if (!userId) {
        return res.status(400).send('User ID is required');
    }

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.status(500).send('Database error');
        }

        if (!user) {
            return res.status(404).send('User not found');
        }

        db.all('SELECT * FROM pastes WHERE user_name = ? ORDER BY pinned DESC, created_at DESC', [user.username], (err, pastes) => {
            if (err) {
                console.error('Error fetching pastes:', err);
                return res.status(500).send('Database error');
            }

            db.all('SELECT * FROM comments WHERE user_id = ? ORDER BY created_at DESC', [userId], (err, comments) => {
                if (err) {
                    console.error('Error fetching comments:', err);
                    return res.status(500).send('Database error');
                }

                // Render profile page with user info, pastes, and comments
                const usernameEffects = new Set(['none', 'glow', 'gradient']);
                const usernameSizes = new Set(['small', 'medium', 'large']);
                const usernameWeights = new Set(['normal', 'bold']);
                const profileLayouts = new Set(['split', 'stacked', 'wide']);
                const usernameColor = /^#[0-9a-fA-F]{6}$/.test(user.username_color || '')
                    ? user.username_color
                    : '#FFFFFF';
                res.render('pages/profile', {
                    user: user,
                    pastes: pastes,
                    comments: comments,
                    loggedIn: Boolean(req.session && req.session.userId),
                    sessionExpired: req.cookies.LoggedIn === 'true' && !(req.session && req.session.userId),
                    isOwner: Number(req.session && req.session.userId) === Number(userId),
                    canUseAnimatedImages: String(user.role || 'Member').toLowerCase() !== 'member',
                    canUseProfileMusic: hasProfileMusicAccess(user),
                    isAdminProfile: Number(user.admin) === 1 || String(user.role || '').toLowerCase() === 'admin',
                    usernameColor,
                    usernameEffect: usernameEffects.has(user.username_effect) ? user.username_effect : 'none',
                    usernameSize: usernameSizes.has(user.username_size) ? user.username_size : 'medium',
                    usernameWeight: usernameWeights.has(user.username_weight) ? user.username_weight : 'bold',
                    profileLayout: profileLayouts.has(user.profile_layout) ? user.profile_layout : 'split'
                });
            });
        });
    });
});

module.exports = router;
