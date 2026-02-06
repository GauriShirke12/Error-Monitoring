const { Schema, model } = require('mongoose');

const alertNotificationStateSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['cooldown', 'escalation'],
      required: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

alertNotificationStateSchema.index({ type: 1, key: 1 }, { unique: true });

module.exports = model('AlertNotificationState', alertNotificationStateSchema);
