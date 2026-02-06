function detectNodeInfo() {
  const proc = typeof process === "object" ? process : undefined;
  const info = {
    platform: "node",
    runtime: "node",
    runtimeVersion: typeof proc?.versions?.node === "string" ? proc.versions.node : null,
    os: typeof proc?.platform === "string" ? proc.platform : null,
    osVersion: typeof proc?.release?.name === "string" ? proc.release.name : null,
    arch: typeof proc?.arch === "string" ? proc.arch : null,
    userAgent: null
  };

  return info;
}

function detectBrowserInfo() {
  if (typeof navigator === "undefined") {
    return null;
  }
  return {
    platform: "browser",
    runtime: navigator.product || "browser",
    runtimeVersion: navigator.appVersion || null,
    os: navigator.platform || null,
    osVersion: null,
    arch: null,
    userAgent: navigator.userAgent || null
  };
}

export function collectSystemInfo() {
  if (typeof process !== "undefined" && process && process.versions && process.versions.node) {
    return detectNodeInfo();
  }

  const browserInfo = detectBrowserInfo();
  if (browserInfo) {
    return browserInfo;
  }

  return {
    platform: "unknown",
    runtime: null,
    runtimeVersion: null,
    os: null,
    osVersion: null,
    arch: null,
    userAgent: null
  };
}
