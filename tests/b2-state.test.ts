// B2 signed OAuth state: written from docs/specs/B2-facts-signin-price.md only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeReturnTo, signState, verifyState } from "../src/auth/state";

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const PAYLOAD = { nonce: "nonce-abc", sid: "sid-123", returnTo: "/receipt/x" };

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("signState format", () => {
  it("is two base64url parts separated by a dot", () => {
    const t = signState(PAYLOAD, SECRET, NOW);
    const parts = t.split(".");
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("first part decodes to JSON carrying the payload and iat = now", () => {
    const t = signState(PAYLOAD, SECRET, NOW);
    const body = JSON.parse(b64urlDecode(t.split(".")[0] ?? "")) as Record<string, unknown>;
    expect(body.nonce).toBe("nonce-abc");
    expect(body.sid).toBe("sid-123");
    expect(body.returnTo).toBe("/receipt/x");
    expect(body.iat).toBe(NOW);
  });

  it("second part is a 32-byte HMAC-SHA256 digest", () => {
    const sig = signState(PAYLOAD, SECRET, NOW).split(".")[1] ?? "";
    expect(Buffer.from(sig, "base64url")).toHaveLength(32);
  });

  it("is deterministic for the same inputs and differs by secret and by now", () => {
    expect(signState(PAYLOAD, SECRET, NOW)).toBe(signState(PAYLOAD, SECRET, NOW));
    expect(signState(PAYLOAD, SECRET, NOW)).not.toBe(signState(PAYLOAD, SECRET + "x", NOW));
    expect(signState(PAYLOAD, SECRET, NOW)).not.toBe(signState(PAYLOAD, SECRET, NOW + 1));
  });
});

describe("verifyState happy path", () => {
  it("round-trips nonce, sid and returnTo", () => {
    const out = verifyState(signState(PAYLOAD, SECRET, NOW), SECRET, NOW);
    expect(out).not.toBeNull();
    expect(out?.nonce).toBe("nonce-abc");
    expect(out?.sid).toBe("sid-123");
    expect(out?.returnTo).toBe("/receipt/x");
  });

  it("round-trips without returnTo", () => {
    const out = verifyState(signState({ nonce: "n", sid: "s" }, SECRET, NOW), SECRET, NOW);
    expect(out?.nonce).toBe("n");
    expect(out?.sid).toBe("s");
    expect(out?.returnTo).toBeUndefined();
  });

  it("round-trips unicode and dots inside values", () => {
    const out = verifyState(signState({ nonce: "n.o.n.c.e", sid: "sïd-✓", returnTo: "/a.b" }, SECRET, NOW), SECRET, NOW);
    expect(out).toMatchObject({ nonce: "n.o.n.c.e", sid: "sïd-✓", returnTo: "/a.b" });
  });

  it("defaults now to the current clock for both sign and verify", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
    const t = signState(PAYLOAD, SECRET);
    expect((JSON.parse(b64urlDecode(t.split(".")[0] ?? "")) as { iat: number }).iat).toBe(NOW);
    expect(verifyState(t, SECRET)).not.toBeNull();
    vi.setSystemTime(new Date(NOW + 600_000 + 1));
    expect(verifyState(t, SECRET)).toBeNull();
  });
});

describe("verifyState rejects", () => {
  it("a tampered payload (valid base64url JSON, original signature)", () => {
    const [payload = "", sig = ""] = signState(PAYLOAD, SECRET, NOW).split(".");
    const obj = JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
    obj.sid = "attacker-sid";
    expect(verifyState(`${b64urlEncode(JSON.stringify(obj))}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("a tampered payload that extends iat to dodge expiry", () => {
    const old = signState(PAYLOAD, SECRET, NOW - 3_600_000);
    const [payload = "", sig = ""] = old.split(".");
    const obj = JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
    obj.iat = NOW;
    expect(verifyState(`${b64urlEncode(JSON.stringify(obj))}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("a tampered signature (first character changed)", () => {
    const [payload = "", sig = ""] = signState(PAYLOAD, SECRET, NOW).split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyState(`${payload}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("a truncated signature and an extended signature", () => {
    const [payload = "", sig = ""] = signState(PAYLOAD, SECRET, NOW).split(".");
    expect(verifyState(`${payload}.${sig.slice(0, -4)}`, SECRET, NOW)).toBeNull();
    expect(verifyState(`${payload}.${sig}AAAA`, SECRET, NOW)).toBeNull();
    expect(verifyState(`${payload}.`, SECRET, NOW)).toBeNull();
  });

  it("the wrong secret", () => {
    expect(verifyState(signState(PAYLOAD, SECRET, NOW), "another-secret", NOW)).toBeNull();
  });

  it("an empty secret used to verify a token signed with a real secret", () => {
    expect(verifyState(signState(PAYLOAD, SECRET, NOW), "", NOW)).toBeNull();
  });
});

describe("verifyState age window", () => {
  const token = signState(PAYLOAD, SECRET, NOW);

  it("accepts exactly maxAgeMs old (default 10 minutes) and rejects 1 ms older", () => {
    expect(verifyState(token, SECRET, NOW + 600_000)).not.toBeNull();
    expect(verifyState(token, SECRET, NOW + 600_001)).toBeNull();
  });

  it("honours a custom maxAgeMs", () => {
    expect(verifyState(token, SECRET, NOW + 1000, 1000)).not.toBeNull();
    expect(verifyState(token, SECRET, NOW + 1001, 1000)).toBeNull();
    expect(verifyState(token, SECRET, NOW + 700_000, 800_000)).not.toBeNull();
  });

  it("accepts iat up to 60 s in the future and rejects beyond", () => {
    const future60 = signState(PAYLOAD, SECRET, NOW + 60_000);
    const future61 = signState(PAYLOAD, SECRET, NOW + 60_001);
    expect(verifyState(future60, SECRET, NOW)).not.toBeNull();
    expect(verifyState(future61, SECRET, NOW)).toBeNull();
  });

  it("accepts a token signed a few seconds in the past", () => {
    expect(verifyState(token, SECRET, NOW + 5_000)).not.toBeNull();
  });
});

describe("verifyState never throws and returns null for junk", () => {
  const big = "A".repeat(1_000_000);
  const junk: [string, unknown][] = [
    ["empty", ""],
    ["one part", "abcdef"],
    ["three parts", "a.b.c"],
    ["only a dot", "."],
    ["empty payload", ".abc"],
    ["empty signature", "abc."],
    ["non-base64", "!!!.???"],
    ["spaces", "hello world.foo bar"],
    ["unicode", "ünï.cödé"],
    ["huge one part", big],
    ["huge two parts", `${big}.${big}`],
    ["many dots", ".".repeat(10_000)],
    ["valid-looking base64url non-JSON", `${b64urlEncode("not json")}.${b64urlEncode("sig")}`],
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["object", { a: 1 }],
  ];

  it.each(junk)("%s", (_name, token) => {
    expect(() => verifyState(token as string, SECRET, NOW)).not.toThrow();
    expect(verifyState(token as string, SECRET, NOW)).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/receipt/x", "/receipt/x"],
    ["/a/b/c", "/a/b/c"],
    ["/?signin=failed", "/?signin=failed"],
    ["/shop?x=1&y=2", "/shop?x=1&y=2"],
    ["/" + "a".repeat(199), "/" + "a".repeat(199)], // exactly 200 chars
  ])("accepts %j", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    ["//evil.com"],
    ["//"],
    ["/\\evil.com"],
    ["/\\"],
    ["https://x"],
    ["http://evil.com/"],
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["/a:b"],
    ["/a/b:c"],
    ["/" + "a".repeat(200)], // 201 chars
    ["x".repeat(5000)],
    [""],
    ["relative/path"],
    ["evil.com"],
    [" /spaced"],
  ])("rejects %j -> /", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });

  it.each([[undefined], [null], [42], [true], [{}], [["/x"]]])("non-string %j -> /", (input) => {
    expect(safeReturnTo(input)).toBe("/");
  });
});
