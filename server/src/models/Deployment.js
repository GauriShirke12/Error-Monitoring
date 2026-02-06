const { Schema, model, Types } = require('mongoose');

const deploymentSchema = new Schema(
  {
    projectId: { type: Types.ObjectId, ref: 'Project', required: true, index: true },
    label: { type: String, trim: true },
    timestamp: { type: Date, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

deploymentSchema.index({ projectId: 1, timestamp: -1 });

deploymentSchema.pre('save', function normalizeLabel() {
  if (this.label && typeof this.label === 'string') {
    this.label = this.label.trim();
  }
});

module.exports = model('Deployment', deploymentSchema);
