import type { Contracts } from "https://raw.githubusercontent.com/puddle-works/puddle-tooling/v0.2.1/contracts/check.ts";
import { model as dailyProcessor } from "./extensions/models/obsidian_daily_processor.ts";
// The published @puddleworks/opencode 2026.10.27.1, by commit.
import { model as opencode } from "https://raw.githubusercontent.com/puddle-works/opencode/4498e7740e723f6108b1c4e43b2f9bed89814862/extensions/models/opencode.ts";

// Maps each model instance a workflow reads with data.latest(...) to its type
// and the data names it writes.
export const CONTRACTS: Contracts = {
  "obsidian-daily-processor": {
    model: dailyProcessor,
    data: { request: "request", result: "result" },
  },
  // `ask` stores its answer under the caller's `name` input, so any data name
  // is an answer.
  "opencode": { model: opencode, data: { "*": "answer" } },
};
