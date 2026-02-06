import { describe, expect, it } from "@jest/globals";
import { deepFreeze, isPlainObject } from "../src/utils.js";

describe("utils", () => {
  it("identifies plain objects correctly", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(42)).toBe(false);
  });

  it("deep freezes nested structures", () => {
    const payload = {
      user: { id: "u-1" },
      tags: { feature: "checkout" },
      breadcrumbs: [{ message: "clicked", data: { step: 1 } }]
    };

    const frozen = deepFreeze(payload);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.user)).toBe(true);
    expect(Object.isFrozen(frozen.tags)).toBe(true);
    expect(Object.isFrozen(frozen.breadcrumbs)).toBe(true);
    expect(Object.isFrozen(frozen.breadcrumbs[0])).toBe(true);

    expect(() => {
      frozen.user.id = "mutated";
    }).toThrow(TypeError);

    expect(() => {
      frozen.breadcrumbs[0].data.step = 2;
    }).toThrow(TypeError);
  });

  it("returns non-object values untouched", () => {
    expect(deepFreeze("hello")).toBe("hello");
    expect(deepFreeze(123)).toBe(123);
    const symbol = Symbol("token");
    expect(deepFreeze(symbol)).toBe(symbol);
  });
});
