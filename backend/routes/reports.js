const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

// Photos are saved in backend/uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// Runs the upload and turns upload errors into clean JSON
function handleUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

function removeFile(file) {
  if (file) fs.unlink(file.path, () => {});
}

function formatReport(r) {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    category: r.category,
    color: r.color,
    brand: r.brand,
    location: r.location,
    date: r.date,
    done: !!r.done,
    photo_url: '/uploads/' + r.photo_path,
    created_at: r.created_at,
    user: { id: r.user_id, name: r.user_name },
  };
}

const SELECT_REPORTS = `
  SELECT r.*, u.name AS user_name
  FROM reports r JOIN users u ON u.id = r.user_id
`;

// POST /api/reports  (needs login, form-data with a "photo" file)
router.post('/', requireAuth, handleUpload, (req, res) => {
  const type = (req.body.type || '').trim();
  const name = (req.body.name || '').trim();
  const category = (req.body.category || '').trim();
  const color = (req.body.color || '').trim() || null;
  const brand = (req.body.brand || '').trim() || null;
  const location = (req.body.location || '').trim();
  const date = (req.body.date || '').trim();

  const fail = (status, error) => {
    removeFile(req.file);
    return res.status(status).json({ error });
  };

  if (!['lost', 'found'].includes(type)) return fail(400, 'Type must be lost or found');
  if (!name || !category || !location || !date) {
    return fail(400, 'Name, category, location and date are required');
  }
  if (!req.file) return fail(400, 'A photo is required');

  const info = db
    .prepare(
      `INSERT INTO reports
       (user_id, type, name, category, color, brand, location, date, photo_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, type, name, category, color, brand, location, date, req.file.filename, Date.now());

  const row = db.prepare(SELECT_REPORTS + ' WHERE r.id = ?').get(info.lastInsertRowid);
  res.status(201).json({ report: formatReport(row) });
});

// GET /api/reports?type=lost|found  (open reports, newest first)
router.get('/', (req, res) => {
  const type = req.query.type;
  let rows;
  if (type === 'lost' || type === 'found') {
    rows = db
      .prepare(SELECT_REPORTS + ' WHERE r.done = 0 AND r.type = ? ORDER BY r.created_at DESC')
      .all(type);
  } else {
    rows = db.prepare(SELECT_REPORTS + ' WHERE r.done = 0 ORDER BY r.created_at DESC').all();
  }
  res.json({ reports: rows.map(formatReport) });
});

// GET /api/reports/mine  (needs login)
router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(SELECT_REPORTS + ' WHERE r.user_id = ? ORDER BY r.created_at DESC')
    .all(req.user.id);
  res.json({ reports: rows.map(formatReport) });
});

module.exports = router;