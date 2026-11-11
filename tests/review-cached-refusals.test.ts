import { describe, expect, it } from "vitest";
import { compileSentence } from "../src/ai/compile";

describe("recorded refusals (hosted demo, AI_LIVE=0)", () => {
  it.each(["free for everyone"])("%s is a cached refusal, not 'unavailable'", async (s) => {
    const prev = process.env.AI_LIVE;
    process.env.AI_LIVE = "0";
    try {
      const r = await compileSentence(s);
      expect(r.status).toBe("refused");
      if (r.status === "refused") {
        expect(r.source).toBe("cached");
        expect(r.reasons.length).toBeGreaterThan(0);
      }
    } finally {
      if (prev === undefined) delete process.env.AI_LIVE;
      else process.env.AI_LIVE = prev;
    }
  });
  it.each(["15% off for anyone who starred our repo or lives in Canada", "20% off for students"])("%s is refused by code with a reason, not 'unavailable'", async (s) => {
    process.env.AI_LIVE = "0";
    const r = await compileSentence(s);
    expect(r.status).toBe("refused");
  });
  it("a sentence nobody recorded is still unavailable", async () => {
    process.env.AI_LIVE = "0";
    expect((await compileSentence("33% off for anyone with 77 followers on a Tuesday")).status).toBe("unavailable");
  });
});
