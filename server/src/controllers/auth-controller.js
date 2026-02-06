const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Project = require('../models/Project');
const logger = require('../utils/logger');

const signToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return jwt.sign({ sub: user._id.toString(), email: user.email }, secret, { expiresIn: '12h' });
};

const sanitizeUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  memberships: user.memberships?.map((m) => ({ projectId: m.projectId?.toString?.(), role: m.role })) || [],
});

module.exports = {
  async signup(req, res) {
    try {
      const { name, email, password, projectId, role = 'admin' } = req.body || {};
      if (!name || !email || !password) {
        return res.status(422).json({ error: { message: 'name, email, and password are required' } });
      }

      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(409).json({ error: { message: 'User already exists' } });
      }

      const memberships = [];
      if (projectId) {
        const project = await Project.findById(projectId).lean();
        if (!project) {
          return res.status(404).json({ error: { message: 'Project not found' } });
        }
        memberships.push({ projectId: project._id, role });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({ name, email: email.toLowerCase(), passwordHash, memberships });
      const token = signToken(user);
      return res.status(201).json({ data: { user: sanitizeUser(user), token } });
    } catch (error) {
      logger.error({ err: error }, 'Signup failed');
      return res.status(500).json({ error: { message: 'Signup failed' } });
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(422).json({ error: { message: 'email and password are required' } });
      }
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: { message: 'Invalid credentials' } });
      }
      const token = signToken(user);
      return res.status(200).json({ data: { user: sanitizeUser(user), token } });
    } catch (error) {
      logger.error({ err: error }, 'Login failed');
      return res.status(500).json({ error: { message: 'Login failed' } });
    }
  },

  async me(req, res) {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    return res.status(200).json({ data: { user: sanitizeUser(req.user) } });
  },
};
