const { Schema, model, Types } = require('mongoose');

const channelSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['email', 'slack', 'webhook', 'discord', 'teams'],
      required: true,
    },
    target: {
      type: String,
      trim: true,
      required: true,
    },
  },
  { _id: false }
);

const alertRuleSchema = new Schema(
  {
    project: { type: Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['threshold', 'spike', 'new_error', 'critical'],
      required: true,
    },
    conditions: {
      type: Schema.Types.Mixed,
      default: {},
    },
    channels: {
      type: [channelSchema],
      default: [],
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    cooldownMinutes: {
      type: Number,
      min: 0,
      default: 15,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    tags: {
      type: [String],
      default: [],
    },
    escalation: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          channels: {
            type: [channelSchema],
            default: [],
          },
          levels: {
            type: [
              new Schema(
                {
                  name: { type: String, default: null, trim: true },
                          afterMinutes: { type: Number, min: 0.01, required: true },
                  channels: {
                    type: [channelSchema],
                    default: [],
                  },
                },
                { _id: false }
              ),
            ],
            default: [],
          },
        },
        { _id: false }
      ),
      default: () => ({ enabled: false, levels: [] }),
    },
  },
  {
    timestamps: true,
  }
);

module.exports = model('AlertRule', alertRuleSchema);
