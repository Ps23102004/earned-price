// ensureRule: get-or-create by sentence, safe when another request inserts first.
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../src/store/db", () => ({ query: (...a: unknown[]) => query(...a) }));

import { ensureRule } from "../src/store/rules";

beforeEach(() => query.mockReset());

describe("ensureRule", () => {
  it("returns an existing row without inserting", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "r1", version: 1 }] });
    expect(await ensureRule("default")).toEqual({ id: "r1", version: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["preset:default"]);
  });

  it("inserts with the preset sentence, rule JSON and read-back when missing", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "r2", version: 1 }] });
    expect(await ensureRule("loose")).toEqual({ id: "r2", version: 1 });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/on conflict \(sentence\) do nothing/);
    expect(params[1]).toBe("preset:loose");
    expect(JSON.parse(params[2]).tiers).toHaveLength(3);
    expect(params[3]).toMatch(/50% off/);
  });

  it("re-reads the row when the insert lost a race", async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "r3", version: 1 }] });
    expect(await ensureRule("default")).toEqual({ id: "r3", version: 1 });
  });
});
