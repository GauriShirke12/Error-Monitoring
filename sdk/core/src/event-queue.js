const DEFAULT_BACKOFF_MS = [1000, 2000, 4000];

function noop() {
  return Promise.resolve();
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneValue(entry);
    }
    return clone;
  }
  return value;
}

/**
 * Lightweight in-memory queue that batches events and retries with backoff.
 */
export class EventQueue {
  constructor({
    sendBatch,
    flushIntervalMs,
    maxBatchSize,
    maxQueueSize,
    storageAdapter,
    isOnline,
    retryDelays
  }) {
    this._queue = [];
    this._sendBatch = typeof sendBatch === "function" ? sendBatch : noop;
    this._flushIntervalMs = flushIntervalMs ?? 5000;
    this._maxBatchSize = maxBatchSize ?? 10;
    this._maxQueueSize = maxQueueSize ?? 1000;
    this._storageAdapter = storageAdapter || null;
    this._isOnline = typeof isOnline === "function" ? isOnline : null;
    this._timerId = null;
    this._retryTimerId = null;
    this._isSending = false;
    this._currentRetryIndex = 0;
    const scheduleSource = Array.isArray(retryDelays) && retryDelays.length > 0
      ? retryDelays
      : DEFAULT_BACKOFF_MS;
    this._backoffSchedule = [...scheduleSource];
    this._pendingPromise = Promise.resolve();

    this._hydrateFromStorage();
    if (this._queue.length > 0) {
      this._scheduleFlush();
    }
  }

  setSendBatch(sendBatch) {
    this._sendBatch = typeof sendBatch === "function" ? sendBatch : noop;
  }

  setStorageAdapter(storageAdapter) {
    this._storageAdapter = storageAdapter || null;
    if (this._storageAdapter) {
      this._queue = [...this._queue, ...this._safeLoadFromStorage()];
      this._persist();
      if (this._queue.length > 0) {
        this._scheduleFlush();
      }
    }
  }

  setOnlineChecker(isOnline) {
    this._isOnline = typeof isOnline === "function" ? isOnline : null;
  }

  updateConfig({ flushIntervalMs, maxBatchSize, maxQueueSize }) {
    if (flushIntervalMs != null) {
      this._flushIntervalMs = flushIntervalMs;
      if (this._timerId != null) {
        clearTimeout(this._timerId);
        this._timerId = null;
        this._scheduleFlush();
      }
    }
    if (maxBatchSize != null) {
      this._maxBatchSize = maxBatchSize;
    }
    if (maxQueueSize != null) {
      this._maxQueueSize = maxQueueSize;
      if (this._queue.length > this._maxQueueSize) {
        this._queue = this._queue.slice(-this._maxQueueSize);
        this._persist();
      }
    }
  }

  enqueue(event) {
    if (this._queue.length >= this._maxQueueSize) {
      this._queue.shift();
    }
    const stored = cloneValue(event);
    this._queue.push(stored);
    this._persist();

    if (this._queue.length >= this._maxBatchSize && !this._isSending) {
      this.flush({ force: true });
    } else {
      this._scheduleFlush();
    }

    return stored;
  }

  flush({ force = false } = {}) {
    if (this._queue.length === 0) {
      this._clearTimer();
      this._cancelRetryTimer();
      this._persist();
      return Promise.resolve();
    }

    if (this._isSending && !force) {
      return this._pendingPromise;
    }

    if (this._isOnline && !this._isOnline()) {
      this._scheduleFlush();
      return Promise.resolve();
    }

    if (this._retryTimerId != null) {
      clearTimeout(this._retryTimerId);
      this._retryTimerId = null;
    }

    const batch = this._queue.splice(0, this._maxBatchSize);
    if (batch.length === 0) {
      return Promise.resolve();
    }

    this._isSending = true;

    const sendPromise = Promise.resolve()
      .then(() => this._sendBatch([...batch]))
      .then(() => {
        this._isSending = false;
        this._currentRetryIndex = 0;
        this._persist();
        if (this._queue.length > 0) {
          return this.flush({ force: true });
        }
        this._scheduleFlush();
        return undefined;
      })
      .catch(() => {
        this._isSending = false;
        this._queue = batch.concat(this._queue);
        this._persist();

        if (this._currentRetryIndex >= this._backoffSchedule.length) {
          this._currentRetryIndex = 0;
          this._scheduleFlush();
          return undefined;
        }

        const delay = this._backoffSchedule[this._currentRetryIndex];
        this._currentRetryIndex += 1;
        this._retryTimerId = setTimeout(() => {
          this._retryTimerId = null;
          this.flush({ force: true });
        }, delay);
        return undefined;
      });

    this._pendingPromise = sendPromise;
    return sendPromise;
  }

  getBufferedEvents() {
    return this._queue.map((item) => cloneValue(item));
  }

  clear() {
    this._queue = [];
    this._cancelRetryTimer();
    this._clearTimer();
    this._persist();
  }

  size() {
    return this._queue.length;
  }

  _hydrateFromStorage() {
    if (!this._storageAdapter) {
      return;
    }
    const stored = this._safeLoadFromStorage();
    if (stored.length) {
      this._queue.push(...stored);
      if (this._queue.length > this._maxQueueSize) {
        this._queue = this._queue.slice(-this._maxQueueSize);
      }
      this._persist();
    }
  }

  _safeLoadFromStorage() {
    if (!this._storageAdapter || typeof this._storageAdapter.load !== "function") {
      return [];
    }
    try {
      const data = this._storageAdapter.load();
      return Array.isArray(data) ? data.map((entry) => cloneValue(entry)) : [];
    } catch (error) {
      return [];
    }
  }

  _persist() {
    if (!this._storageAdapter) {
      return;
    }
    try {
      if (this._queue.length === 0) {
        if (typeof this._storageAdapter.clear === "function") {
          this._storageAdapter.clear();
        } else if (typeof this._storageAdapter.save === "function") {
          this._storageAdapter.save([]);
        }
      } else if (typeof this._storageAdapter.save === "function") {
        this._storageAdapter.save(this._queue);
      }
    } catch (error) {
      // Swallow persistence errors
    }
  }

  _scheduleFlush() {
    if (this._timerId != null) {
      return;
    }
    if (this._queue.length === 0) {
      return;
    }
    this._timerId = setTimeout(() => {
      this._timerId = null;
      this.flush();
    }, this._flushIntervalMs);
  }

  _clearTimer() {
    if (this._timerId != null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _cancelRetryTimer() {
    if (this._retryTimerId != null) {
      clearTimeout(this._retryTimerId);
      this._retryTimerId = null;
    }
  }
}
