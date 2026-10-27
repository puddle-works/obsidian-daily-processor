# @puddleworks/obsidian-daily-processor

Turn one day's dictated daily log in an Obsidian vault (for example from
Superwhisper) into a separate processed note. The note lists atomic todos and
dated permanent notes, each permanent note holding one idea in full sentences.
The original log is never changed; the result is written to a new note at
`<outputFolder>/<date> processed.md`.

An AI model does the reading, so the work is split into three steps that a
swamp workflow chains together:

1. `prepare` (this extension) reads the day's log and stores a `request`: system
   prompt, prompt and JSON schema. It writes nothing to the vault.
2. `ask` (the separate `@puddleworks/opencode` extension)
   sends the request to an OpenCode Zen model and stores its JSON answer.
3. `run` (this extension) checks the answer against its schema and writes the
   note. A bad answer writes nothing.

Nothing is tied to a particular vault, folder or model: those are settings.

## Settings

| Setting            | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `vaultPath`        | Absolute path of the Obsidian vault.                            |
| `dailyNotesFolder` | Folder inside the vault holding daily notes, named `YYYY-MM-DD.md`. |
| `outputFolder`     | Folder inside the vault where processed notes are written.      |

Both folders must be inside the vault. `date` (`YYYY-MM-DD`, empty for today)
is the only argument to `prepare` and `run`; `run` also takes the AI `answer`.

## Use it

Install the extension. This also pulls `@puddleworks/opencode` and the workflow
`@puddleworks/obsidian-daily-process`:

```bash
swamp extension pull @puddleworks/obsidian-daily-processor
```

Create the AI step once. It needs an OpenCode API key kept in a vault:

```bash
swamp vault create local_encryption opencode
swamp vault put opencode opencodeApiKey
swamp model create @puddleworks/opencode opencode \
  --global-arg 'apiKey=${{ vault.get("opencode", "opencodeApiKey") }}' \
  --global-arg model=deepseek-v4.1-flash
```

Then create the processor and run the first step:

```bash
swamp model create @puddleworks/obsidian-daily-processor obsidian-daily-processor \
  --global-arg vaultPath=/path/to/your/vault \
  --global-arg dailyNotesFolder=Daily \
  --global-arg outputFolder=Processed
swamp model method run obsidian-daily-processor prepare --input date=2026-10-07
```

Or run all three steps with the workflow, which passes the stored `request` to
`ask` and its answer to `run`:

```bash
swamp workflow run @puddleworks/obsidian-daily-process --input date=2026-10-07
```

## Review before writing (optional)

The workflow writes straight through by default. To check the AI answer before
it is written, run with `review=true`:

```bash
swamp workflow run @puddleworks/obsidian-daily-process --input review=true
swamp workflow approvals                          # find the suspended run id
swamp workflow approve @puddleworks/obsidian-daily-process review --run <run-id>
swamp workflow resume  @puddleworks/obsidian-daily-process --run <run-id>
```

The run suspends at `review`; approve it to write the note, or reject it to
stop without writing:

```bash
swamp workflow reject @puddleworks/obsidian-daily-process review --run <run-id> --reason "wrong todos"
```

A rejection writes nothing. `review=false` (the default) is unchanged.

If the daily log is edited between `prepare` and `run` (for example while the
run waits at `review`), `run` fails with "The daily log changed since prepare"
and writes nothing; run the workflow again.

## Test it

```bash
make test
make contracts-check guardrails-check
make publish VISIBILITY=public DRY_RUN=1
```
