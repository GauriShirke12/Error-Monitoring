const {
  listTeamMembers: listTeamMembersService,
  createTeamMember: createTeamMemberService,
  updateTeamMember: updateTeamMemberService,
  deleteTeamMember: deleteTeamMemberService,
  computeTeamPerformance,
  getTeamMemberById,
  getTeamMemberAlertPreferences,
  updateTeamMemberAlertPreferences,
} = require('../services/team-service');

const parseRange = (value) => {
  if (['7d', '30d', '90d'].includes(value)) {
    return value;
  }
  return '30d';
};

const parseBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
};

module.exports = {
  listTeamMembers: async (req, res, next) => {
    try {
      const members = await listTeamMembersService(req.project, {
        includeInactive: parseBoolean(req.query?.includeInactive),
      });
      return res.status(200).json({ data: members });
    } catch (error) {
      return next(error);
    }
  },
  createTeamMember: async (req, res, next) => {
    try {
      const member = await createTeamMemberService(req.project, req.body || {});
      return res.status(201).json({ data: member });
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      return next(error);
    }
  },
  updateTeamMember: async (req, res, next) => {
    try {
      const member = await updateTeamMemberService(req.project, req.params.id, req.body || {});
      if (!member) {
        return res.status(404).json({ error: { message: 'Team member not found' } });
      }
      return res.status(200).json({ data: member });
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      return next(error);
    }
  },
  deleteTeamMember: async (req, res, next) => {
    try {
      const deleted = await deleteTeamMemberService(req.project, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: { message: 'Team member not found' } });
      }
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
  getTeamPerformance: async (req, res, next) => {
    try {
      const range = parseRange(req.query?.range);
      const payload = await computeTeamPerformance(req.project, { range });
      return res.status(200).json({ data: payload });
    } catch (error) {
      return next(error);
    }
  },
  getTeamMember: async (req, res, next) => {
    try {
      const member = await getTeamMemberById(req.project, req.params.id);
      if (!member) {
        return res.status(404).json({ error: { message: 'Team member not found' } });
      }
      return res.status(200).json({ data: member });
    } catch (error) {
      return next(error);
    }
  },
  getAlertPreferences: async (req, res, next) => {
    try {
      const payload = await getTeamMemberAlertPreferences(req.project, req.params.id);
      if (!payload) {
        return res.status(404).json({ error: { message: 'Team member not found' } });
      }
      return res.status(200).json({ data: payload });
    } catch (error) {
      return next(error);
    }
  },
  updateAlertPreferences: async (req, res, next) => {
    try {
      const payload = await updateTeamMemberAlertPreferences(req.project, req.params.id, req.body || {});
      if (!payload) {
        return res.status(404).json({ error: { message: 'Team member not found' } });
      }
      return res.status(200).json({ data: payload });
    } catch (error) {
      if (error && error.status) {
        return res.status(error.status).json({ error: { message: error.message } });
      }
      return next(error);
    }
  },
};
