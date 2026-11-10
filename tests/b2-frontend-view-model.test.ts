import { describe, expect, it } from "vitest";
import type { ExplainView } from "../src/app/_components/types";
import {
  STAGGER_MS,
  conditionProgress,
  evidenceLabel,
  formatDate,
  revealSchedule,
  runningPriceCents,
  safeAvatarUrl,
  safeHttpUrl,
  sampleProvenance,
  sentence,
  sourceBadge,
  splitEvidence,
  usd,
} from "../src/app/_components/view-model";

const view = (applied: number | null): ExplainView => ({
  rows: [0, 1, 2].map((i) => ({
    tierId: `t${i}`,
    label: `L${i}`,
    discountPercent: 50 - i * 20,
    status: applied === null ? "not_met" : i === applied ? "applied" : i > applied ? "superseded" : "not_met",
    conditions: [],
  })),
  listCents: 4900,
  earnedCents: applied === null ? 4900 : 2450,
  discountCents: applied === null ? 0 : 2450,
  appliedTierId: applied === null ? undefined : `t${applied}`,
  evaluatedAt: "2026-11-10T00:00:00.000Z",
});

describe("money and text", () => {
  it("formats cents", () => {
    expect(usd(4900)).toBe("$49.00");
    expect(usd(2450)).toBe("$24.50");
    expect(usd(5)).toBe("$0.05");
  });
  it("capitalises read-back phrases", () => {
    expect(sentence("the account has 3 followers")).toBe("The account has 3 followers");
    expect(sentence("")).toBe("");
  });
  it("shows actual / threshold with thousands separators", () => {
    expect(conditionProgress({ actual: 640, threshold: 1000 })).toBe("640 / 1,000");
  });
});

describe("dates and provenance", () => {
  it("formats in UTC", () => {
    expect(formatDate("2026-11-10T23:59:59.000Z")).toBe("Nov 10, 2026");
    expect(formatDate("nope")).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
  it("labels samples with and without a date", () => {
    expect(sampleProvenance("2026-11-10T00:00:00.000Z")).toBe(
      "Recorded snapshot of real public data, anonymised, Nov 10, 2026",
    );
    expect(sampleProvenance()).toBe("Recorded snapshot of real public data, anonymised");
  });
  it("badges the source", () => {
    expect(sourceBadge({ source: "live" })).toBe("Live from GitHub (just now)");
    expect(sourceBadge({ source: "sample", recordedAt: "2026-11-10T00:00:00.000Z" })).toBe(
      "Recorded snapshot, Nov 10, 2026",
    );
    expect(sourceBadge({ source: "guest" })).toBeNull();
  });
});

describe("tick-down", () => {
  it("staggers each row by 350 ms and puts the final line after the last row", () => {
    expect(STAGGER_MS).toBe(350);
    expect(revealSchedule(3)).toEqual({ rows: [0, 350, 700], final: 1050 });
    expect(revealSchedule(0)).toEqual({ rows: [], final: 0 });
  });
  it("keeps the list price until the applied row appears", () => {
    const v = view(1);
    expect(runningPriceCents(v, 0)).toBe(4900);
    expect(runningPriceCents(v, 1)).toBe(4900);
    expect(runningPriceCents(v, 2)).toBe(2450);
    expect(runningPriceCents(v, 4)).toBe(2450);
  });
  it("never moves when nothing applies", () => {
    expect(runningPriceCents(view(null), 4)).toBe(4900);
  });
});

describe("links and avatars", () => {
  it("only allows http(s) evidence links", () => {
    expect(safeHttpUrl("https://github.com/a/b/pull/1")).toBe("https://github.com/a/b/pull/1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
  it("labels pull requests as repo#number", () => {
    expect(evidenceLabel("https://github.com/vercel/next.js/pull/123")).toBe("vercel/next.js#123");
    expect(evidenceLabel("https://github.com/someone")).toBe("someone");
  });
  it("splits evidence into inline and the rest, dropping unsafe urls", () => {
    const urls = ["https://a.test/1", "javascript:x", "https://a.test/2", "https://a.test/3", "https://a.test/4"];
    const { shown, rest } = splitEvidence(urls, 3);
    expect(shown).toEqual(["https://a.test/1", "https://a.test/2", "https://a.test/3"]);
    expect(rest).toEqual(["https://a.test/4"]);
  });
  it("accepts only GitHub avatar urls", () => {
    expect(safeAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4")).toContain("avatars.githubusercontent.com");
    expect(safeAvatarUrl("https://evil.test/a.png")).toBeNull();
    expect(safeAvatarUrl("http://avatars.githubusercontent.com/u/1")).toBeNull();
    expect(safeAvatarUrl(undefined)).toBeNull();
  });
});
