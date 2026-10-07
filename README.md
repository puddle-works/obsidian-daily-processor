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

Create the model instance the workflow runs (store each secret in a vault first):

```bash
swamp model create @mesgme/obsidian-daily-processor obsidian-daily-processor \
  --global-arg vaultPath=<vaultPath> \
  --global-arg dailyNotesFolder=<dailyNotesFolder> \
  --global-arg outputFolder=<outputFolder> \
  --global-arg 'opencodeApiKey=${{ vault.get("<vault>", "opencodeApiKey") }}'
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
