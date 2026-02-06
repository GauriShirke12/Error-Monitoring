const { Schema, model } = require('mongoose');

const alertDigestEntrySchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true, index: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'AlertRule', default: null },
    alert: {
      title: { type: String, default: '' },
      summary: { type: String, default: '' },
      severity: { type: String, default: 'info' },
      environment: { type: String, default: 'all' },
      occurrences: { type: Number, default: null },
      affectedUsers: { type: Number, default: null },
      windowMinutes: { type: Number, default: null },
      lastDetectedAt: { type: Date, default: null },
      link: { type: String, default: null },
    },
    processed: { type: Boolean, default: false, index: true },
    processedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

alertDigestEntrySchema.index({ memberId: 1, processed: 1, createdAt: 1 });
alertDigestEntrySchema.index({ projectId: 1, processed: 1, createdAt: 1 });

module.exports = model('AlertDigestEntry', alertDigestEntrySchema);
