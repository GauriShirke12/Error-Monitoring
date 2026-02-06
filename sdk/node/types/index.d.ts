import type {
  ErrorContext,
  ErrorMonitor,
  ErrorMonitorConfig,
  ErrorMonitorEvent,
  TagValue
} from "@error-monitor/sdk-core";

export type { ErrorMonitorConfig, ErrorMonitorEvent, ErrorContext, TagValue };

export interface NodeInitOptions {
  autoCapture?: boolean;
  exitOnError?: boolean;
}

export interface NodeAutoCaptureOptions {
  uncaughtException?: boolean;
  unhandledRejection?: boolean;
  exitOnError?: boolean;
}

export declare function init(config: ErrorMonitorConfig, options?: NodeInitOptions): ErrorMonitor;
export declare function captureError(error: unknown, context?: ErrorContext): ErrorMonitorEvent | null;
export declare function setUser(user: Record<string, unknown> | null): Record<string, unknown> | null;
export declare function setTags(tags: Record<string, TagValue>, options?: { replace?: boolean }): Record<string, TagValue>;
export declare function setTag(key: string, value: TagValue): TagValue;
export declare function clearTags(): void;
export declare function addBreadcrumb(breadcrumb: Parameters<ErrorMonitor["addBreadcrumb"]>[0]): ReturnType<ErrorMonitor["addBreadcrumb"]>;
export declare function clearBreadcrumbs(): void;

export declare function configureNodeAutoCapture(monitor: ErrorMonitor, options?: NodeAutoCaptureOptions): () => void;
export declare function teardownNodeAutoCapture(): void;

export declare const errorMonitor: ErrorMonitor;

declare const _default: {
  init: typeof init;
  captureError: typeof captureError;
  setUser: typeof setUser;
  setTags: typeof setTags;
  setTag: typeof setTag;
  clearTags: typeof clearTags;
  addBreadcrumb: typeof addBreadcrumb;
  clearBreadcrumbs: typeof clearBreadcrumbs;
  configureNodeAutoCapture: typeof configureNodeAutoCapture;
  teardownNodeAutoCapture: typeof teardownNodeAutoCapture;
  instance: ErrorMonitor;
};

export default _default;

export { ErrorMonitor } from "@error-monitor/sdk-core";
export { configureNodeAutoCapture, teardownNodeAutoCapture };
