const logger = require('../utils/logger');
const AlertNotificationState = require('../models/AlertNotificationState');

const DRIVER = (process.env.ALERT_STATE_DRIVER || 'mongo').toLowerCase();

const buildMemoryDriver = () => {
  const cooldowns = new Map();
  const escalations = new Map();

  return {
    async saveCooldown(ruleId, timestampMs) {
      cooldowns.set(String(ruleId), Number(timestampMs));
    },
    async getCooldown(ruleId) {
      const value = cooldowns.get(String(ruleId));
      return value != null ? Number(value) : null;
    },
    async deleteCooldown(ruleId) {
      cooldowns.delete(String(ruleId));
    },
    async listCooldowns() {
      return Array.from(cooldowns.entries()).map(([key, timestampMs]) => ({ key, timestampMs }));
    },
    async saveEscalation(entry) {
      escalations.set(String(entry.id), entry);
    },
    async getEscalation(alertId) {
      return escalations.get(String(alertId)) || null;
    },
    async deleteEscalation(alertId) {
      escalations.delete(String(alertId));
    },
    async listEscalations() {
      return Array.from(escalations.values()).map((entry) => ({ ...entry }));
    },
    async clearAll() {
      cooldowns.clear();
      escalations.clear();
    },
    isMemory: true,
  };
};

const buildMongoDriver = () => {
  const serializeCooldownKey = (ruleId) => String(ruleId);

  const baseQuery = (type, key) => ({ type, key: String(key) });

  const readDocument = (doc) => (doc ? doc.toObject ? doc.toObject() : doc : null);

  return {
    async saveCooldown(ruleId, timestampMs) {
      await AlertNotificationState.findOneAndUpdate(
        baseQuery('cooldown', serializeCooldownKey(ruleId)),
        {
          $set: {
            payload: { timestampMs: Number(timestampMs) },
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      ).exec();
    },
    async getCooldown(ruleId) {
      const doc = readDocument(
        await AlertNotificationState.findOne(baseQuery('cooldown', serializeCooldownKey(ruleId))).lean()
      );
      return doc?.payload?.timestampMs != null ? Number(doc.payload.timestampMs) : null;
    },
    async deleteCooldown(ruleId) {
      await AlertNotificationState.deleteOne(baseQuery('cooldown', serializeCooldownKey(ruleId))).exec();
    },
    async listCooldowns() {
      const docs = await AlertNotificationState.find({ type: 'cooldown' }).lean();
      return docs.map((doc) => ({
        key: doc.key,
        timestampMs: doc?.payload?.timestampMs != null ? Number(doc.payload.timestampMs) : null,
      }));
    },
    async saveEscalation(entry) {
      await AlertNotificationState.findOneAndUpdate(
        baseQuery('escalation', entry.id),
        {
          $set: {
            payload: entry,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      ).exec();
    },
    async getEscalation(alertId) {
      const doc = readDocument(
        await AlertNotificationState.findOne(baseQuery('escalation', alertId)).lean()
      );
      return doc?.payload ? { ...doc.payload } : null;
    },
    async deleteEscalation(alertId) {
      await AlertNotificationState.deleteOne(baseQuery('escalation', alertId)).exec();
    },
    async listEscalations() {
      const docs = await AlertNotificationState.find({ type: 'escalation' }).lean();
      return docs.map((doc) => ({ ...doc.payload }));
    },
    async clearAll() {
      await AlertNotificationState.deleteMany({ type: { $in: ['cooldown', 'escalation'] } }).exec();
    },
    isMemory: false,
  };
};

let driver;

if (DRIVER === 'memory') {
  driver = buildMemoryDriver();
  logger.info('Alert state adapter using in-memory driver');
} else {
  driver = buildMongoDriver();
  logger.info({ driver: DRIVER }, 'Alert state adapter using MongoDB driver');
}

module.exports = {
  saveCooldown: (ruleId, timestampMs) => driver.saveCooldown(ruleId, timestampMs),
  getCooldown: (ruleId) => driver.getCooldown(ruleId),
  deleteCooldown: (ruleId) => driver.deleteCooldown(ruleId),
  listCooldowns: () => driver.listCooldowns(),
  saveEscalation: (entry) => driver.saveEscalation(entry),
  getEscalation: (alertId) => driver.getEscalation(alertId),
  deleteEscalation: (alertId) => driver.deleteEscalation(alertId),
  listEscalations: () => driver.listEscalations(),
  clearAll: () => driver.clearAll(),
  __testing: {
    driver,
  },
};
