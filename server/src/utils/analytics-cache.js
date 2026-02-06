const FIVE_MINUTES_MS = 5 * 60 * 1000;

const projectCache = new Map();

const getStore = (projectId) => {
  const key = projectId.toString();
  if (!projectCache.has(key)) {
    projectCache.set(key, new Map());
  }
  return projectCache.get(key);
};

const get = (projectId, cacheKey) => {
  const store = projectCache.get(projectId.toString());
  if (!store) {
    return null;
  }
  const entry = store.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    store.delete(cacheKey);
    return null;
  }

  return entry.value;
};

const set = (projectId, cacheKey, value, ttlMs = FIVE_MINUTES_MS) => {
  const store = getStore(projectId);
  store.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
};

const invalidateProject = (projectId) => {
  projectCache.delete(projectId.toString());
};

const invalidateAll = () => {
  projectCache.clear();
};

module.exports = {
  get,
  set,
  invalidateProject,
  invalidateAll,
  DEFAULT_TTL_MS: FIVE_MINUTES_MS,
};
