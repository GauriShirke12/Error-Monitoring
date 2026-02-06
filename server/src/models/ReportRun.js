const { Schema, model } = require('mongoose');

const reportRunSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    scheduleId: { type: Schema.Types.ObjectId, ref: 'ReportSchedule', default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    range: {
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true },
      label: { type: String, default: null },
    },
    format: { type: String, enum: ['pdf', 'xlsx'], required: true },
    outputPath: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    summary: { type: Schema.Types.Mixed, default: {} },
    recommendations: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    error: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

reportRunSchema.index({ projectId: 1, createdAt: -1 });
reportRunSchema.index({ projectId: 1, scheduleId: 1, createdAt: -1 });

module.exports = model('ReportRun', reportRunSchema);
