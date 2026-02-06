export type TagValue = string | number | boolean;

export interface Breadcrumb {
  message: string;
  category?: string;
  level?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}

export interface NormalizedStackFrame {
  file?: string | null;
  line?: number | null;
  column?: number | null;
  function?: string | null;
}

export interface NormalizedError {
  name: string;
  message: string;
  stack: string;
  stacktrace: NormalizedStackFrame[];
}

export interface SystemMetadata {
  platform: string | null;
  runtime: string | null;
  runtimeVersion: string | null;
  os: string | null;
  osVersion: string | null;
  arch: string | null;
  userAgent: string | null;
}

export interface ErrorMonitorEvent {
  id: string;
  apiKey: string;
  timestamp: string;
  environment: string;
  sdkVersion: string;
  system: SystemMetadata;
  sessionId: string;
  user: Record<string, unknown> | null;
  context: Record<string, unknown>;
  tags: Record<string, TagValue>;
  breadcrumbs: Breadcrumb[];
  error: NormalizedError;
}

export interface ErrorContext {
  context?: Record<string, unknown>;
  tags?: Record<string, TagValue>;
  breadcrumbs?: Breadcrumb[];
}

export interface AutoCaptureOptions {
  errors?: boolean;
  promiseRejections?: boolean;
}

export interface ScrubOptions {
  scrubFields?: string[];
  scrubPatterns?: RegExp[];
}

export type BeforeSendHook = (event: ErrorMonitorEvent) => ErrorMonitorEvent | null | undefined;
