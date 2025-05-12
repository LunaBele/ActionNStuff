const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const md5 = require('md5');
const { Server } = require('ws');

const app = express();
const PORT = 3000;

// Configure multer to save uploaded files temporarily to the uploads folder
const upload = multer({ dest: 'uploads/' });

// Add JSON body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve files from the downloads folder
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Hardcode the hashed passcode (MD5 of '11200805')
const ADMIN_PASSCODE_HASH = 'd41d8cd98f00b204e9800998ecf8427e';

// Database file path
const DB_PATH = path.join(__dirname, 'storage', 'database.json');

// Ensure storage and uploads directories exist
if (!fs.existsSync(path.join(__dirname, 'storage'))) {
    fs.mkdirSync(path.join(__dirname, 'storage'), { recursive: true });
}
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}
if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
    fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
}

// Initialize database if it doesn't exist
function initDatabase() {
    if (!fs.existsSync(DB_PATH)) {
        const initialData = {
            views: 0,
            downloads: 0,
            ratings: [],
            viewedIPs: [],
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2));
        console.log('Database initialized successfully');
    }
}

// Initialize database on server start
initDatabase();

// Get database data
function getDatabase() {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        return {
            views: 0,
            downloads: 0,
            ratings: [],
            viewedIPs: [],
            lastUpdated: new Date().toISOString()
        };
    }
}

// Save database data
function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving database:', error);
        return false;
    }
}

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API endpoint to get the database
app.get('/storage/database.json', (req, res) => {
    const db = getDatabase();
    res.json(db);
});

// API endpoint to save the database
app.post('/storage/database.json', (req, res) => {
    const newData = req.body;
    const currentData = getDatabase();

    const updatedData = {
        ...currentData,
        views: newData.views || currentData.views,
        downloads: newData.downloads || currentData.downloads,
        ratings: newData.ratings || currentData.ratings,
        viewedIPs: newData.viewedIPs || currentData.viewedIPs,
        lastUpdated: new Date().toISOString()
    };

    if (saveDatabase(updatedData)) {
        res.status(200).json({ success: true, message: 'Database updated successfully' });
    } else {
        res.status(500).json({ success: false, message: 'Failed to update database' });
    }
});

// API endpoint for latest version info
app.get('/api/latest', (req, res) => {
    let changelog = '';
    let latestFile = '';
    let version = 'v1.4.0';
    const updateDate = new Date().toISOString().split('T')[0];

    try {
        const files = fs.readdirSync(path.join(__dirname, 'downloads'));
        const mcpackFiles = files.filter(file => file.endsWith('.mcpack'));
        if (mcpackFiles.length > 0) {
            latestFile = mcpackFiles.sort().reverse()[0];
            const versionMatch = latestFile.match(/v(\d+\.\d+\.\d+)/);
            if (versionMatch) {
                version = `v${versionMatch[1]}`;
            }
        }
        changelog = fs.readFileSync(path.join(__dirname, 'downloads', 'update.txt'), 'utf8');
    } catch (error) {
        console.error('Error reading update.txt or downloads folder:', error);
        changelog = 'No changelog available.';
        if (!latestFile) {
            latestFile = 'ActionNStuff-v1.4.0.mcpack';
        }
    }

    res.json({
        version: version,
        updateDate: updateDate,
        downloadUrl: `/downloads/${latestFile}`,
        changelog: changelog
    });
});

// Admin passcode validation endpoint
app.post('/admin/validate', (req, res) => {
    const { passcode } = req.body;
    if (md5(passcode) === ADMIN_PASSCODE_HASH) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect passcode!' });
    }
});

// Admin upload endpoint
app.post('/admin/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const version = req.body.version;
        const notes = req.body.notes;

        // Delete old .mcpack files
        const files = fs.readdirSync(path.join(__dirname, 'downloads'));
        files.forEach(file => {
            if (file.endsWith('.mcpack') && file !== `ActionNStuff-v${version}.mcpack`) {
                fs.unlinkSync(path.join(__dirname, 'downloads', file));
            }
        });

        // Rename the uploaded file
        const newFileName = `ActionNStuff-v${version}.mcpack`;
        const newFilePath = path.join(__dirname, 'downloads', newFileName);
        fs.renameSync(req.file.path, newFilePath);

        // Update update.txt with the new changelog notes
        const updateTxtPath = path.join(__dirname, 'downloads', 'update.txt');
        const updateContent = `Version ${version} Updates (${new Date().toISOString().split('T')[0]}):\n${notes}`;
        fs.writeFileSync(updateTxtPath, updateContent);

        // Notify connected clients of the update via SSE
        if (wss.clients) {
            wss.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'update', data: { version, updateDate: new Date().toISOString().split('T')[0], downloadUrl: `/downloads/${newFileName}`, changelog: updateContent } }));
                }
            });
        }

        res.send(`Successfully uploaded ${newFileName} and updated changelog.`);
    } catch (error) {
        console.error('Error during upload:', error);
        res.status(500).send('Upload failed due to server error.');
    }
});

// SSE endpoint
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const initialData = getLatestData();
    res.write(`data: ${JSON.stringify({ type: 'init', data: initialData })}\n\n`);

    const clientId = Date.now();
    const clients = new Map();
    clients.set(clientId, res);

    req.on('close', () => {
        clients.delete(clientId);
    });

    wss.on('message', (msg) => {
        if (clients.has(clientId)) {
            clients.get(clientId).write(`data: ${msg}\n\n`);
        }
    });
});

function getLatestData() {
    let changelog = '';
    let latestFile = '';
    let version = 'v1.4.0';
    const updateDate = new Date().toISOString().split('T')[0];

    try {
        const files = fs.readdirSync(path.join(__dirname, 'downloads'));
        const mcpackFiles = files.filter(file => file.endsWith('.mcpack'));
        if (mcpackFiles.length > 0) {
            latestFile = mcpackFiles.sort().reverse()[0];
            const versionMatch = latestFile.match(/v(\d+\.\d+\.\d+)/);
            if (versionMatch) {
                version = `v${versionMatch[1]}`;
            }
        }
        changelog = fs.readFileSync(path.join(__dirname, 'downloads', 'update.txt'), 'utf8');
    } catch (error) {
        console.error('Error reading update.txt or downloads folder:', error);
        changelog = 'No changelog available.';
        if (!latestFile) {
            latestFile = 'ActionNStuff-v1.4.0.mcpack';
        }
    }

    return {
        version: version,
        updateDate: updateDate,
        downloadUrl: `/downloads/${latestFile}`,
        changelog: changelog
    };
}

// Set up WebSocket/SSE server
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
const wss = new Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected to SSE');
    ws.send(JSON.stringify({ type: 'init', data: { message: 'Connected to real-time updates' } }));
});