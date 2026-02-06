const { Schema, model } = require('mongoose');

const shareTokenSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    kind: { type: String, enum: ['report', 'export'], required: true },
    format: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

shareTokenSchema.index({ projectId: 1, kind: 1 });
shareTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $ne: null } } });

module.exports = model('ShareToken', shareTokenSchema);
