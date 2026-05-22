const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// API routes
app.use('/api/kenken', require('./routes/kenken'));
app.use('/api/sat', require('./routes/sat'));

// Serve all static files from repo root
app.use(express.static(path.join(__dirname, '..')));

// Fallback to index.html for any unmatched path
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
