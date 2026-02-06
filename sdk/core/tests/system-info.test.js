import { afterEach, describe, expect, it, jest } from "@jest/globals";

const originalProcess = global.process;
const hadNavigator = Object.prototype.hasOwnProperty.call(global, "navigator");
const originalNavigator = hadNavigator ? global.navigator : undefined;

afterEach(() => {
  global.process = originalProcess;
  if (hadNavigator) {
    global.navigator = originalNavigator;
  } else {
    delete global.navigator;
  }
  jest.resetModules();
});

describe("collectSystemInfo", () => {
  it("returns node metadata when running under Node.js", async () => {
    await jest.isolateModulesAsync(async () => {
      global.process = originalProcess;
      const module = await import("../src/system-info.js");
      const info = module.collectSystemInfo();

      expect(info.platform).toBe("node");
      expect(info.runtime).toBe("node");
      expect(info.userAgent).toBeNull();
    });
  });

  it("inspects navigator when process lacks node runtime", async () => {
    await jest.isolateModulesAsync(async () => {
      global.process = { versions: {} };
      global.navigator = {
        product: "Gecko",
        appVersion: "1.0",
        platform: "Web",
        userAgent: "UnitTest/1.0"
      };

      const module = await import("../src/system-info.js");
      const info = module.collectSystemInfo();

      expect(info.platform).toBe("browser");
      expect(info.runtime).toBe("Gecko");
      expect(info.userAgent).toBe("UnitTest/1.0");
    });
  });

  it("falls back to unknown metadata when neither node nor navigator are available", async () => {
    await jest.isolateModulesAsync(async () => {
      global.process = null;
      delete global.navigator;

      const module = await import("../src/system-info.js");
      const info = module.collectSystemInfo();

      expect(info.platform).toBe("unknown");
      expect(info.runtime).toBeNull();
      expect(info.userAgent).toBeNull();
    });
  });
});
