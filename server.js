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

const upload = multer({ storage: storage });

// Middleware to serve static files
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: false }));

// Add session middleware
app.use(session({
    secret: 'your_secret_key', // Secret key for the session
    resave: false,
    saveUninitialized: true
}));

// Define admin credentials
const ADMIN_USERNAME = 'revoholics';
const ADMIN_PASSWORD = '091lebanon091?'; // Change to a stronger password in production

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

    // Check if the user has already watched any clips, store in session
    if (!req.session.watchedClips) {
        req.session.watchedClips = []; // Initialize the watched clips list in the session if not already present
    }

    // Read the uploaded videos from videos.json
    fs.readFile(videoListPath, (err, data) => {
        if (err) {
            console.error("Error reading video list:", err);
            return res.status(500).send('Unable to read video list.');
        }

        const videos = data ? JSON.parse(data) : [];

        // Filter out videos that the user has already watched
        const watchList = videos.filter(clip => !req.session.watchedClips.includes(clip.filename));
        const watchedList = videos.filter(clip => req.session.watchedClips.includes(clip.filename));

        // Send the videos data to the Watch page dynamically
        res.render('watch', { videos: watchList, watchedList: watchedList, isAdmin: req.session && req.session.isAdmin });
    });
});

// Route to handle when a user watches a clip
app.post('/watch/:filename', (req, res) => {
    const { filename } = req.params;

    // If user has already watched it, skip
    if (req.session.watchedClips && req.session.watchedClips.includes(filename)) {
        return res.redirect('/watch');
    }

    // Add the watched clip to the user's session
    if (!req.session.watchedClips) {
        req.session.watchedClips = [];
    }
    req.session.watchedClips.push(filename);

    // Redirect back to the watch page after marking as watched
    res.redirect('/watch');
});

app.get('/admin', (req, res) => {
    // Send login page for admin
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/upload', (req, res) => {
    res.sendFile(__dirname + '/views/upload.html');
});

app.post('/admin-login', express.json(), (req, res) => { // Use express.json() to parse the body
    const { username, password } = req.body;

    // Log the received username and password for debugging
    console.log("Received credentials:", { username, password });

    // Check if the provided username and password match the admin credentials
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true; // Set session variable for admin
        console.log("Login successful! Session set.");
        return res.json({ success: true, message: 'Login successful! Redirecting to dashboard...' }); // Return success message
    } else {
        console.log("Login failed. Invalid username or password.");
        return res.json({ success: false, message: 'Invalid username or password. Please try again.' });
    }
});

// Admin dashboard route
app.get('/admin-dashboard', isAdmin, (req, res) => {
    res.send('<h1>Welcome to the Admin Dashboard</h1><p>You can now manage the content.</p>');
});

// Handle video uploads
app.post('/upload', upload.single('clip'), (req, res) => { // 'clip' matches the form field name
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const title = req.body.clipTitle; // 'clipTitle' matches the form field name
    const filename = req.file.filename;
    const name = req.body.Name; // Capture the 'Name' field

    // Generate a hash for the uploaded file to check for duplicates
    const fileBuffer = fs.readFileSync(path.join(__dirname, 'public', 'uploads', filename));
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const videoListPath = path.join(__dirname, 'videos.json');
    
    // Check for duplicates
    fs.readFile(videoListPath, (err, data) => {
        if (err) {
            return res.status(500).send('Error reading video list.');
        }

        const videos = data ? JSON.parse(data) : [];

        // Check if the same file already exists based on its hash
        const duplicate = videos.find(video => video.hash === fileHash);
        if (duplicate) {
            // Remove the uploaded file from the uploads folder
            fs.unlink(path.join(__dirname, 'public', 'uploads', filename), (unlinkErr) => {
                if (unlinkErr) {
                    return res.status(500).send('Error deleting the uploaded duplicate file.');
                }
                return res.status(400).send('Duplicate video detected. You cannot upload the same video again.');
            });
        } else {
            // Save video data (title, filename, Name, and file hash) in a JSON file
            const videoData = { title, filename, Name: name, hash: fileHash }; // Include the file hash
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

// Delete video route (only accessible by admin)
app.post('/delete/:filename', isAdmin, (req, res) => {
    const videoListPath = path.join(__dirname, 'videos.json');
    const filePath = path.join(__dirname, 'public', 'uploads', req.params.filename);

    // Remove video from the JSON file
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

            // Delete the actual video file
            fs.unlink(filePath, (err) => {
                if (err) {
                    return res.status(500).send('Error deleting the video file.');
                }

                res.redirect('/watch'); // Redirect to the watch page after deletion
            });
        });
    });
});

// Revoholic Page Route
app.get('/revoholic', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'revoholic.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
