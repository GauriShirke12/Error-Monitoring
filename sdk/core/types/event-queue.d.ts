export interface StorageAdapter<T = unknown> {
  load(): T[] | undefined | null;
  save(data: T[]): void;
  clear?(): void;
}

export interface EventQueueOptions<T = unknown> {
  sendBatch?: (batch: T[]) => Promise<void> | void;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  storageAdapter?: StorageAdapter<T> | null;
  isOnline?: () => boolean;
}

export interface FlushOptions {
  force?: boolean;
}

export declare class EventQueue<T = unknown> {
  constructor(options: EventQueueOptions<T>);
  enqueue(event: T): T;
  flush(options?: FlushOptions): Promise<void>;
  getBufferedEvents(): T[];
  clear(): void;
  size(): number;
  setSendBatch(sendBatch: EventQueueOptions<T>["sendBatch"]): void;
  setStorageAdapter(storageAdapter: EventQueueOptions<T>["storageAdapter"]): void;
  setOnlineChecker(isOnline: EventQueueOptions<T>["isOnline"]): void;
  updateConfig(options: Partial<Omit<EventQueueOptions<T>, "sendBatch" | "storageAdapter" | "isOnline">>): void;
}
