const express = require('express');
const { createError, listErrors, getError, updateError, deleteError, updateAssignment } = require('../controllers/error-controller');
const {
	errorValidationRules,
	errorStatusValidationRules,
	errorAssignmentValidationRules,
	handleValidation,
} = require('../validators/error-validator');
const apiKeyAuth = require('../middleware/api-key-auth');
const { perMinuteLimiter, perHourLimiter } = require('../middleware/per-key-rate-limit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(apiKeyAuth);
router.use(perMinuteLimiter);

router.get('/errors', requireRole(['admin', 'developer', 'viewer']), listErrors);
router.get('/errors/:id', requireRole(['admin', 'developer', 'viewer']), getError);
router.post(
	'/errors',
	perHourLimiter,
	requireRole(['admin']),
	errorValidationRules,
	handleValidation,
	createError
);
router.patch('/errors/:id', requireRole(['admin', 'developer']), errorStatusValidationRules, handleValidation, updateError);
router.patch('/errors/:id/assignment', requireRole(['admin', 'developer']), errorAssignmentValidationRules, handleValidation, updateAssignment);
router.delete('/errors/:id', requireRole(['admin']), deleteError);

module.exports = router;
