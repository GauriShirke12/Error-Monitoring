import type {
  AutoCaptureOptions,
  BeforeSendHook,
  Breadcrumb,
  ErrorContext,
  ErrorMonitorEvent,
  NormalizedError,
  NormalizedStackFrame,
  ScrubOptions,
  SystemMetadata,
  TagValue
} from "./shared";
import type {
  ErrorMonitorConfig,
  ResolvedConfig
} from "./config";
import type {
  EventQueue,
  EventQueueOptions,
  FlushOptions,
  StorageAdapter
} from "./event-queue";

export type {
  AutoCaptureOptions,
  BeforeSendHook,
  Breadcrumb,
  ErrorContext,
  ErrorMonitorConfig,
  ErrorMonitorEvent,
  EventQueueOptions,
  FlushOptions,
  NormalizedError,
  NormalizedStackFrame,
  ResolvedConfig,
  ScrubOptions,
  StorageAdapter,
  SystemMetadata,
  TagValue
};

export interface SetTagsOptions {
  replace?: boolean;
}

export declare class ErrorMonitor {
  constructor(config?: ErrorMonitorConfig);
  init(config: ErrorMonitorConfig): ErrorMonitor;
  isInitialized(): boolean;
  isEnabled(): boolean;
  getConfig(): (ResolvedConfig & { tags: Record<string, TagValue>; user: Record<string, unknown> | null; scrubFields: string[]; scrubPatterns: RegExp[] }) | null;
  setUser(user: Record<string, unknown> | null): Record<string, unknown> | null;
  setTags(tags: Record<string, TagValue>, options?: SetTagsOptions): Record<string, TagValue>;
  setTag(key: string, value: TagValue): TagValue;
  clearTags(): void;
  addBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb;
  clearBreadcrumbs(): void;
  captureError(error: unknown, context?: ErrorContext): ErrorMonitorEvent | null;
  getBufferedEvents(): ErrorMonitorEvent[];
  clearQueue(): void;
}

export declare const errorMonitor: ErrorMonitor;

export { resolveConfig, getDefaultConfig } from "./config";
export { EventQueue } from "./event-queue";

export default ErrorMonitor;
