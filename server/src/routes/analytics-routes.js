const express = require('express');
const {
	getOverview,
	getTrends,
	getTopErrors,
	getPatterns,
	getRelatedErrors,
	getUserImpact,
	getResolution,
	listDeployments,
	createDeployment,
} = require('../controllers/analytics-controller');
const apiKeyAuth = require('../middleware/api-key-auth');
const { perMinuteLimiter } = require('../middleware/per-key-rate-limit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(apiKeyAuth);
router.use(perMinuteLimiter);
router.use(requireRole(['admin', 'developer', 'viewer']));

router.get('/overview', getOverview);
router.get('/trends', getTrends);
router.get('/top-errors', getTopErrors);
router.get('/patterns', getPatterns);
router.get('/related-errors', getRelatedErrors);
router.get('/user-impact', getUserImpact);
router.get('/resolution', getResolution);
router.get('/deployments', listDeployments);
router.post('/deployments', createDeployment);

module.exports = router;
