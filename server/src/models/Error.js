const { Schema, model } = require('mongoose');

const stackFrameSchema = new Schema(
  {
    file: { type: String },
    line: { type: Number },
    column: { type: Number },
    function: { type: String },
    inApp: { type: Boolean },
  },
  { _id: false }
);

const errorSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    message: { type: String, required: true, trim: true },
    stackTrace: { type: [stackFrameSchema], default: [] },
    fingerprint: { type: String, required: true },
    count: { type: Number, default: 1, min: 1 },
    firstSeen: { type: Date, default: () => new Date(), immutable: true },
    lastSeen: { type: Date, default: () => new Date() },
    environment: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['new', 'open', 'investigating', 'resolved', 'ignored', 'muted'],
      default: 'new',
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    userContext: { type: Schema.Types.Mixed, default: {} },
    statusHistory: {
      type: [
        new Schema(
          {
            status: {
              type: String,
              enum: ['new', 'open', 'investigating', 'resolved', 'ignored', 'muted'],
              required: true,
            },
            changedAt: { type: Date, required: true },
            changedBy: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'TeamMember', default: null },
    assignmentHistory: {
      type: [
        new Schema(
          {
            memberId: { type: Schema.Types.ObjectId, ref: 'TeamMember', required: true },
            assignedAt: { type: Date, required: true },
            unassignedAt: { type: Date, default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    lastStatusChange: { type: Date, default: () => new Date() },
    resolvedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

errorSchema.index({ projectId: 1, fingerprint: 1 }, { unique: true });
errorSchema.index({ projectId: 1, createdAt: -1 });
errorSchema.index({ projectId: 1, environment: 1, lastSeen: -1 });
errorSchema.index({ projectId: 1, status: 1, lastSeen: -1 });
errorSchema.index({ projectId: 1, count: -1 });
errorSchema.index({ projectId: 1, firstSeen: 1 });
errorSchema.index({ projectId: 1, assignedTo: 1, status: 1 });
errorSchema.index({ projectId: 1, environment: 1, firstSeen: 1 });
errorSchema.index({ projectId: 1, environment: 1, status: 1, lastSeen: -1 });
errorSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } }
);

errorSchema.pre('save', function updateLastSeen() {
  if (this.isModified('lastSeen')) {
    return;
  }
  const shouldUpdateLastSeen =
    this.isModified('count') ||
    this.isModified('stackTrace') ||
    this.isModified('message') ||
    this.isModified('environment');

  if (shouldUpdateLastSeen) {
    this.lastSeen = new Date();
  }
});

module.exports = model('ErrorEvent', errorSchema);
