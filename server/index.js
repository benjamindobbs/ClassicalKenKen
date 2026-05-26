const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/kenken',  require('./routes/kenken'));
app.use('/api/sat',     require('./routes/sat'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));

app.use(express.static(path.join(__dirname, '..')));

app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
