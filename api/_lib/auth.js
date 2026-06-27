// Auth middleware - Vercel serverless compatible
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');

function authMiddleware(handler) {
  return async (req, res) => {
    const auth = req.headers.authorization || req.headers.Authorization;
    const token = auth && auth.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return handler(req, res);
  };
}

module.exports = { authMiddleware };
