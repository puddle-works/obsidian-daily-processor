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

## Finishing the draft

1. Replace the `run` stub in `extensions/models/obsidian_daily_processor.ts` with the
   real behaviour. Keep the argument names: the workflow and the requester's
   form depend on them.
2. Give `ResultSchema.items` the shape of the output above, and add tests for
   the behaviour to `extensions/models/obsidian_daily_processor_test.ts`. Leave the
   generated tests as they are: they stub `run`, so they keep passing. Tests
   of the behaviour call `run` directly with working settings.
3. If the tests need permissions (`--allow-read`, `--allow-net`, …), add the
   same flags to the "Test it" command in `README.md` and to this app's line
   in the repo `Makefile`.
4. `deno check` and `deno test` must pass before review.
