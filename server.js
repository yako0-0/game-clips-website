require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const session = require('express-session');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// Set view engine to EJS
app.set('view engine', 'ejs');

// Set up Multer storage engine
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './public/uploads'); // Store files in the /uploads folder
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext); // Filename will be the current timestamp plus the file extension
    }
});

// Set up Multer with file size limit (50MB) and file filter for video types
const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // Limit file size to 50MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|mov|avi|mkv/; // Accept only video files
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = allowedTypes.test(file.mimetype);
        
        if (extname && mimeType) {
            return cb(null, true);
        } else {
            return cb(new Error('Only video files are allowed!'), false);
        }
    }
}).single('clip');

// Middleware to serve static files
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: false }));

// Add session middleware
app.use(session({
    secret: process.env.SESSION_SECRET, // Secret key for the session (from .env)
    resave: false,
    saveUninitialized: true
}));

// Admin authentication middleware
function isAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin'); // Redirect to login if not an admin
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

app.get('/watch', (req, res) => {
    const videoListPath = path.join(__dirname, 'videos.json');

    if (!req.session.watchedClips) {
        req.session.watchedClips = []; // Initialize the watched clips list in the session if not already present
    }

    fs.readFile(videoListPath, (err, data) => {
        if (err) {
            console.error("Error reading video list:", err);
            return res.status(500).send('Unable to read video list.');
        }

        const videos = data ? JSON.parse(data) : [];
        const watchList = videos.filter(clip => !req.session.watchedClips.includes(clip.filename));
        const watchedList = videos.filter(clip => req.session.watchedClips.includes(clip.filename));

        res.render('watch', { videos: watchList, watchedList: watchedList, isAdmin: req.session && req.session.isAdmin });
    });
});

app.post('/watch/:filename', (req, res) => {
    const { filename } = req.params;

    if (req.session.watchedClips && req.session.watchedClips.includes(filename)) {
        return res.redirect('/watch');
    }

    if (!req.session.watchedClips) {
        req.session.watchedClips = [];
    }
    req.session.watchedClips.push(filename);

    res.redirect('/watch');
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/upload', (req, res) => {
    res.sendFile(__dirname + '/views/upload.html');
});

app.post('/admin-login', express.json(), (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        return res.json({ success: true, message: 'Login successful! Redirecting to dashboard...' });
    } else {
        return res.json({ success: false, message: 'Invalid username or password. Please try again.' });
    }
});

app.get('/admin-dashboard', isAdmin, (req, res) => {
    res.send('<h1>Welcome to the Admin Dashboard</h1><p>You can now manage the content.</p>');
});

// Handle video uploads
app.post('/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('Error: File too large. Maximum allowed size is 50MB.');
            }
            return res.status(400).send('Error uploading file: ' + err.message);
        }

        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const title = req.body.clipTitle;
        const filename = req.file.filename;
        const name = req.body.Name;

        const fileBuffer = fs.readFileSync(path.join(__dirname, 'public', 'uploads', filename));
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const videoListPath = path.join(__dirname, 'videos.json');
        
        fs.readFile(videoListPath, (err, data) => {
            if (err) {
                return res.status(500).send('Error reading video list.');
            }

            const videos = data ? JSON.parse(data) : [];

            const duplicate = videos.find(video => video.hash === fileHash);
            if (duplicate) {
                fs.unlink(path.join(__dirname, 'public', 'uploads', filename), (unlinkErr) => {
                    if (unlinkErr) {
                        return res.status(500).send('Error deleting the uploaded duplicate file.');
                    }
                    return res.status(400).send('Duplicate video detected. You cannot upload the same video again.');
                });
            } else {
                const videoData = { title, filename, Name: name, hash: fileHash };
                videos.push(videoData);

                fs.writeFile(videoListPath, JSON.stringify(videos, null, 2), (err) => {
                    if (err) {
                        return res.status(500).send('Error saving video data.');
                    }

                    const clipPath = `/uploads/${filename}`;
                    res.send(`<h2>Upload Successful!</h2><p>Clip: <a href="${clipPath}" target="_blank">${title}</a></p><a href="/upload">Upload Another</a>`);
                });
            }
        });
    });
});

app.post('/delete/:filename', isAdmin, (req, res) => {
    const videoListPath = path.join(__dirname, 'videos.json');
    const filePath = path.join(__dirname, 'public', 'uploads', req.params.filename);

    fs.readFile(videoListPath, (err, data) => {
        if (err) {
            return res.status(500).send('Error reading video list.');
        }

        const videos = JSON.parse(data);
        const updatedVideos = videos.filter(video => video.filename !== req.params.filename);

        fs.writeFile(videoListPath, JSON.stringify(updatedVideos, null, 2), (err) => {
            if (err) {
                return res.status(500).send('Error saving video list after deletion.');
            }

            fs.unlink(filePath, (err) => {
                if (err) {
                    return res.status(500).send('Error deleting the video file.');
                }

                res.redirect('/watch');
            });
        });
    });
});

app.get('/revoholic', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'revoholic.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
