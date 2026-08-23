const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// The it.<domain> subdomain serves the IT tool bundle out of /it, so a bare
// "/" or unprefixed path there resolves against that folder instead of the
// KenKen site's root. API routes are left untouched.
app.use((req, _res, next) => {
    if (req.hostname.startsWith('it.') && !req.url.startsWith('/api/') && !req.url.startsWith('/it/')) {
        req.url = '/it' + (req.url === '/' ? '/index.html' : req.url);
    }
    next();
});

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/kenken',  require('./routes/kenken'));
app.use('/api/sat',      require('./routes/sat'));
app.use('/api/sat-math', require('./routes/sat-math'));
app.use('/api/teacher',   require('./routes/teacher'));
app.use('/api/student',   require('./routes/student'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/it',        require('./routes/it'));

app.use(express.static(path.join(__dirname, '..')));

app.get('*', (req, res) => {
    const home = req.hostname.startsWith('it.')
        ? path.join(__dirname, '..', 'it', 'index.html')
        : path.join(__dirname, '..', 'index.html');
    res.sendFile(home);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
