const express = require('express');
const { signup, login, me } = require('../controllers/auth-controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/auth/signup', signup);
router.post('/auth/login', login);
router.get('/auth/me', requireAuth, me);

module.exports = router;
