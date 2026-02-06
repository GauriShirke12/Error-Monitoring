const express = require('express');
const {
  requestReport,
  listRuns,
  getRun,
  deleteRun,
  downloadRun,
  createShareToken,
  downloadShare,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
} = require('../controllers/report-controller');
const apiKeyAuth = require('../middleware/api-key-auth');
const { perMinuteLimiter } = require('../middleware/per-key-rate-limit');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/reports/share/:token', downloadShare);

router.use(apiKeyAuth);
router.use(perMinuteLimiter);

router.post('/reports/generate', requireRole(['admin', 'developer']), requestReport);
router.get('/reports/runs', requireRole(['admin', 'developer', 'viewer']), listRuns);
router.get('/reports/runs/:id', requireRole(['admin', 'developer', 'viewer']), getRun);
router.delete('/reports/runs/:id', requireRole(['admin']), deleteRun);
router.get('/reports/runs/:id/download', requireRole(['admin', 'developer', 'viewer']), downloadRun);
router.post('/reports/runs/:id/share', requireRole(['admin', 'developer']), createShareToken);

router.get('/reports/schedules', requireRole(['admin', 'developer', 'viewer']), listSchedules);
router.post('/reports/schedules', requireRole(['admin']), createSchedule);
router.patch('/reports/schedules/:id', requireRole(['admin']), updateSchedule);
router.delete('/reports/schedules/:id', requireRole(['admin']), deleteSchedule);
router.post('/reports/schedules/:id/run', requireRole(['admin']), runScheduleNow);

module.exports = router;
