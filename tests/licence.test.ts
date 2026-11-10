import { beforeAll, describe, expect, it } from "vitest";
import { licenceKey } from "../src/licence";

beforeAll(() => {
  process.env.LICENSE_HMAC_SECRET = "test-secret-for-licence-keys";
});

describe("licenceKey", () => {
  it("is EP- followed by 20 base32 characters", () => {
    expect(licenceKey("3GG29081XY123456A")).toMatch(/^EP-[A-Z2-7]{20}$/);
  });

  it("is deterministic per capture id and differs between ids", () => {
    expect(licenceKey("CAP-1")).toBe(licenceKey("CAP-1"));
    expect(licenceKey("CAP-1")).not.toBe(licenceKey("CAP-2"));
  });

  it("depends on the secret", () => {
    const a = licenceKey("CAP-1");
    process.env.LICENSE_HMAC_SECRET = "another-secret";
    expect(licenceKey("CAP-1")).not.toBe(a);
    process.env.LICENSE_HMAC_SECRET = "test-secret-for-licence-keys";
  });

  it("refuses to run without a secret", () => {
    const saved = process.env.LICENSE_HMAC_SECRET;
    delete process.env.LICENSE_HMAC_SECRET;
    expect(() => licenceKey("CAP-1")).toThrow(/LICENSE_HMAC_SECRET/);
    process.env.LICENSE_HMAC_SECRET = saved;
  });
});
