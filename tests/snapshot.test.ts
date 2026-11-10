import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, snapshotHash } from "../src/facts/snapshot";
import { T0, mkGuest, mkPr, mkSnap } from "./helpers";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("canonicalJson", () => {
  it("sorts object keys, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: { z: 0, y: 1 } } })).toBe('{"a":{"c":{"y":1,"z":0},"d":1},"b":1}');
  });

  it("keeps array order and sorts keys of objects inside arrays", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ list: [{ b: 1, a: 2 }, { d: 3, c: 4 }] })).toBe('{"list":[{"a":2,"b":1},{"c":4,"d":3}]}');
  });

  it("uses default JS string order (uppercase before lowercase, '10' before '9')", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}');
    expect(canonicalJson({ 9: "x", 10: "y" })).toBe('{"10":"y","9":"x"}');
  });

  it("omits object properties whose value is undefined", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: { b: undefined, c: 2 } })).toBe('{"a":{"c":2}}');
    expect(canonicalJson({ a: undefined })).toBe("{}");
  });

  it("an undefined property and an absent property serialise identically", () => {
    expect(canonicalJson({ x: 1, label: undefined })).toBe(canonicalJson({ x: 1 }));
  });

  it("serialises primitives and null like JSON", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(-1.5)).toBe("-1.5");
    expect(canonicalJson("a\"b\n")).toBe('"a\\"b\\n"');
    expect(canonicalJson({ n: null })).toBe('{"n":null}');
  });

  it("serialises empty containers", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  it("is independent of key insertion order", () => {
    const a = { x: 1, y: { p: 1, q: 2 }, z: [1, 2] };
    const b = { z: [1, 2], y: { q: 2, p: 1 }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["nested NaN", { a: { b: Number.NaN } }],
    ["Infinity in an array", [1, Number.POSITIVE_INFINITY]],
    ["a function", () => 1],
    ["a function property", { a: () => 1 }],
    ["a symbol", Symbol("s")],
    ["a symbol property", { a: Symbol("s") }],
    ["a bigint", BigInt(1)],
    ["a bigint property", { a: BigInt(10) }],
  ])("throws on %s", (_name, value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
});

describe("snapshotHash", () => {
  it("is 64 lowercase hex characters", () => {
    expect(snapshotHash(mkSnap())).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotHash(mkGuest())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the SHA-256 of the canonical JSON (independently computed, guest snapshot)", () => {
    const expected = sha256(`{"fetchedAt":"${T0}","kind":"guest","version":1}`);
    expect(snapshotHash(mkGuest())).toBe(expected);
  });

  it("equals sha256 of canonicalJson(snapshot) for a github snapshot", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ number: 1 }), mkPr({ number: 2 })] });
    expect(snapshotHash(snap)).toBe(sha256(canonicalJson(snap)));
  });

  it("encodes as UTF-8", () => {
    const snap = mkSnap({ label: "café ☃ 日本" });
    expect(snapshotHash(snap)).toBe(sha256(canonicalJson(snap)));
    // and the canonical string really contains the non-ASCII text
    expect(canonicalJson(snap)).toContain("café ☃ 日本");
  });

  it("is deterministic", () => {
    expect(snapshotHash(mkSnap())).toBe(snapshotHash(mkSnap()));
  });

  it("is key-order independent (top level and nested)", () => {
    const a = mkSnap({ mergedPrs: [mkPr({ number: 1 })] });
    const reordered = {
      truncated: a.truncated,
      mergedPrs: a.mergedPrs.map((p) => ({ repo: { ...p.repo }, mergedAt: p.mergedAt, number: p.number, url: p.url, additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles })),
      user: { followers: a.user.followers, createdAt: a.user.createdAt, login: a.user.login, url: a.user.url, publicRepos: a.user.publicRepos, commitContributionsLastYear: a.user.commitContributionsLastYear },
      source: a.source,
      fetchedAt: a.fetchedAt,
      kind: a.kind,
      version: a.version,
    } as typeof a;
    expect(snapshotHash(reordered)).toBe(snapshotHash(a));
  });

  it("an explicit undefined property hashes like an absent one", () => {
    const withLabel = { ...mkSnap(), label: undefined, recordedAt: undefined } as unknown as ReturnType<typeof mkSnap>;
    expect(snapshotHash(withLabel)).toBe(snapshotHash(mkSnap()));
  });

  it("changes when any fact changes", () => {
    const base = snapshotHash(mkSnap());
    expect(snapshotHash(mkSnap({ user: { followers: 11 } }))).not.toBe(base);
    expect(snapshotHash(mkSnap({ fetchedAt: "2026-06-15T12:00:01.000Z" }))).not.toBe(base);
    expect(snapshotHash(mkSnap({ mergedPrs: [mkPr()] }))).not.toBe(base);
    expect(snapshotHash(mkSnap({ recordedAt: T0 }))).not.toBe(base);
  });

  it("depends on the order of mergedPrs (arrays are ordered)", () => {
    const p1 = mkPr({ number: 1 });
    const p2 = mkPr({ number: 2 });
    expect(snapshotHash(mkSnap({ mergedPrs: [p1, p2] }))).not.toBe(snapshotHash(mkSnap({ mergedPrs: [p2, p1] })));
  });

  it("throws on a non-finite number in the snapshot", () => {
    expect(() => snapshotHash(mkSnap({ user: { followers: Number.NaN } }))).toThrow();
    expect(() => snapshotHash(mkSnap({ user: { followers: Number.POSITIVE_INFINITY } }))).toThrow();
  });
});
