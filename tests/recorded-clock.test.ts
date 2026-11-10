import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "../src/rules/evaluate";
import { price } from "../src/rules/price";
import { DAY, daysBefore, makeExampleRule, mkGuest, mkPr, mkSnap } from "./helpers";

const RECORDED = "2026-06-15T12:00:00.000Z";
const FETCHED = "2026-06-20T08:00:00.000Z";
const EARLY = new Date("2020-01-01T00:00:00.000Z");
const LATE = new Date("2035-06-01T00:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

function recorded() {
  return mkSnap({
    fetchedAt: FETCHED,
    recordedAt: RECORDED,
    user: { createdAt: daysBefore(RECORDED, 1100) },
    // merged this calendar year relative to RECORDED; would NOT count under a 2035 clock
    mergedPrs: [mkPr({ number: 1, mergedAt: "2026-03-01T00:00:00.000Z", repo: { stars: 5000 } })],
  });
}

function runAt(when: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(when);
  const rule = makeExampleRule();
  const result = evaluate(rule, recorded());
  return { result, priced: price(rule, result, 4900) };
}

describe("recorded snapshots evaluate on a frozen clock (acceptance check 3)", () => {
  it("gives identical results whatever the real current date", () => {
    const early = runAt(EARLY);
    const late = runAt(LATE);
    expect(late.result).toEqual(early.result);
    expect(late.priced).toEqual(early.priced);
  });

  it("the frozen clock is recordedAt", () => {
    expect(runAt(LATE).result.now).toBe(RECORDED);
    expect(runAt(EARLY).result.now).toBe(RECORDED);
  });

  it("the outcome is the full-qualification result under both real dates", () => {
    for (const when of [EARLY, LATE]) {
      const { result, priced } = runAt(when);
      expect(result.appliedTierId).toBe("t1");
      expect(priced.earnedCents).toBe(2450);
      const ages = result.tiers.flatMap((t) => t.conditions).filter((c) => c.field === "account_age_days");
      expect(ages.map((c) => c.actual)).toEqual([1100]);
    }
  });

  it("matches a run with real timers", () => {
    const rule = makeExampleRule();
    vi.useRealTimers();
    const real = evaluate(rule, recorded());
    expect(runAt(LATE).result).toEqual(real);
  });

  it("an explicit now still overrides the recorded clock, regardless of the real date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY);
    const forced = new Date("2027-01-01T00:00:00.000Z");
    const a = evaluate(makeExampleRule(), recorded(), forced);
    vi.setSystemTime(LATE);
    const b = evaluate(makeExampleRule(), recorded(), forced);
    expect(a).toEqual(b);
    expect(a.now).toBe("2027-01-01T00:00:00.000Z");
    // year_start is now 2027, so the 2026 PR no longer counts for the 50% tier
    expect(a.appliedTierId).not.toBe("t1");
  });

  it("without recordedAt the clock is fetchedAt, still not the real date", () => {
    const snap = mkSnap({
      fetchedAt: FETCHED,
      user: { createdAt: daysBefore(FETCHED, 500) },
      mergedPrs: [mkPr({ mergedAt: "2026-03-01T00:00:00.000Z" })],
    });
    vi.useFakeTimers();
    vi.setSystemTime(EARLY);
    const a = evaluate(makeExampleRule(), snap);
    vi.setSystemTime(LATE);
    const b = evaluate(makeExampleRule(), snap);
    expect(a).toEqual(b);
    expect(a.now).toBe(FETCHED);
    expect(Math.floor((Date.parse(FETCHED) - Date.parse(snap.user.createdAt)) / DAY)).toBe(500);
  });

  it("a guest snapshot is also independent of the real date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY);
    const a = evaluate(makeExampleRule(), mkGuest());
    vi.setSystemTime(LATE);
    const b = evaluate(makeExampleRule(), mkGuest());
    expect(a).toEqual(b);
    expect(a.now).toBe("2026-06-15T12:00:00.000Z");
  });
});
