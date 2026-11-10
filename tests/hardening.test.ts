import { describe, it, expect } from "vitest";
import { canonicalJson } from "../src/facts/snapshot";
import { price } from "../src/rules/price";
import type { EvaluationResult, Rule } from "../src/rules/types";

const rule: Rule = { version: 1, tiers: [{ id: "t1", label: "x", discountPercent: 50, conditions: [{ field: "followers", op: "gte", value: 1 }] }] };
const result: EvaluationResult = { now: "2026-11-10T00:00:00.000Z", tiers: [{ tierId: "t1", label: "x", discountPercent: 50, passed: true, conditions: [] }], appliedTierId: "t1" };

describe("hardening", () => {
  it("canonicalJson rejects non-plain objects so different values cannot collide", () => {
    expect(() => canonicalJson({ d: new Date(0) })).toThrow();
    expect(() => canonicalJson(new Map())).toThrow();
  });
  it("canonicalJson accepts null-prototype objects", () => {
    const o = Object.assign(Object.create(null), { b: 1, a: 2 });
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
  });
  it("price rejects list prices above $1,000,000", () => {
    expect(() => price(rule, result, 100_000_001)).toThrow();
    expect(price(rule, result, 100_000_000).earnedCents).toBe(50_000_000);
  });
});
