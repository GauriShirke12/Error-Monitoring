import type {
  AutoCaptureOptions,
  ErrorContext,
  ErrorMonitor,
  ErrorMonitorConfig,
  ErrorMonitorEvent,
  TagValue
} from "@error-monitor/sdk-core";

export type { AutoCaptureOptions, ErrorMonitorConfig, ErrorMonitorEvent, ErrorContext, TagValue };

export interface AutoCaptureTarget {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

export declare const ErrorMonitorInstance: ErrorMonitor;

export declare function init(config: ErrorMonitorConfig): ErrorMonitor;
export declare function captureError(error: unknown, context?: ErrorContext): ErrorMonitorEvent | null;
export declare function setUser(user: Record<string, unknown> | null): Record<string, unknown> | null;
export declare function setTags(tags: Record<string, TagValue>, options?: { replace?: boolean }): Record<string, TagValue>;
export declare function setTag(key: string, value: TagValue): TagValue;
export declare function clearTags(): void;
export declare function addBreadcrumb(breadcrumb: Parameters<ErrorMonitor["addBreadcrumb"]>[0]): ReturnType<ErrorMonitor["addBreadcrumb"]>;
export declare function clearBreadcrumbs(): void;

export declare function configureAutoCapture(target: AutoCaptureTarget, monitor: ErrorMonitor, options?: AutoCaptureOptions): () => void;
export declare function teardownAutoCapture(): void;

declare const _default: {
  init: typeof init;
  captureError: typeof captureError;
  setUser: typeof setUser;
  setTags: typeof setTags;
  setTag: typeof setTag;
  clearTags: typeof clearTags;
  addBreadcrumb: typeof addBreadcrumb;
  clearBreadcrumbs: typeof clearBreadcrumbs;
  configureAutoCapture: typeof configureAutoCapture;
  teardownAutoCapture: typeof teardownAutoCapture;
  instance: typeof ErrorMonitorInstance;
};

export default _default;
export { ErrorMonitor } from "@error-monitor/sdk-core";
export { configureAutoCapture, teardownAutoCapture };
