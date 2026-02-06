import type { AutoCaptureOptions, BeforeSendHook, ScrubOptions, TagValue } from "./shared";

export interface ErrorMonitorConfig extends ScrubOptions {
  apiKey: string;
  apiUrl: string;
  environment?: string;
  enabled?: boolean;
  sampleRate?: number;
  beforeSend?: BeforeSendHook | null;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  maxBreadcrumbs?: number;
  autoCapture?: AutoCaptureOptions | null;
  tags?: Record<string, TagValue>;
  user?: Record<string, unknown> | null;
}

export interface ResolvedConfig extends Required<Omit<ErrorMonitorConfig, "beforeSend" | "autoCapture" | "tags" | "user">> {
  beforeSend: BeforeSendHook | null;
  autoCapture: Required<AutoCaptureOptions>;
  tags: Record<string, TagValue>;
  user: Record<string, unknown> | null;
}

export declare function resolveConfig(config: ErrorMonitorConfig): ResolvedConfig;
export declare function getDefaultConfig(): ResolvedConfig;
