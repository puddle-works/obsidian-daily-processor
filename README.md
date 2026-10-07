# Process Superwhisper daily log entries into structured Obsidian notes

Turn one day's daily-log note into a separate processed note that lists atomic todos and dated permanent notes (one idea each, in full sentences).

## For the requester

The app runs on a schedule. You can also run it now from puddle with the form below.

| What to enter | Kind | Default |
|---|---|---|
| Day to process, as YYYY-MM-DD. Leave empty for today. | string | empty |

**You get:** A note at <outputFolder>/<date> processed.md with the day's todos and permanent notes, plus the number of each.

## For the builder

First draft generated from the approved specification of request `obsidian-daily-processor`.
See [CLAUDE.md](CLAUDE.md) for the bounded purpose and what is out of scope.

- Extension: `@mesgme/obsidian-daily-processor` in `extensions/models/obsidian_daily_processor.ts`
- Entry point: workflow `obsidian-daily-process` in
  `workflows/workflow-obsidian-daily-process.yaml`
- Delivery method: `scheduled_workflow`

The workflow is **prepare → ask → run**:

1. `prepare` (this app) reads the day's log and stores a `request`: system prompt,
   prompt and JSON schema. It writes nothing to the vault.
2. `ask` (model instance `opencode`, type `@mesgme/opencode`) sends the request to
   an OpenCode Zen model and stores the JSON answer.
3. `run` (this app) checks the answer against its schema and writes the note. A
   bad answer writes nothing.

It depends on a model instance named `opencode` of the shared `@mesgme/opencode`
extension (see `shared/opencode/README.md`). The API key comes from a vault; the
default model is `deepseek-v4.1-flash`. Create it once:

```bash
swamp vault create local_encryption opencode    # skip if you already have a vault
swamp vault put opencode opencodeApiKey         # prompts for the OpenCode API key
swamp model create @mesgme/opencode opencode \
  --global-arg 'apiKey=${{ vault.get("opencode", "opencodeApiKey") }}' \
  --global-arg model=deepseek-v4.1-flash
```

Then create the model instance the workflow runs:

```bash
swamp model create @mesgme/obsidian-daily-processor obsidian-daily-processor \
  --global-arg vaultPath=<vaultPath> \
  --global-arg dailyNotesFolder=<dailyNotesFolder> \
  --global-arg outputFolder=<outputFolder>
```

Run it:

```bash
swamp workflow run obsidian-daily-process
```

Test it:

```bash
DENO=$(swamp doctor extensions --json | jq -r '.denoPath')
$DENO check extensions/models/obsidian_daily_processor.ts
$DENO test --allow-read --allow-write extensions/models/obsidian_daily_processor_test.ts
```
