/**
 * Tests for @mesgme/obsidian-daily-processor.
 *
 * Run with the "Test it" command in puddles/obsidian-daily-processor/README.md.
 *
 * @module
 */
import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { assertSpyCallArgs, stub } from "jsr:@std/testing@1/mock";
import {
  behaviour,
  type Extraction,
  type GlobalArgs,
  GlobalArgsSchema,
  model,
  MODEL,
  ResultSchema,
  run,
  RunArgsSchema,
} from "./obsidian_daily_processor.ts";

/** Values for the required inputs. */
const REQUIRED = {};

/**
 * Placeholders that only need to pass the schema: these tests stub `run`.
 * Tests of the real behaviour call `run` with working settings of their own.
 */
const SETTINGS: GlobalArgs = { vaultPath: "example", dailyNotesFolder: "example", outputFolder: "example", anthropicApiKey: "example" };

Deno.test("model type matches the request", () => {
  assertEquals(model.type, "@mesgme/obsidian-daily-processor");
});

Deno.test("run arguments are exactly the specification inputs", () => {
  assertEquals(Object.keys(RunArgsSchema.shape).sort(), ["date"]);
});

Deno.test("run arguments apply the specification defaults", () => {
  assertEquals(RunArgsSchema.parse(REQUIRED), { date: "" });
});

Deno.test("run arguments reject values of the wrong type", () => {
  const wrong: Array<[string, unknown]> = [
    ["date", 1],
  ];
  for (const [name, value] of wrong) {
    assertEquals(RunArgsSchema.safeParse({ ...REQUIRED, [name]: value }).success, false, name);
  }
});

Deno.test("every setting must be set", () => {
  assertEquals(GlobalArgsSchema.safeParse({}).success, false);
  assertEquals(GlobalArgsSchema.safeParse(SETTINGS).success, true);
});

Deno.test("anthropicApiKey is marked sensitive", () => {
  assertEquals(GlobalArgsSchema.shape.anthropicApiKey.meta()?.sensitive, true);
});

Deno.test("run writes one result resource with the arguments it ran with", async () => {
  using runStub = stub(behaviour, "run", () => Promise.resolve([]));
  const args = RunArgsSchema.parse(REQUIRED);
  const writes: Array<{ specName: string; data: Record<string, unknown> }> = [];
  const out = await model.methods.run.execute(args, {
    globalArgs: SETTINGS,
    writeResource: (specName, name, data) => {
      writes.push({ specName, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(out.dataHandles.length, 1);
  assertSpyCallArgs(runStub, 0, [args, SETTINGS]);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].specName, "result");
  assertEquals(writes[0].data.args, args);
  assertEquals(ResultSchema.safeParse(writes[0].data).success, true);
});

// --- Behaviour: run reads a real temp vault and talks to a fake Messages API. ---

const EXTRACTION: Extraction = {
  todos: ["Email Sam the invoice", "Book the boiler service"],
  permanentNotes: [
    { title: "Small notes beat big systems", body: "Capturing ideas by voice works because it costs nothing at the moment of the idea." },
  ],
};

interface Vault {
  settings: GlobalArgs;
  root: string;
}

/** A temp vault with a `Daily` folder; `days` maps YYYY-MM-DD to note text. */
function makeVault(days: Record<string, string>): Vault {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(`${root}/Daily`);
  for (const [day, text] of Object.entries(days)) {
    Deno.writeTextFileSync(`${root}/Daily/${day}.md`, text);
  }
  return {
    root,
    settings: { vaultPath: root, dailyNotesFolder: "Daily", outputFolder: "Processed", anthropicApiKey: "test-key" },
  };
}

interface Call {
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that answers every Messages API call with `reply` and records the requests. */
function fakeApi(reply: Partial<Record<string, unknown>> = {}) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    calls.push({ headers: req.headers, body: await req.json() });
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: MODEL,
      content: [{ type: "text", text: JSON.stringify(EXTRACTION) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      ...reply,
    });
  };
  return { calls, fetch };
}

const DAY = "2026-10-05";
const LOG = "Need to email Sam the invoice. Also book the boiler. Thought: voice notes work because they cost nothing.";

Deno.test("run writes the processed note for the given day", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const api = fakeApi();
  const items = await run({ date: DAY }, vault.settings, { fetch: api.fetch });

  assertEquals(items, [{ date: DAY, path: `Processed/${DAY} processed.md`, todos: 2, permanentNotes: 1 }]);
  const note = Deno.readTextFileSync(`${vault.root}/Processed/${DAY} processed.md`);
  assertStringIncludes(note, "- [ ] Email Sam the invoice");
  assertStringIncludes(note, "- [ ] Book the boiler service");
  assertStringIncludes(note, "### Small notes beat big systems");
  assertStringIncludes(note, DAY);
  assertStringIncludes(note, "Capturing ideas by voice works");
});

Deno.test("run with an empty date processes today", async () => {
  const vault = makeVault({ "2026-10-06": LOG });
  const api = fakeApi();
  const items = await run({ date: "" }, vault.settings, {
    fetch: api.fetch,
    now: () => new Date(2026, 9, 6, 23, 30),
  });
  assertEquals(items[0].date, "2026-10-06");
});

Deno.test("run leaves the daily log untouched", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await run({ date: DAY }, vault.settings, { fetch: fakeApi().fetch });
  assertEquals(Deno.readTextFileSync(`${vault.root}/Daily/${DAY}.md`), LOG);
});

