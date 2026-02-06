const { body, validationResult } = require('express-validator');

const RULE_TYPES = ['threshold', 'spike', 'new_error', 'critical'];
const CHANNEL_TYPES = ['email', 'slack', 'webhook', 'discord', 'teams'];
const FILTER_FIELDS = ['environment', 'file', 'userSegment'];
const FILTER_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'in',
  'not_in',
];
const LOGICAL_OPERATORS = ['and', 'or', 'not'];

const assertValidChannels = (channels, path = 'channels') => {
  if (!Array.isArray(channels)) {
    throw new Error(`${path} must be an array`);
  }
  channels.forEach((channel, index) => {
    if (!channel || typeof channel !== 'object') {
      throw new Error(`${path}[${index}] must be an object`);
    }
    if (!CHANNEL_TYPES.includes(String(channel.type || '').toLowerCase())) {
      throw new Error(`${path}[${index}].type must be one of ${CHANNEL_TYPES.join(', ')}`);
    }
    if (typeof channel.target !== 'string' || !channel.target.trim()) {
      throw new Error(`${path}[${index}].target must be a non-empty string`);
    }
  });
};

const assertValidFilterClause = (clause, path) => {
  if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
    throw new Error(`${path} must be an object`);
  }

  if (clause.op) {
    const op = String(clause.op).toLowerCase();
    if (!LOGICAL_OPERATORS.includes(op)) {
      throw new Error(`${path}.op must be one of ${LOGICAL_OPERATORS.join(', ')}`);
    }
    if (op === 'not') {
      if (!clause.condition) {
        throw new Error(`${path}.condition is required when op is 'not'`);
      }
      assertValidFilterClause(clause.condition, `${path}.condition`);
      return;
    }
    if (!Array.isArray(clause.conditions) || clause.conditions.length === 0) {
      throw new Error(`${path}.conditions must be a non-empty array`);
    }
    clause.conditions.forEach((child, index) => {
      assertValidFilterClause(child, `${path}.conditions[${index}]`);
    });
    return;
  }

  if (!FILTER_FIELDS.includes(clause.field)) {
    throw new Error(`${path}.field must be one of ${FILTER_FIELDS.join(', ')}`);
  }
  const operator = String(clause.operator || '').toLowerCase();
  if (!FILTER_OPERATORS.includes(operator)) {
    throw new Error(`${path}.operator must be one of ${FILTER_OPERATORS.join(', ')}`);
  }

  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(clause.values) || clause.values.length === 0) {
      throw new Error(`${path}.values must be a non-empty array for operator ${operator}`);
    }
  } else if (clause.value === undefined || clause.value === null || (typeof clause.value === 'string' && !clause.value.trim())) {
    throw new Error(`${path}.value must be provided for operator ${operator}`);
  }
};

const validateConditions = (required) =>
  body('conditions')
    .if((value, { req }) => value !== undefined || required)
    .custom((value, { req }) => {
      if (value === undefined || value === null) {
        if (required) {
          throw new Error('conditions is required');
        }
        return true;
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('conditions must be an object');
      }
      const type = req.body.type;
      if (!RULE_TYPES.includes(type)) {
        return true;
      }
      if (type === 'threshold') {
        if (typeof value.threshold !== 'number' || value.threshold <= 0) {
          throw new Error('conditions.threshold must be a positive number');
        }
        if (typeof value.windowMinutes !== 'number' || value.windowMinutes <= 0) {
          throw new Error('conditions.windowMinutes must be a positive number');
        }
      }
      if (type === 'spike') {
        if (typeof value.increasePercent !== 'number' || value.increasePercent <= 0) {
          throw new Error('conditions.increasePercent must be a positive number');
        }
        if (typeof value.windowMinutes !== 'number' || value.windowMinutes <= 0) {
          throw new Error('conditions.windowMinutes must be a positive number');
        }
        if (typeof value.baselineMinutes !== 'number' || value.baselineMinutes <= 0) {
          throw new Error('conditions.baselineMinutes must be a positive number');
        }
      }
      if (value.environments && !Array.isArray(value.environments)) {
        throw new Error('conditions.environments must be an array when provided');
      }
      if (value.filter !== undefined) {
        assertValidFilterClause(value.filter, 'conditions.filter');
      }
      return true;
    });

const validateChannels = body('channels')
  .optional()
  .custom((channels) => {
    assertValidChannels(channels);
    return true;
  });

