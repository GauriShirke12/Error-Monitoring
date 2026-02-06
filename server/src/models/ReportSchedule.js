const { Schema, model } = require('mongoose');

const reportScheduleSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    frequency: { type: String, enum: ['weekly', 'monthly', 'custom'], required: true },
    dayOfWeek: { type: Number, min: 0, max: 6, default: null },
    dayOfMonth: { type: Number, min: 1, max: 31, default: null },
    runAtUTC: { type: String, required: true },
    timezone: { type: String, default: 'UTC' },
    format: { type: String, enum: ['pdf', 'xlsx'], default: 'pdf' },
    parameters: {
      range: new Schema(
        {
          startDate: { type: Date, default: null },
          endDate: { type: Date, default: null },
          preset: { type: String, default: '7d' },
        },
        { _id: false }
      ),
      includeRecommendations: { type: Boolean, default: true },
      environment: { type: String, default: null },
    },
    recipients: { type: [String], default: [] },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
    lastErrorMessage: { type: String, default: null },
    active: { type: Boolean, default: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

reportScheduleSchema.index({ projectId: 1, active: 1 });
reportScheduleSchema.index({ projectId: 1, nextRunAt: 1 });

module.exports = model('ReportSchedule', reportScheduleSchema);
