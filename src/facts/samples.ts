// Recorded, anonymised snapshots of real public data (built by scripts/build-samples.mts). Never fetched live.

import loophole from "../../data/samples/loophole.json";
import nearly from "../../data/samples/nearly.json";
import qualifies from "../../data/samples/qualifies.json";
import type { GithubSnapshot } from "./types";

export const SAMPLE_NAMES = ["qualifies", "nearly", "loophole"] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

const SAMPLES = { qualifies, nearly, loophole } as unknown as Record<SampleName, GithubSnapshot>;

export const isSampleName = (v: unknown): v is SampleName => typeof v === "string" && (SAMPLE_NAMES as readonly string[]).includes(v);
export const loadSample = (name: SampleName): GithubSnapshot => SAMPLES[name];