const validateEscalation = body('escalation')
  .optional()
  .custom((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('escalation must be an object');
    }
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
      throw new Error('escalation.enabled must be a boolean');
    }
    if (value.channels !== undefined) {
      assertValidChannels(value.channels, 'escalation.channels');
    }
    if (value.levels !== undefined) {
      if (!Array.isArray(value.levels)) {
        throw new Error('escalation.levels must be an array');
      }
      value.levels.forEach((level, index) => {
        if (!level || typeof level !== 'object' || Array.isArray(level)) {
          throw new Error(`escalation.levels[${index}] must be an object`);
        }
        if (typeof level.afterMinutes !== 'number' || level.afterMinutes <= 0) {
          throw new Error(`escalation.levels[${index}].afterMinutes must be a positive number`);
        }
        if (level.channels !== undefined) {
          assertValidChannels(level.channels, `escalation.levels[${index}].channels`);
        }
      });
    }
    return true;
  });

const baseRules = [
  body('name').isString().withMessage('name must be a string').trim().notEmpty(),
  body('type')
    .isString()
    .withMessage('type must be a string')
    .custom((value) => {
      const normalized = value.trim().toLowerCase();
      if (!RULE_TYPES.includes(normalized)) {
        throw new Error(`type must be one of ${RULE_TYPES.join(', ')}`);
      }
      return true;
    })
    .customSanitizer((value) => value.trim().toLowerCase()),
  validateConditions(true),
  validateChannels,
  validateEscalation,
  body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  body('cooldownMinutes')
    .optional()
    .isInt({ min: 0 })
    .withMessage('cooldownMinutes must be an integer >= 0')
    .toInt(),
  body('description').optional().isString().withMessage('description must be a string'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('tags must be an array of strings')
    .custom((tags) => {
      tags.forEach((tag, index) => {
        if (typeof tag !== 'string' || !tag.trim()) {
          throw new Error(`tags[${index}] must be a non-empty string`);
        }
      });
      return true;
    }),
];

const updateRules = [
  body('name').optional().isString().withMessage('name must be a string').trim().notEmpty(),
  body('type')
    .optional()
    .isString()
    .withMessage('type must be a string')
    .custom((value) => {
      const normalized = value.trim().toLowerCase();
      if (!RULE_TYPES.includes(normalized)) {
        throw new Error(`type must be one of ${RULE_TYPES.join(', ')}`);
      }
      return true;
    })
    .customSanitizer((value) => value.trim().toLowerCase()),
  validateConditions(false),
  validateChannels,
  validateEscalation,
  body('enabled').optional().isBoolean().withMessage('enabled must be a boolean'),
  body('cooldownMinutes')
    .optional()
    .isInt({ min: 0 })
    .withMessage('cooldownMinutes must be an integer >= 0')
    .toInt(),
  body('description').optional().isString().withMessage('description must be a string'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('tags must be an array of strings')
    .custom((tags) => {
      tags.forEach((tag, index) => {
        if (typeof tag !== 'string' || !tag.trim()) {
          throw new Error(`tags[${index}] must be a non-empty string`);
        }
      });
      return true;
    }),
];

const testRuleRules = [
  body('environment').optional().isString().withMessage('environment must be a string'),
  body('severity').optional().isString().withMessage('severity must be a string'),
  body('fingerprint').optional().isString().withMessage('fingerprint must be a string'),
  body('windowCount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('windowCount must be a number greater than or equal to 0')
    .toFloat(),
  body('windowMinutes')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('windowMinutes must be a number greater than or equal to 0')
    .toFloat(),
  body('baselineCount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('baselineCount must be a number greater than or equal to 0')
    .toFloat(),
  body('baselineMinutes')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('baselineMinutes must be a number greater than or equal to 0')
    .toFloat(),
  body('occurrences')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('occurrences must be a number greater than or equal to 0')
    .toFloat(),
  body('affectedUsers')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('affectedUsers must be a number greater than or equal to 0')
    .toFloat(),
  body('isNew').optional().isBoolean().withMessage('isNew must be a boolean').toBoolean(),
  body('userSegments')
    .optional()
    .isArray()
    .withMessage('userSegments must be an array of strings')
    .custom((segments) => {
      segments.forEach((segment, index) => {
        if (typeof segment !== 'string' || !segment.trim()) {
          throw new Error(`userSegments[${index}] must be a non-empty string`);
        }
      });
      return true;
    }),
  body('stackTrace')
    .optional()
    .isArray()
    .withMessage('stackTrace must be an array of frames')
    .custom((frames, { path }) => {
      frames.forEach((frame, index) => {
        if (!frame || typeof frame !== 'object') {
          throw new Error(`${path}[${index}] must be an object`);
        }
      });
      return true;
    }),
  body('links').optional().isObject().withMessage('links must be an object'),
];

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: {
        message: 'Validation failed',
        details: errors.array().map((err) => ({ field: err.path, message: err.msg })),
      },
    });
  }
  return next();
};

module.exports = {
  createAlertRuleValidationRules: baseRules,
  updateAlertRuleValidationRules: updateRules,
  testAlertRuleValidationRules: testRuleRules,
  handleValidation,
};
