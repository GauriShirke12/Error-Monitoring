const express = require('express');
const { index, show, create, update, destroy, test } = require('../controllers/alert-rule-controller');
const {
  createAlertRuleValidationRules,
  updateAlertRuleValidationRules,
  testAlertRuleValidationRules,
  handleValidation,
} = require('../validators/alert-rule-validator');
const apiKeyAuth = require('../middleware/api-key-auth');
const { perMinuteLimiter } = require('../middleware/per-key-rate-limit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(apiKeyAuth);
router.use(perMinuteLimiter);

router.get('/alert-rules', requireRole(['admin', 'developer', 'viewer']), index);
router.get('/alert-rules/:id', requireRole(['admin', 'developer', 'viewer']), show);
router.post('/alert-rules', requireRole(['admin']), createAlertRuleValidationRules, handleValidation, create);
router.put('/alert-rules/:id', requireRole(['admin']), updateAlertRuleValidationRules, handleValidation, update);
router.post('/alert-rules/:id/test', requireRole(['admin']), testAlertRuleValidationRules, handleValidation, test);
router.delete('/alert-rules/:id', requireRole(['admin']), destroy);

module.exports = router;
