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
`@mesgme/opencode` extension (`shared/opencode/`), not in this app.

- `prepare` (args `date`) reads the daily note and stores resource `request`
  `{ date, dailyPath, system, prompt, schema }`. The prompt wraps the log in
  `<daily_log>` tags; prompt and schema live in this app's code and are tested here.
- `ask` is the `opencode` model instance's method. It stores the JSON answer under
  data name `obsidian-daily-processor`.
- `run` (args `date`, `answer`) validates `answer` with `ExtractionSchema`, writes
  `<outputFolder>/<date> processed.md`, and stores `{date}` as `result.args`.
  `RunArgsSchema` stays exactly `{date}`; `run` only widens the method arguments.

Needs a model instance named `opencode` of `@mesgme/opencode`, key from a vault,
`model=deepseek-v4.1-flash`. Creation commands are in `README.md`. This app holds
no key and no model name.

## Finishing the draft

1. Keep `RunArgsSchema` as `{date}` and keep `run` calling
   `behaviour.run(args, globalArgs)`: the generated tests depend on it.
2. Behaviour tests live in `extensions/models/obsidian_daily_processor_test.ts`
   and use a temp vault; no network.
3. The tests read and write files, so the "Test it" command in `README.md` and the
   repo `Makefile` line carry `--allow-read --allow-write`.
4. `deno check` and `deno test` must pass before review.
