import { jest } from "@jest/globals";
import { EventQueue } from "../src/event-queue";

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve());
}

describe("EventQueue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("enqueues events up to maxQueueSize", () => {
    const queue = new EventQueue({
      sendBatch: jest.fn(),
      flushIntervalMs: 10000,
      maxBatchSize: 5,
      maxQueueSize: 3
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });
    queue.enqueue({ id: 3 });
    queue.enqueue({ id: 4 });

    expect(queue.size()).toBe(3);
    expect(queue.getBufferedEvents().map((event) => event.id)).toEqual([2, 3, 4]);
  });

  it("flushes automatically when reaching maxBatchSize", async () => {
    const sendBatch = jest.fn().mockResolvedValue();
    const queue = new EventQueue({
      sendBatch,
      flushIntervalMs: 1000,
      maxBatchSize: 2,
      maxQueueSize: 5
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });

    await queue.flush({ force: true });
    await flushMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(sendBatch).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
    expect(queue.size()).toBe(0);
  });

  it("defers flushing when offline", async () => {
    const sendBatch = jest.fn().mockResolvedValue();
    let online = false;
    const queue = new EventQueue({
      sendBatch,
      flushIntervalMs: 500,
      maxBatchSize: 2,
      maxQueueSize: 5,
      isOnline: () => online
    });

    queue.enqueue({ id: "offline" });
    await queue.flush({ force: true });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);

    online = true;
    await queue.flush({ force: true });
    await flushMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it("retries failed batches with backoff", async () => {
    const sendBatch = jest
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce();

    const queue = new EventQueue({
      sendBatch,
      flushIntervalMs: 500,
      maxBatchSize: 2,
      maxQueueSize: 5
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });

    await queue.flush({ force: true });
    await flushMicrotasks();
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(2);

    jest.advanceTimersByTime(1000);
    await flushMicrotasks();

    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(queue.size()).toBe(0);
  });

  it("hydrates from storage and trims to maxQueueSize", () => {
    const storage = {
      load: jest.fn(() => [{ id: 1 }, { id: 2 }, { id: 3 }]),
      save: jest.fn(),
      clear: jest.fn()
    };

    const queue = new EventQueue({
      sendBatch: jest.fn(),
      flushIntervalMs: 2000,
      maxBatchSize: 5,
      maxQueueSize: 2,
      storageAdapter: storage
    });

    expect(storage.load).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(2);
    expect(storage.save).toHaveBeenCalledWith([{ id: 2 }, { id: 3 }]);
  });

  it("merges existing queue when attaching storage later", () => {
    const storage = {
      load: jest.fn(() => [{ id: "stored" }]),
      save: jest.fn(),
      clear: jest.fn()
    };

    const queue = new EventQueue({
      sendBatch: jest.fn(),
      flushIntervalMs: 5000,
      maxBatchSize: 10,
      maxQueueSize: 5
    });

    queue.enqueue({ id: "memory" });
    queue.setStorageAdapter(storage);

    expect(storage.load).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(2);
    expect(storage.save).toHaveBeenCalledWith([{ id: "memory" }, { id: "stored" }]);
  });

  it("swallows storage load errors", () => {
    const storage = {
      load: jest.fn(() => {
        throw new Error("nope");
      }),
      save: jest.fn(),
      clear: jest.fn()
    };

    const queue = new EventQueue({
      sendBatch: jest.fn(),
      flushIntervalMs: 1000,
      maxBatchSize: 5,
      maxQueueSize: 5,
      storageAdapter: storage
    });

    expect(queue.size()).toBe(0);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("updates config, reschedules flush, and trims queue", () => {
    const sendBatch = jest.fn();
    const queue = new EventQueue({
      sendBatch,
      flushIntervalMs: 5000,
      maxBatchSize: 10,
      maxQueueSize: 4
    });

    queue.enqueue({ id: 1 });
    queue.enqueue({ id: 2 });

    const clearSpy = jest.spyOn(global, "clearTimeout");
    queue.updateConfig({ flushIntervalMs: 1000, maxQueueSize: 1 });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    expect(queue.size()).toBe(1);
  });

  it("clears timers and storage when clear is called", () => {
    const storage = {
      load: jest.fn(() => []),
      save: jest.fn(),
      clear: jest.fn()
    };
    const queue = new EventQueue({
      sendBatch: jest.fn(),
      flushIntervalMs: 500,
      maxBatchSize: 2,
      maxQueueSize: 5,
      storageAdapter: storage
    });

    queue.enqueue({ id: "a" });
    queue.clear();

    expect(queue.size()).toBe(0);
    expect(storage.clear).toHaveBeenCalledTimes(1);
  });
});
