const { Schema, model } = require('mongoose');

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    apiKeyHash: { type: String, required: true, unique: true, index: true },
    apiKeyPreview: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
    },
    scrubbing: {
      removeEmails: { type: Boolean, default: false },
      removePhones: { type: Boolean, default: false },
      removeIPs: { type: Boolean, default: false },
    },
    retentionDays: { type: Number, default: 90, min: 1, max: 365 },
  },
  {
    timestamps: true,
  }
);

module.exports = model('Project', projectSchema);
