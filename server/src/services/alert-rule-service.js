const mongoose = require('mongoose');
const AlertRule = require('../models/AlertRule');

const sanitizeConditions = (type, input = {}) => {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const parsed = { ...input };

  const sanitizeFilterClause = (clause) => {
    if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
      return null;
    }
    if (clause.op) {
      const op = String(clause.op).toLowerCase();
      if (op === 'not') {
        const condition = sanitizeFilterClause(clause.condition);
        if (!condition) {
          return null;
        }
        return { op, condition };
      }
      if (op === 'and' || op === 'or') {
        const conditions = Array.isArray(clause.conditions)
          ? clause.conditions.map((child) => sanitizeFilterClause(child)).filter(Boolean)
          : [];
        if (!conditions.length) {
          return null;
        }
        return { op, conditions };
      }
      return null;
    }

    const field = typeof clause.field === 'string' ? clause.field.trim() : null;
    const operator = typeof clause.operator === 'string' ? clause.operator.trim().toLowerCase() : null;
    if (!field || !operator) {
      return null;
    }

    const base = { field, operator };

    if (operator === 'in' || operator === 'not_in') {
      const values = Array.isArray(clause.values)
        ? clause.values
            .map((value) => (typeof value === 'string' ? value.trim() : value))
            .filter((value) => value !== undefined && value !== null && value !== '')
        : [];
      if (!values.length) {
        return null;
      }
      return { ...base, values };
    }

    const value = clause.value;
    if (typeof value === 'string') {
      if (!value.trim()) {
        return null;
      }
      return { ...base, value: value.trim() };
    }
    if (value === null || value === undefined) {
      return null;
    }
    return { ...base, value };
  };

  if (type === 'threshold') {
    parsed.windowMinutes = Math.max(1, Number(parsed.windowMinutes || 5));
    parsed.threshold = Math.max(1, Number(parsed.threshold || 10));
  }

  if (type === 'spike') {
    parsed.windowMinutes = Math.max(1, Number(parsed.windowMinutes || 5));
    parsed.baselineMinutes = Math.max(parsed.windowMinutes, Number(parsed.baselineMinutes || 30));
    parsed.increasePercent = Math.max(1, Number(parsed.increasePercent || 200));
  }

  if (type === 'critical') {
    if (parsed.severity) {
      parsed.severity = String(parsed.severity).toLowerCase();
    }
  }

  if (Array.isArray(parsed.environments)) {
    parsed.environments = parsed.environments.filter((value) => typeof value === 'string' && value.trim().length).map((value) => value.trim());
  }

  if (parsed.fingerprint && typeof parsed.fingerprint === 'string') {
    parsed.fingerprint = parsed.fingerprint.trim();
  }

  if (parsed.filter !== undefined) {
    const filter = sanitizeFilterClause(parsed.filter);
    if (filter) {
      parsed.filter = filter;
    } else {
      delete parsed.filter;
    }
  }

  return parsed;
};

const normalizeChannels = (channels = []) => {
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels
    .map((channel) => {
      if (!channel || typeof channel !== 'object') {
        return null;
      }
      const type = typeof channel.type === 'string' ? channel.type.trim().toLowerCase() : null;
      const target = typeof channel.target === 'string' ? channel.target.trim() : null;
      if (!type || !target) {
        return null;
      }
      return { type, target };
    })
    .filter(Boolean);
};

const sanitizeEscalation = (input = {}) => {
  if (!input || typeof input !== 'object') {
    return { enabled: false, channels: [], levels: [] };
  }

  const enabled = Boolean(input.enabled);
  const channels = normalizeChannels(input.channels);

  const levels = Array.isArray(input.levels)
    ? input.levels
        .map((level) => {
          if (!level || typeof level !== 'object') {
            return null;
          }
          const after = Number(level.afterMinutes);
          if (!Number.isFinite(after) || after <= 0) {
            return null;
          }
          return {
            name: typeof level.name === 'string' ? level.name.trim() || null : null,
            afterMinutes: Math.max(0.01, after),
            channels: normalizeChannels(level.channels),
          };
        })
        .filter(Boolean)
    : [];

  return {
    enabled,
    channels,
    levels,
  };
};

module.exports = {
  async createRule(project, payload) {
    const rule = await AlertRule.create({
      project: project._id,
      name: payload.name,
      type: payload.type,
      conditions: sanitizeConditions(payload.type, payload.conditions),
      channels: normalizeChannels(payload.channels),
      enabled: payload.enabled !== undefined ? payload.enabled : true,
      cooldownMinutes:
        payload.cooldownMinutes === undefined ? 15 : Math.max(0, Number(payload.cooldownMinutes)),
      description: payload.description || '',
      tags: Array.isArray(payload.tags)
        ? payload.tags.filter((tag) => typeof tag === 'string' && tag.trim().length).map((tag) => tag.trim())
        : [],
      escalation: sanitizeEscalation(payload.escalation),
    });

    return rule.toObject();
  },

  async listRules(project, { type, enabled } = {}) {
    const query = { project: project._id };
    if (type && typeof type === 'string') {
      query.type = type.trim().toLowerCase();
    }
    if (enabled != null) {
      query.enabled = enabled === 'true' || enabled === true;
    }

    const rules = await AlertRule.find(query).sort({ createdAt: -1 }).lean();
    return rules;
  },

  async getRule(project, ruleId) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      return null;
    }
    const rule = await AlertRule.findOne({ _id: ruleId, project: project._id }).lean();
    return rule;
  },

  async updateRule(project, ruleId, payload) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      return null;
    }

    const existing = await AlertRule.findOne({ _id: ruleId, project: project._id });
    if (!existing) {
      return null;
    }

    const nextType = payload.type || existing.type;
    const update = {};
    if (payload.name !== undefined) {
      update.name = payload.name;
    }
    if (payload.type !== undefined) {
      update.type = payload.type;
    }
    if (payload.conditions !== undefined) {
      update.conditions = sanitizeConditions(nextType, payload.conditions);
    }
    if (payload.channels !== undefined) {
      update.channels = normalizeChannels(payload.channels);
    }
    if (payload.enabled !== undefined) {
      update.enabled = Boolean(payload.enabled);
    }
    if (payload.cooldownMinutes !== undefined) {
      update.cooldownMinutes = Math.max(0, Number(payload.cooldownMinutes));
    }
    if (payload.description !== undefined) {
      update.description = payload.description || '';
    }
    if (payload.tags !== undefined) {
      update.tags = Array.isArray(payload.tags)
        ? payload.tags.filter((tag) => typeof tag === 'string' && tag.trim().length).map((tag) => tag.trim())
        : [];
    }
    if (payload.escalation !== undefined) {
      update.escalation = sanitizeEscalation(payload.escalation);
    }

    const rule = await AlertRule.findOneAndUpdate(
      { _id: existing._id },
      { $set: update },
      { new: true, lean: true }
    );

    return rule;
  },

  async deleteRule(project, ruleId) {
    if (!mongoose.Types.ObjectId.isValid(ruleId)) {
      return false;
    }
    const result = await AlertRule.deleteOne({ _id: ruleId, project: project._id });
    return result.deletedCount === 1;
  },
};
