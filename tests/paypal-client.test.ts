import { describe, it, expect } from "vitest";
import { assertSandbox, SANDBOX_HOST } from "../src/paypal/client";

describe("sandbox lock", () => {
  it("accepts only PAYPAL_ENV=sandbox", () => {
    expect(() => assertSandbox({ PAYPAL_ENV: "sandbox" })).not.toThrow();
    for (const v of [undefined, "", "live", "production", "Sandbox", " sandbox"]) {
      expect(() => assertSandbox({ PAYPAL_ENV: v })).toThrow();
    }
  });
  it("host is the sandbox host", () => {
    expect(SANDBOX_HOST).toBe("https://api-m.sandbox.paypal.com");
  });
});
