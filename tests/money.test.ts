import { describe, expect, it } from "vitest";
import { fromPayPalValue, toPayPalValue } from "../src/paypal/money";

describe("toPayPalValue", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [10, "0.10"],
    [99, "0.99"],
    [100, "1.00"],
    [2450, "24.50"],
    [4900, "49.00"],
    [123456, "1234.56"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
  ])("%i cents -> %s", (cents, expected) => {
    expect(toPayPalValue(cents)).toBe(expected);
  });

  it.each([
    ["negative", -1],
    ["a fraction", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["above MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 1],
    ["a numeric string", "5" as unknown as number],
    ["undefined", undefined as unknown as number],
  ])("throws on %s", (_name, bad) => {
    expect(() => toPayPalValue(bad)).toThrow();
  });
});

describe("fromPayPalValue", () => {
  it.each([
    ["24.50", 2450],
    ["24.5", 2450],
    ["49", 4900],
    ["0.05", 5],
    ["0", 0],
    ["0.00", 0],
    ["0.5", 50],
    ["1234.56", 123456],
    ["49.00", 4900],
    // classic float traps; must be exact
    ["0.29", 29],
    ["1.15", 115],
    ["19.99", 1999],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("%s -> %i", (value, cents) => {
    expect(fromPayPalValue(value)).toBe(cents);
  });

  it.each([
    ["negative", "-1.00"],
    ["three decimals", "1.234"],
    ["exponent", "1e3"],
    ["empty", ""],
    ["leading space", " 1.00"],
    ["trailing space", "1.00 "],
    ["trailing newline", "1.00\n"],
    ["trailing dot", "1."],
    ["leading dot", ".5"],
    ["plus sign", "+1.00"],
    ["thousands separator", "1,000.00"],
    ["letters", "abc"],
    ["currency symbol", "$1.00"],
    ["two dots", "1.0.0"],
  ])("throws on %s (%j)", (_name, bad) => {
    expect(() => fromPayPalValue(bad)).toThrow();
  });
});

describe("money round trip", () => {
  it("fromPayPalValue(toPayPalValue(c)) === c for 0..2000", () => {
    for (let c = 0; c <= 2000; c++) expect(fromPayPalValue(toPayPalValue(c))).toBe(c);
  });

  it("round trips assorted larger values", () => {
    for (const c of [4900, 4410, 2450, 99_999, 123_456, 1_000_000_007, Number.MAX_SAFE_INTEGER]) {
      expect(fromPayPalValue(toPayPalValue(c))).toBe(c);
    }
  });

  it("toPayPalValue(fromPayPalValue(v)) normalises to two decimals", () => {
    expect(toPayPalValue(fromPayPalValue("24.5"))).toBe("24.50");
    expect(toPayPalValue(fromPayPalValue("49"))).toBe("49.00");
  });
});
