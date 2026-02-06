const express = require('express');
const {
	listTeamMembers,
	createTeamMember,
	updateTeamMember,
	deleteTeamMember,
	getTeamPerformance,
	getTeamMember,
	getAlertPreferences,
	updateAlertPreferences,
} = require('../controllers/team-controller');
const apiKeyAuth = require('../middleware/api-key-auth');
const { perMinuteLimiter } = require('../middleware/per-key-rate-limit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(apiKeyAuth);
router.use(perMinuteLimiter);

router.get('/team/members', requireRole(['admin', 'developer', 'viewer']), listTeamMembers);
router.post('/team/members', requireRole(['admin']), createTeamMember);
router.patch('/team/members/:id', requireRole(['admin']), updateTeamMember);
router.delete('/team/members/:id', requireRole(['admin']), deleteTeamMember);
router.get('/team/performance', requireRole(['admin', 'developer', 'viewer']), getTeamPerformance);
router.get('/team/members/:id', requireRole(['admin', 'developer', 'viewer']), getTeamMember);
router.get('/team/members/:id/alert-preferences', requireRole(['admin', 'developer', 'viewer']), getAlertPreferences);
router.patch('/team/members/:id/alert-preferences', requireRole(['admin']), updateAlertPreferences);

module.exports = router;
