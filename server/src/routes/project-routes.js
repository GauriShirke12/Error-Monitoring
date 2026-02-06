const express = require('express');
const { requireAuth } = require('../middleware/auth');
const projectController = require('../controllers/project-controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', projectController.list);
router.post('/', projectController.create);
router.patch('/:projectId', projectController.update);
router.post('/:projectId/rotate-key', projectController.rotateKey);

module.exports = router;
