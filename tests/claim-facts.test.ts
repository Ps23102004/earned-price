import { describe, expect, it } from "vitest";
import { claimSample } from "../src/store/refund-outcome";

describe("claimSample", () => {
  const github = { id: 1, login: "a" };
  it("uses the sample the request names", () => expect(claimSample("nearly", { github, sample: "qualifies" })).toBe("nearly"));
  it("prefers GitHub over a stale session sample when no sample is named", () => expect(claimSample(undefined, { github, sample: "qualifies" })).toBeUndefined());
  it("falls back to the session sample without GitHub", () => expect(claimSample(undefined, { sample: "qualifies" })).toBe("qualifies"));
  it("returns nothing when there is neither", () => expect(claimSample(undefined, {})).toBeUndefined());
});
