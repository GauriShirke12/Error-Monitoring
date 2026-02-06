const {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
} = require('../services/alert-rule-service');
const { simulateAlertRule } = require('../services/alert-test-service');
const logger = require('../utils/logger');

module.exports = {
  async index(req, res, next) {
    try {
      const rules = await listRules(req.project, req.query || {});
      return res.status(200).json({ data: rules });
    } catch (error) {
      logger.error({ err: error }, 'Failed to list alert rules');
      return next(error);
    }
  },

  async show(req, res, next) {
    try {
      const rule = await getRule(req.project, req.params.id);
      if (!rule) {
        return res.status(404).json({ error: { message: 'Alert rule not found' } });
      }
      return res.status(200).json({ data: rule });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch alert rule');
      return next(error);
    }
  },

  async create(req, res, next) {
    try {
      const rule = await createRule(req.project, req.body || {});
      return res.status(201).json({ data: rule });
    } catch (error) {
      logger.error({ err: error }, 'Failed to create alert rule');
      return next(error);
    }
  },

  async update(req, res, next) {
    try {
      const rule = await updateRule(req.project, req.params.id, req.body || {});
      if (!rule) {
        return res.status(404).json({ error: { message: 'Alert rule not found' } });
      }
      return res.status(200).json({ data: rule });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update alert rule');
      return next(error);
    }
  },

  async destroy(req, res, next) {
    try {
      const deleted = await deleteRule(req.project, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: { message: 'Alert rule not found' } });
      }
      return res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete alert rule');
      return next(error);
    }
  },

  async test(req, res, next) {
    try {
      const result = await simulateAlertRule({ project: req.project, ruleId: req.params.id, input: req.body || {} });

      if (result?.error?.status === 404) {
        return res.status(404).json({ error: { message: result.error.message } });
      }

      if (result?.error?.status === 422) {
        return res.status(422).json({ error: { message: result.error.message } });
      }

      return res.status(200).json({ data: result });
    } catch (error) {
      logger.error({ err: error }, 'Failed to simulate alert rule');
      return next(error);
    }
  },
};
