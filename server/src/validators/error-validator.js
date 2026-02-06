const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');

const errorValidationRules = [
  body('message')
    .isString()
    .withMessage('message must be a string')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('message must be between 1 and 2000 characters'),
  body('stackTrace')
    .isArray({ min: 1, max: 50 })
    .withMessage('stackTrace must be an array with at least one frame (max 50 frames)'),
  body('stackTrace.*').custom((frame) => {
    if (frame == null || typeof frame !== 'object') {
      throw new Error('stackTrace frames must be objects');
    }
    const { file, function: fn, line, column } = frame;
    if (file && typeof file !== 'string') throw new Error('stackTrace.file must be a string');
    if (fn && typeof fn !== 'string') throw new Error('stackTrace.function must be a string');
    if (line && !Number.isInteger(line)) throw new Error('stackTrace.line must be an integer');
    if (column && !Number.isInteger(column)) throw new Error('stackTrace.column must be an integer');
    return true;
  }),
  body('environment')
    .isString()
    .withMessage('environment must be a string')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('environment must be between 1 and 100 characters'),
  body('userContext').optional().isObject().withMessage('userContext must be an object'),
  body('metadata').optional().isObject().withMessage('metadata must be an object'),
  body('timestamp').optional().isISO8601().withMessage('timestamp must be ISO8601 compliant'),
];

const errorStatusValidationRules = [
  body('status').isString().withMessage('status must be a string').trim().notEmpty(),
  body('changedBy')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        return true;
      }
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('changedBy must be a non-empty string');
      }
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('changedBy must be a valid team member id');
      }
      return true;
    }),
];

const errorAssignmentValidationRules = [
  body('memberId')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        return true;
      }
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('memberId must be a non-empty string');
      }
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('memberId must be a valid team member id');
      }
      return true;
    }),
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
  errorValidationRules,
  errorStatusValidationRules,
  errorAssignmentValidationRules,
  handleValidation,
};
