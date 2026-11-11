// The recorded sample population for the merchant's cost preview (data/sample-accounts.json, built by
// scripts/build-sample-accounts.mts). Anonymised like the sample profiles: no logins, repo names or exact dates.

import data from "../../data/sample-accounts.json";
import type { GithubSnapshot } from "./types";

export const SAMPLE_ACCOUNTS = data as unknown as { version: 1; recordedAt: string; frame: string; accounts: GithubSnapshot[] };
