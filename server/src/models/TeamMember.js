const crypto = require('crypto');
const { Schema, model } = require('mongoose');

const DEFAULT_QUIET_HOURS = Object.freeze({
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: 'UTC',
});

const DEFAULT_DIGEST = Object.freeze({
  cadence: 'daily',
  lastSentAt: null,
});

const defaultAlertPreferences = () => ({
  email: {
    mode: 'immediate',
    quietHours: { ...DEFAULT_QUIET_HOURS },
    digest: { ...DEFAULT_DIGEST },
    unsubscribeToken: crypto.randomBytes(18).toString('hex'),
    updatedAt: new Date(),
  },
});

const teamMemberSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: { type: String, default: null, trim: true },
    active: { type: Boolean, default: true },
    avatarColor: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    alertPreferences: {
      type: new Schema(
        {
          email: {
            mode: {
              type: String,
              enum: ['immediate', 'digest', 'disabled'],
              default: 'immediate',
            },
            quietHours: {
              enabled: { type: Boolean, default: DEFAULT_QUIET_HOURS.enabled },
              start: { type: String, default: DEFAULT_QUIET_HOURS.start },
              end: { type: String, default: DEFAULT_QUIET_HOURS.end },
              timezone: { type: String, default: DEFAULT_QUIET_HOURS.timezone },
            },
            digest: {
              cadence: { type: String, default: DEFAULT_DIGEST.cadence },
              lastSentAt: { type: Date, default: DEFAULT_DIGEST.lastSentAt },
            },
            unsubscribeToken: { type: String, default: null },
            updatedAt: { type: Date, default: Date.now },
          },
        },
        { _id: false }
      ),
      default: defaultAlertPreferences,
    },
  },
  {
    timestamps: true,
  }
);

teamMemberSchema.index({ projectId: 1, email: 1 }, { unique: true });
teamMemberSchema.index({ projectId: 1, active: 1 });

teamMemberSchema.pre('save', function ensurePreferenceDefaults() {
  if (!this.alertPreferences) {
    this.alertPreferences = defaultAlertPreferences();
  }

  if (!this.alertPreferences.email) {
    this.alertPreferences.email = defaultAlertPreferences().email;
  }

  if (!this.alertPreferences.email.unsubscribeToken) {
    this.alertPreferences.email.unsubscribeToken = crypto.randomBytes(18).toString('hex');
  }

  this.alertPreferences.email.updatedAt = new Date();
});

module.exports = model('TeamMember', teamMemberSchema);
