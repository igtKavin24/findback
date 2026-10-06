const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/auth');
 
const router = express.Router();
 
// Everything here needs a logged-in user
router.use(requireAuth);
 
// ---------- helpers ----------
 
const REQUEST_ROW = `
  SELECT q.*,
         lr.user_id AS lost_owner_id,  lu.name AS lost_owner_name,
         fr.user_id AS found_owner_id, fu.name AS found_owner_name
  FROM requests q
  JOIN reports lr ON lr.id = q.lost_id
  JOIN users   lu ON lu.id = lr.user_id
  JOIN reports fr ON fr.id = q.found_id
  JOIN users   fu ON fu.id = fr.user_id
`;
 
function getRequestRow(id) {
  return db.prepare(REQUEST_ROW + ' WHERE q.id = ?').get(id);
}
 
function isParticipant(row, userId) {
  return row.lost_owner_id === userId || row.found_owner_id === userId;
}
 
function formatMessage(m) {
  return {
    id: m.id,
    requestId: m.request_id,
    senderId: m.sender_id,
    text: m.text,
    edited: !!m.edited,
    read: !!m.read,
    createdAt: m.created_at,
  };
}
 
function formatRequest(row, messages) {
  return {
    id: row.id,
    lostId: row.lost_id,
    foundId: row.found_id,
    requesterId: row.requester_id,
    finderId: row.found_owner_id,
    status: row.status,
    timestamp: row.created_at,
    lostOwner: { id: row.lost_owner_id, name: row.lost_owner_name },
    foundOwner: { id: row.found_owner_id, name: row.found_owner_name },
    messages: messages.map(formatMessage),
  };
}
 
// ---------- requests ----------
 
// GET /api/requests  -> every request this user is part of, with its messages
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      REQUEST_ROW +
        ' WHERE lr.user_id = ? OR fr.user_id = ? ORDER BY q.created_at DESC'
    )
    .all(req.user.id, req.user.id);
 
  const getMsgs = db.prepare(
    'SELECT * FROM messages WHERE request_id = ? ORDER BY created_at ASC, id ASC'
  );
  res.json({ requests: rows.map(r => formatRequest(r, getMsgs.all(r.id))) });
});
 
// POST /api/requests  { lostId, foundId }
router.post('/', (req, res) => {
  const lostId = Number(req.body.lostId);
  const foundId = Number(req.body.foundId);
  if (!lostId || !foundId) return res.status(400).json({ error: 'lostId and foundId are required' });
 
  const lost = db.prepare('SELECT * FROM reports WHERE id = ?').get(lostId);
  const found = db.prepare('SELECT * FROM reports WHERE id = ?').get(foundId);
 
  if (!lost || lost.type !== 'lost') return res.status(400).json({ error: 'Invalid lost report' });
  if (!found || found.type !== 'found') return res.status(400).json({ error: 'Invalid found report' });
  if (lost.user_id !== req.user.id) return res.status(403).json({ error: 'You can only request matches for your own lost report' });
  if (found.user_id === req.user.id) return res.status(400).json({ error: 'You cannot request your own found report' });
  if (lost.done || found.done) return res.status(400).json({ error: 'One of these reports is already closed' });
 
  const existing = db
    .prepare(
      "SELECT id FROM requests WHERE lost_id = ? AND found_id = ? AND status NOT IN ('cancelled','declined')"
    )
    .get(lostId, foundId);
  if (existing) return res.status(409).json({ error: 'A request already exists for this match' });
 
  const info = db
    .prepare(
      'INSERT INTO requests (lost_id, found_id, requester_id, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(lostId, foundId, req.user.id, Date.now());
 
  res.status(201).json({ request: formatRequest(getRequestRow(info.lastInsertRowid), []) });
});
 
// POST /api/requests/:id/respond  { accept: true|false }   (finder only)
router.post('/:id/respond', (req, res) => {
  const row = getRequestRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.found_owner_id !== req.user.id) return res.status(403).json({ error: 'Only the finder can respond' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'This request was already answered' });
 
  const status = req.body.accept ? 'approved' : 'declined';
  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, row.id);
  res.json({ request: formatRequest(getRequestRow(row.id), []) });
});
 
// POST /api/requests/:id/cancel   (requester only, while pending)
router.post('/:id/cancel', (req, res) => {
  const row = getRequestRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.requester_id !== req.user.id) return res.status(403).json({ error: 'Only the requester can cancel' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be cancelled' });
 
  db.prepare("UPDATE requests SET status = 'cancelled' WHERE id = ?").run(row.id);
  res.json({ request: formatRequest(getRequestRow(row.id), []) });
});
 
// POST /api/requests/:id/complete   (either person, once accepted) -> "Returned"
router.post('/:id/complete', (req, res) => {
  const row = getRequestRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (!isParticipant(row, req.user.id)) return res.status(403).json({ error: 'Not your request' });
  if (row.status !== 'approved') return res.status(400).json({ error: 'Only accepted requests can be completed' });
 
  const finish = db.transaction(() => {
    db.prepare("UPDATE requests SET status = 'completed' WHERE id = ?").run(row.id);
    db.prepare('UPDATE reports SET done = 1 WHERE id IN (?, ?)').run(row.lost_id, row.found_id);
  });
  finish();
 
  res.json({ request: formatRequest(getRequestRow(row.id), []) });
});
 
// ---------- chat messages ----------
 
// POST /api/requests/:id/messages  { text }
router.post('/:id/messages', (req, res) => {
  const row = getRequestRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (!isParticipant(row, req.user.id)) return res.status(403).json({ error: 'Not your chat' });
  if (row.status !== 'approved') return res.status(400).json({ error: 'Chat is not open' });
 
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long' });
 
  const info = db
    .prepare('INSERT INTO messages (request_id, sender_id, text, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id, req.user.id, text, Date.now());
 
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ message: formatMessage(msg) });
});
 
// POST /api/requests/:id/read   (marks the other person's messages as read)
router.post('/:id/read', (req, res) => {
  const row = getRequestRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (!isParticipant(row, req.user.id)) return res.status(403).json({ error: 'Not your chat' });
 
  db.prepare('UPDATE messages SET read = 1 WHERE request_id = ? AND sender_id != ? AND read = 0')
    .run(row.id, req.user.id);
  res.json({ ok: true });
});
 
// PATCH /api/requests/messages/:mid  { text }   (sender only)
router.patch('/messages/:mid', (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
 
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message cannot be empty' });
 
  db.prepare('UPDATE messages SET text = ?, edited = 1 WHERE id = ?').run(text, msg.id);
  res.json({ message: formatMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id)) });
});
 
// DELETE /api/requests/messages/:mid   (sender only)
router.delete('/messages/:mid', (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.mid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own messages' });
 
  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
  res.json({ ok: true });
});
 
module.exports = router;
 