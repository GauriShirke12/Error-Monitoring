const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
};

const extractBearerToken = (headerValue = '') => {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }
  const [scheme, token] = headerValue.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
};

const loadUserFromToken = async (token) => {
  if (!token) {
    return null;
  }
  const payload = jwt.verify(token, getSecret());
  if (!payload?.sub) {
    return null;
  }
  const user = await User.findById(payload.sub).lean();
  return user || null;
};

const requireAuth = async (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers.authorization || '');
    if (!token) {
      return res.status(401).json({ error: { message: 'Authorization required' } });
    }

    const user = await loadUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: { message: 'Invalid token' } });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: { message: 'Unauthorized' } });
  }
};

const requireRole = (roles) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    const roleFromContext = req.accessRole;
    if (roleFromContext && allowed.includes(roleFromContext)) {
      return next();
    }

    if (!req.user) {
      return res.status(401).json({ error: { message: 'Authorization required' } });
    }

    const projectId = req.project?._id || req.project?.id;
    const membership = (req.user.memberships || []).find((m) =>
      projectId ? m.projectId?.toString() === projectId.toString() : true
    );
    const role = membership?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }

    req.accessRole = role;
    return next();
  };
};

module.exports = {
  getSecret,
  extractBearerToken,
  loadUserFromToken,
  requireAuth,
  requireRole,
};
