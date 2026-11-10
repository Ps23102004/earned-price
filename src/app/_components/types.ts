// Response shapes the shop page consumes (docs/specs/B2-facts-signin-price.md).

import type { ExplainView } from "@/rules/explain";

export type { ExplainCondition, ExplainRow, ExplainView } from "@/rules/explain";

export type { SampleName } from "@/facts/samples";

export type Quote = {
  orderId: string;
  listCents: number;
  earnedCents: number;
  discountCents: number;
  view?: ExplainView;
  source: "live" | "sample" | "guest";
  label?: string;
  recordedAt?: string;
  truncated: boolean;
};

export type Identity = { login: string; avatarUrl: string };
