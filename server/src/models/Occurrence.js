const { Schema, model, Types } = require('mongoose');

const occurrenceSchema = new Schema(
  {
    errorId: { type: Types.ObjectId, ref: 'ErrorEvent', required: true },
    projectId: { type: Types.ObjectId, ref: 'Project', required: true, index: true },
    fingerprint: { type: String, required: true },
    message: { type: String, required: true, trim: true },
    stackTrace: { type: [Schema.Types.Mixed], default: [] },
    environment: { type: String, required: true, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    userContext: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

occurrenceSchema.index({ errorId: 1, timestamp: -1 });
occurrenceSchema.index({ fingerprint: 1, timestamp: -1 });
occurrenceSchema.index({ projectId: 1, timestamp: -1 });
occurrenceSchema.index({ projectId: 1, environment: 1, timestamp: -1 });
occurrenceSchema.index({ projectId: 1, fingerprint: 1, timestamp: -1 });
occurrenceSchema.index({ projectId: 1, fingerprint: 1 });
occurrenceSchema.index({ projectId: 1, createdAt: -1 });
occurrenceSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);

module.exports = model('ErrorOccurrence', occurrenceSchema);
