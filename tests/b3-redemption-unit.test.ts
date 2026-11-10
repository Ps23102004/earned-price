import { describe, expect, it } from "vitest";
import { buyerKeysOf, effectOf } from "../src/store/redemptions";

describe("redemption effect of a state change", () => {
  it.each([
    ["captured", false, "redeem"],
    ["mismatch", false, "redeem"],
    ["mismatch", true, "redeem"], // money moved: never released
    ["failed", true, "release"],
    ["failed", false, "release"],
    ["expired", false, "release"],
    ["cancelled", false, "release"],
    ["created", false, "release"],
    ["approved", true, "release"],
    ["capturing", false, "keep"], // timeouts and unknown outcomes keep the claim
    ["refunding", false, "keep"],
  ] as const)("%s (release flag %s) -> %s", (state, flag, effect) => {
    expect(effectOf(state, flag)).toBe(effect);
  });
});

describe("buyer keys of a session", () => {
  it("github and sample keys", () => {
    expect(buyerKeysOf({ sid: "s1" })).toEqual([]);
    expect(buyerKeysOf({ sid: "s1", github: { id: 42 } })).toEqual(["github:42"]);
    expect(buyerKeysOf({ sid: "s1", sample: "qualifies" })).toEqual(["sample:qualifies:s1"]);
    expect(buyerKeysOf({ sid: "s1", github: { id: 42 }, sample: "nearly" })).toEqual(["github:42", "sample:nearly:s1"]);
  });
});
