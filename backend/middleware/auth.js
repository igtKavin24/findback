const jwt = require('jsonwebtoken');

// Blocks the request unless a valid login token is sent
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in first' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, name: payload.name, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

module.exports = requireAuth;