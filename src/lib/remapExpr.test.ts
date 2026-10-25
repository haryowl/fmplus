import { describe, expect, it } from "vitest";
import { evalRemapExpr, flattenRawAttrs } from "../../server/remap-expr.mjs";

describe("evalRemapExpr", () => {
  it("scales and offsets value", () => {
    expect(evalRemapExpr("value * 0.001", { value: 12345 })).toBeCloseTo(12.345);
    expect(evalRemapExpr("value + -40", { value: 10 })).toBe(-30);
  });

  it("supports ternary and bit()", () => {
    expect(evalRemapExpr("value > 0 ? 1 : 0", { value: 4 })).toBe(1);
    expect(evalRemapExpr("value > 0 ? 1 : 0", { value: 0 })).toBe(0);
    expect(evalRemapExpr("bit(value, 3)", { value: 8 })).toBe(true);
    expect(evalRemapExpr("bit(value, 2)", { value: 8 })).toBe(false);
  });

  it("reads other packet keys from vars", () => {
    expect(evalRemapExpr("io.239 == 1 ? value * 0.1 : 0", { value: 50, "io.239": 1 })).toBe(5);
    expect(evalRemapExpr("io.239 == 1 ? value * 0.1 : 0", { value: 50, "io.239": 0 })).toBe(0);
  });

  it("rejects scripts and unknown names", () => {
    expect(() => evalRemapExpr("value; process.exit(1)", { value: 1 })).toThrow(/unexpected/);
    expect(() => evalRemapExpr("window.alert(1)", { value: 1 })).toThrow(/unknown/);
    expect(() => evalRemapExpr("value(".repeat(20), { value: 1 })).toThrow();
  });
});

describe("flattenRawAttrs", () => {
  it("flattens io / tag / add nests", () => {
    const flat = flattenRawAttrs({
      ignition: 1,
      io: { "239": 1, "16": 99 },
      tags: { "0x01": 7 },
    });
    expect(flat.ignition).toBe(1);
    expect(flat["io.239"]).toBe(1);
    expect(flat["io.16"]).toBe(99);
    expect(flat["tag.0x01"]).toBe(7);
  });
});
