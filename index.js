const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3000;

const upload = multer({ dest: 'uploads/' });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/latest', (req, res) => {
    const downloadsPath = path.join(__dirname, 'downloads');
    const files = fs.readdirSync(downloadsPath)
        .filter(name => name.startsWith('ActionNStuff') && name.endsWith('.mcpack'));

    if (files.length === 0) {
        return res.status(500).json({ error: 'No release found' });
    }

    const latestFile = files
        .map(file => ({
            name: file,
            time: fs.statSync(path.join(downloadsPath, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time)[0];

    const versionMatch = latestFile.name.match(/v(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'Unknown';
    const updateDate = new Date(latestFile.time).toLocaleString();

    let changelog = '';
    const changelogPath = path.join(downloadsPath, 'update.txt');
    if (fs.existsSync(changelogPath)) {
        changelog = fs.readFileSync(changelogPath, 'utf8');
    }

    res.json({
        version,
        updateDate,
        changelog,
        downloadUrl: `/downloads/${latestFile.name}`
    });
});

app.get('/downloads/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'downloads', req.params.filename);
    res.download(filePath);
});

app.post('/admin/upload', upload.single('file'), (req, res) => {
    const version = req.body.version;
    const notes = req.body.notes;
    const originalPath = req.file.path;
    const ext = path.extname(req.file.originalname);

    if (ext !== '.mcpack') {
        fs.unlinkSync(originalPath);
        return res.status(400).send('Invalid file type.');
    }

    const downloadsPath = path.join(__dirname, 'downloads');

    // Delete old mcpack files
    fs.readdirSync(downloadsPath).forEach(file => {
        if (file.startsWith('ActionNStuff-v') && file.endsWith('.mcpack')) {
            fs.unlinkSync(path.join(downloadsPath, file));
        }
    });

    const newFilename = `ActionNStuff-v${version}.mcpack`;
    const destPath = path.join(downloadsPath, newFilename);
    fs.renameSync(originalPath, destPath);

    fs.writeFileSync(path.join(downloadsPath, 'update.txt'), `Version: ${version}\n${notes.trim()}`);

    res.send(`✅ Uploaded and renamed to <strong>${newFilename}</strong><br>📝 Changelog saved<br>🧹 Old versions deleted`);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