Deno.test("run sends the day's log to the Messages API with structured output", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const api = fakeApi();
  await run({ date: DAY }, vault.settings, { fetch: api.fetch });

  assertEquals(api.calls.length, 1);
  const { headers, body } = api.calls[0];
  assertEquals(headers.get("x-api-key"), "test-key");
  assertStringIncludes(headers.get("anthropic-beta") ?? "", "server-side-fallback-2026-07-01");
  assertEquals(body.model, MODEL);
  assertEquals(body.fallbacks, "default");
  assertEquals((body.output_config as { format: { type: string } }).format.type, "json_schema");
  assertStringIncludes(JSON.stringify(body.messages), "email Sam the invoice");
});

Deno.test("run fails clearly when there is no daily note for the day", async () => {
  const vault = makeVault({});
  const api = fakeApi();
  await assertRejects(
    () => run({ date: DAY }, vault.settings, { fetch: api.fetch }),
    Error,
    `No daily note for ${DAY}`,
  );
  assertEquals(api.calls.length, 0);
});

Deno.test("run rejects a date that is not YYYY-MM-DD", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const date of ["05/10/2026", "2026-13-01", "2026-02-30", "../../etc"]) {
    await assertRejects(() => run({ date }, vault.settings, { fetch: fakeApi().fetch }), Error, "YYYY-MM-DD", date);
  }
});

Deno.test("run rejects folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const bad of [{ dailyNotesFolder: "../elsewhere" }, { outputFolder: "/tmp" }]) {
    await assertRejects(
      () => run({ date: DAY }, { ...vault.settings, ...bad }, { fetch: fakeApi().fetch }),
      Error,
      "inside the vault",
    );
  }
});

Deno.test("run writes nothing when the model declines", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const api = fakeApi({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "no" } });
  await assertRejects(() => run({ date: DAY }, vault.settings, { fetch: api.fetch }), Error, "declined");
  assertEquals([...Deno.readDirSync(vault.root)].map((e) => e.name), ["Daily"]);
});

Deno.test("run on an empty daily note skips the API and records nothing found", async () => {
  const vault = makeVault({ [DAY]: "  \n" });
  const api = fakeApi();
  const items = await run({ date: DAY }, vault.settings, { fetch: api.fetch });
  assertEquals(api.calls.length, 0);
  assertEquals(items[0].todos + items[0].permanentNotes, 0);
});

Deno.test("result items carry the output shape", () => {
  const item = { date: DAY, path: `Processed/${DAY} processed.md`, todos: 1, permanentNotes: 0 };
  const result = { args: { date: DAY }, items: [item], ranAt: new Date().toISOString() };
  assertEquals(ResultSchema.safeParse(result).success, true);
  assertEquals(ResultSchema.safeParse({ ...result, items: [{ nope: 1 }] }).success, false);
});
