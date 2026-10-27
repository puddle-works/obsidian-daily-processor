<!-- BEGIN swamp managed section - DO NOT EDIT -->
# Project

This repository is managed with [swamp](https://github.com/swamp-club/swamp).

## Rules

1. **Search before you build.** When automating AWS, APIs, or any external service: (a) search community extensions with `swamp extension search <query>` — prefer `@swamp/*` official extensions first, (b) search local/installed types with `swamp behavior type search <query>`, (c) if a community extension exists, install it with `swamp extension pull <package>` instead of building from scratch, (d) extend an existing type if it covers the domain but lacks the method you need, (e) only create a custom extension behavior in `extensions/models/` as a last resort. Use the `swamp` skill for guidance. The `command/shell` behavior is ONLY for ad-hoc one-off shell commands, NEVER for wrapping CLI tools or building integrations.
2. **Extend, don't be clever.** When a behavior covers the domain but lacks the method you need, extend it with `export const extension` — don't bypass it with shell scripts, CLI tools, or multi-step hacks. One method, one purpose. Use `swamp behavior type describe <type> --json` to check available methods.
3. **Use the data model.** Once data exists in a behavior (via `lookup`, `start`, `sync`, etc.), reference it with CEL expressions. Don't re-fetch data that's already available.
4. **CEL expressions everywhere.** Wire behaviors together with CEL expressions. Always prefer `data.latest("<name>", "<dataName>").attributes.<field>` over the deprecated `model.<name>.resource.<spec>.<instance>.attributes.<field>` pattern.
5. **Verify before destructive operations.** Always `swamp behavior get <name> --json` and verify resource IDs before running delete/stop/destroy methods.
6. **Prefer fan-out methods over loops.** When operating on multiple targets, use a single method that handles all targets internally (factory pattern) rather than looping N separate `swamp behavior run` calls against the same behavior. Multiple parallel calls against the same behavior contend on the per-behavior lock, causing timeouts. A single fan-out method acquires the lock once and produces all outputs in one execution. Check `swamp behavior type describe` for methods that accept filters or produce multiple outputs.
7. **Extension npm deps are bundled; pin them.** Swamp's bundler inlines all npm packages (except zod) into extension bundles at bundle time. When the extension has a `deno.json`, the `deno.lock` beside it decides which versions are bundled; otherwise the registry's current release does. Always pin explicit versions in `npm:` and `jsr:` import specifiers (e.g., `npm:lodash-es@4.17.21`) — `swamp extension push` warns on unpinned and range specifiers.
8. **Reports for reusable data pipelines.** When the task involves building a repeatable pipeline to transform, aggregate, or analyze behavior output (security reports, cost analysis, compliance checks, summaries), create a report extension. Use the `swamp` skill for guidance.
9. **"Workflow" means a swamp workflow.** In this repository the word "workflow" (and "create/run/execute/validate/debug workflow", "automate", "orchestrate", "automated/nightly job") refers to a swamp workflow — a declarative YAML DAG of behavior-method steps authored via `swamp workflow create`. Load and follow the `swamp` skill for these requests. Do NOT interpret these as a request to build an agent task list, spin up worktrees, or schedule a cron/remote agent. Only use those orchestration mechanisms when the user explicitly names one (e.g. "task list", "subagent", "worktree", "cron", "remote agent") or explicitly asks you to do the work yourself step by step rather than author a swamp workflow.
10. **Use swamp, don't bypass it.** Always work through swamp commands — don't go around them with raw shell tools. Use `swamp data query` to find data, not `grep`/`find` on `.swamp/` files. Use behavior methods to interact with resources, not `curl`/`aws`/`gcloud`/`kubectl` when a behavior type already wraps that API — check with `swamp behavior type search`. Use `swamp help` for CLI discovery, not guesswork. Composing with swamp output is fine (e.g. piping `--json` through `jq`) — the anti-pattern is bypassing swamp entirely.
11. **Inspect reports after failures.** When a behavior method or workflow run fails, inspect its generated reports before retrying or changing definitions. Reports run even on failure and capture structured diagnostics — error messages, execution status, arguments, and data output pointers. Use `swamp report get @swamp/method-summary --model <model> --json` for method failures or `swamp report get @swamp/workflow-summary --workflow <workflow> --json` for workflow failures. Run `swamp help report get` to confirm current retrieval syntax.

## Skills

**IMPORTANT:** Always load swamp skills, even when in plan mode. The skills provide
essential context for working with this repository.

- `swamp` - Swamp CLI — behaviors, workflows, data, vaults, extensions, publishing, repos, reports, issues, and troubleshooting
- `swamp-getting-started` - Interactive onboarding for new swamp users

## Getting Started

If you were asked to read a task brief under `tasks/` (a file whose first
line is `<!-- swamp start brief v1 -->`), read that brief, then invoke the
`swamp-getting-started` skill and follow it from its brief entry point.

If the user is new to swamp or asks to get started, or a swamp command you
run shows this repository has no behaviors yet, invoke the
`swamp-getting-started` skill. It checks for existing behaviors itself and walks
new users through an interactive onboarding tutorial.

Otherwise, use the `swamp` skill to work with swamp behaviors.

## Commands

Use `swamp --help` to see available commands. For a machine-readable JSON
schema of the CLI (commands, options, arguments) intended for agent
consumption, run `swamp help [<command>...]` — e.g. `swamp help` returns
the full tree, and `swamp help behavior run` scopes to a subtree.

Behaviors (formerly models) are managed with `swamp behavior` — e.g.
`swamp behavior run <name> <method>` (or
`swamp behavior run @<type> <method> <name>` to run against a type
directly). Every `swamp model …` spelling remains supported.
<!-- END swamp managed section -->

## Puddle repo

This repo is a puddle made from `puddle-works/puddle-template` ([ADR-004][adr]).
It holds one puddle, `@puddleworks/obsidian-daily-processor`, and its workflow
`@puddleworks/obsidian-daily-process`. The AI step is the published
`@puddleworks/opencode`, pulled through `dependencies:` in `manifest.yaml`.

- `make test` runs every test in `extensions/models/`. One of them checks that
  each workflow is a `workflow-*.yaml` file with its own UUID `id`; swamp skips
  any other file without a word.
- `make contracts-check` and `make guardrails-check` run the shared checks from
  puddle-tooling. Every workflow in `workflows/` needs `maxReruns` and
  `maxWallClock` tags, and a workflow that reads another model's data with
  `data.latest` needs an entry in `contracts.ts`.
- `make publish VISIBILITY=public DRY_RUN=1` runs the publish dry run. Never
  push with `--yes`; `VISIBILITY` must equal `visibility:` in `manifest.yaml`.
- Review reports live in `swamp-extension-review/` and are committed with the
  version they review.
- The log fingerprint comes from puddle-tooling's `fingerprint/fingerprint.ts`,
  imported by URL; swamp bundles it at publish time.

[adr]: https://github.com/puddle-works/puddleworks-apps/blob/main/docs/adr/ADR-004-one-repo-per-puddle.md

# obsidian-daily-processor

Process Superwhisper daily log entries into structured Obsidian notes. Puddle request `obsidian-daily-processor`; the specification below was
approved before this draft was generated.

## Bounded purpose

Turn one day's daily-log note into a separate processed note that lists atomic todos and dated permanent notes (one idea each, in full sentences).

## Inputs (the requester's form)

- `date` (string, empty) — Day to process, as YYYY-MM-DD. Leave empty for today.

## Settings (set once per model instance)

- `vaultPath` — Absolute path of the Obsidian vault on the machine that runs the app.
- `dailyNotesFolder` — Folder inside the vault that holds the daily notes, each named YYYY-MM-DD.md.
- `outputFolder` — Folder inside the vault where processed notes are written.

## Output

A note at <outputFolder>/<date> processed.md with the day's todos and permanent notes, plus the number of each.

## Out of scope

- Extracting named entities
- Creating or updating topic notes
- Overview or summary prompts
- Adding tags or links between notes
- Editing the daily log itself
- Processing more than one day per run

Anything on this list, or anything beyond the purpose above, is a new puddle
request. Do not add it here, and do not add permissions or secrets the
settings above do not name.

## How it runs

The workflow is **prepare → ask → run**, with the AI call in the reusable
`@puddleworks/opencode` extension ([puddle-works/opencode][opencode]), not in
this app.

[opencode]: https://github.com/puddle-works/opencode

- `prepare` (args `date`) reads the daily note and stores resource `request`
  `{ date, dailyPath, system, prompt, schema }`. The prompt wraps the log in
  `<daily_log>` tags; prompt and schema live in this app's code and are tested here.
- `ask` is the `opencode` model instance's method. It stores the JSON answer under
  data name `obsidian-daily-processor`.
- `run` (args `date`, `answer`) validates `answer` with `ExtractionSchema`, writes
  `<outputFolder>/<date> processed.md`, and stores `{date}` as `result.args`.
  `RunArgsSchema` stays exactly `{date}`; `run` only widens the method arguments.

Needs a model instance named `opencode` of `@puddleworks/opencode`, key from a vault,
`model=deepseek-v4.1-flash`. Creation commands are in `README.md`. This app holds
no key and no model name.

## Finishing the draft

1. Keep `RunArgsSchema` as `{date}` and keep `run` calling
   `behaviour.run(args, globalArgs)`: the generated tests depend on it.
2. Behaviour tests live in `extensions/models/obsidian_daily_processor_test.ts`
   and use a temp vault; no network.
3. The tests read and write files, so the `Makefile` test line and CI carry
   `--allow-read --allow-write`.
4. `deno check` and `deno test` must pass before review.
