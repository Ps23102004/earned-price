// Canonical JSON and snapshot hashing. Pure.

import { createHash } from "node:crypto";
import type { FactSnapshot } from "./types";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        // undefined array items serialize as null, like JSON.stringify
        return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        // Date, Map, class instances would all serialize as {} and collide.
        throw new Error("canonicalJson: only plain objects and arrays are supported");
      }
      const o = value as Record<string, unknown>;
      const parts = Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

export function snapshotHash(snapshot: FactSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}
