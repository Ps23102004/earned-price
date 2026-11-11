// The merchant form's "build a rule by hand" path: same validator as a model's output, no model. Real database.
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  /* DATABASE_URL may come from the environment */
}
const HAVE_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAVE_DB)("buildAction (rule built by hand, no model)", () => {
  it("a valid form becomes a validated rule with a code-generated read-back", async () => {
    const { buildAction } = await import("../src/store/merchant");
    const r = await buildAction({ tiers: [{ label: "Fans", discountPercent: 15, conditions: [{ field: "followers", value: 50 }] }] });
    expect(r.status).toBe(200);
    const b = r.body as { status: string; readback: string; source: string; ruleId: string };
    expect(b.status).toBe("compiled");
    expect(b.source).toBe("built");
    expect(b.readback).toContain("15%");
  });
  it("rejects what the validator rejects: unknown field, 100% off, no conditions, more than 3 tiers", async () => {
    const { buildAction } = await import("../src/store/merchant");
    const bad = async (tiers: unknown) => ((await buildAction({ tiers })).body as { status?: string }).status;
    expect(await bad([{ label: "x", discountPercent: 15, conditions: [{ field: "country", value: 1 }] }])).toBe("invalid");
    expect(await bad([{ label: "x", discountPercent: 100, conditions: [{ field: "followers", value: 1 }] }])).toBe("invalid");
    expect(await bad([{ label: "x", discountPercent: 10, conditions: [] }])).toBe("invalid");
    const t = { label: "x", discountPercent: 10, conditions: [{ field: "followers", value: 1 }] };
    expect(await bad([t, t, t, t])).toBe("invalid");
    expect(((await buildAction({})).body as { error?: string }).error).toBeTruthy();
  });
});
