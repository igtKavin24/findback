require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  res.json({ status: 'ok', app: 'FindBack', tables: tables.map(t => t.name) });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/requests', require('./routes/requests'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FindBack running at http://localhost:${PORT}`));