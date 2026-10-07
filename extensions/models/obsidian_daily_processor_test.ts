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
  EXTRACTION_JSON_SCHEMA,
  type GlobalArgs,
  GlobalArgsSchema,
  model,
  prepare,
  RequestSchema,
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
const SETTINGS: GlobalArgs = { vaultPath: "example", dailyNotesFolder: "example", outputFolder: "example" };

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

// --- Behaviour: prepare and run work on a real temp vault; no network. ---

const EXTRACTION: Extraction = {
  todos: ["Email Sam the invoice", "Book the boiler service"],
  permanentNotes: [
    { title: "Small notes beat big systems", body: "Capturing ideas by voice works because it costs nothing at the moment of the idea." },
  ],
};

/** A temp vault with a `Daily` folder; `days` maps YYYY-MM-DD to note text. */
function makeVault(days: Record<string, string>) {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(`${root}/Daily`);
  for (const [day, text] of Object.entries(days)) {
    Deno.writeTextFileSync(`${root}/Daily/${day}.md`, text);
  }
  const settings: GlobalArgs = { vaultPath: root, dailyNotesFolder: "Daily", outputFolder: "Processed" };
  return { root, settings };
}

const DAY = "2026-10-05";
const LOG = "Need to email Sam the invoice. Also book the boiler. Thought: voice notes work because they cost nothing.";
const vaultFiles = (root: string) => [...Deno.readDirSync(root)].map((e) => e.name);

Deno.test("prepare builds the request: prompt wraps the log, schema is the extraction schema", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const request = await prepare({ date: DAY }, vault.settings);
  assertEquals(RequestSchema.safeParse(request).success, true);
  assertEquals(request.date, DAY);
  assertEquals(request.dailyPath, `Daily/${DAY}.md`);
  assertEquals(request.prompt, `<daily_log>\n${LOG}\n</daily_log>`);
  assertEquals(request.schema, EXTRACTION_JSON_SCHEMA);
  assertEquals(request.schema.required, ["todos", "permanentNotes"]);
  assertStringIncludes(request.system, "todos");
  assertStringIncludes(request.system, "permanentNotes");
});

Deno.test("prepare with an empty date uses today in local time", async () => {
  const vault = makeVault({ "2026-10-06": LOG });
  const request = await prepare({ date: "" }, vault.settings, { now: () => new Date(2026, 9, 6, 23, 30) });
  assertEquals(request.date, "2026-10-06");
});

Deno.test("prepare still sends an empty daily note", async () => {
  const vault = makeVault({ [DAY]: "  \n" });
  const request = await prepare({ date: DAY }, vault.settings);
  assertStringIncludes(request.prompt, "<daily_log>");
});

Deno.test("prepare fails clearly when there is no daily note", async () => {
  const vault = makeVault({});
  await assertRejects(() => prepare({ date: DAY }, vault.settings), Error, `No daily note for ${DAY}`);
});

Deno.test("prepare rejects a date that is not YYYY-MM-DD", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const date of ["05/10/2026", "2026-13-01", "2026-02-30", "../../etc"]) {
    await assertRejects(() => prepare({ date }, vault.settings), Error, "YYYY-MM-DD", date);
  }
});

Deno.test("prepare rejects folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const bad of [{ dailyNotesFolder: "../elsewhere" }, { outputFolder: "/tmp" }]) {
    await assertRejects(() => prepare({ date: DAY }, { ...vault.settings, ...bad }), Error, "inside the vault");
  }
});

Deno.test("prepare leaves the daily log untouched and writes nothing else", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await prepare({ date: DAY }, vault.settings);
  assertEquals(Deno.readTextFileSync(`${vault.root}/Daily/${DAY}.md`), LOG);
  assertEquals(vaultFiles(vault.root), ["Daily"]);
});

Deno.test("prepare method writes the request resource under the name request", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const writes: Array<{ specName: string; name: string; data: Record<string, unknown> }> = [];
  const out = await model.methods.prepare.execute({ date: DAY }, {
    globalArgs: vault.settings,
    writeResource: (specName, name, data) => {
      writes.push({ specName, name, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(out.dataHandles.length, 1);
  assertEquals([writes[0].specName, writes[0].name], ["request", "request"]);
  assertEquals(writes[0].data.date, DAY);
});

Deno.test("run writes the processed note from a given answer", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const items = await run({ date: DAY, answer: EXTRACTION }, vault.settings);
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
  const items = await run({ date: "", answer: EXTRACTION }, vault.settings, { now: () => new Date(2026, 9, 6, 23, 30) });
  assertEquals(items[0].date, "2026-10-06");
});

Deno.test("run accepts empty lists and notes none found", async () => {
  const vault = makeVault({ [DAY]: "" });
  const items = await run({ date: DAY, answer: { todos: [], permanentNotes: [] } }, vault.settings);
  assertEquals(items[0].todos + items[0].permanentNotes, 0);
  assertStringIncludes(Deno.readTextFileSync(`${vault.root}/Processed/${DAY} processed.md`), "None found.");
});

Deno.test("run refuses an answer that does not match and writes nothing", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const answer of [undefined, null, { todos: "not a list" }, { todos: [], permanentNotes: [{ title: "x" }] }]) {
    await assertRejects(() => run({ date: DAY, answer }, vault.settings), Error);
  }
  assertEquals(vaultFiles(vault.root), ["Daily"]);
});

Deno.test("run never edits the daily log", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await run({ date: DAY, answer: EXTRACTION }, vault.settings);
  assertEquals(Deno.readTextFileSync(`${vault.root}/Daily/${DAY}.md`), LOG);
});

Deno.test("run rejects bad dates and folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await assertRejects(() => run({ date: "2026-02-30", answer: EXTRACTION }, vault.settings), Error, "YYYY-MM-DD");
  await assertRejects(
    () => run({ date: DAY, answer: EXTRACTION }, { ...vault.settings, outputFolder: "../out" }),
    Error,
    "inside the vault",
  );
});

Deno.test("run method takes the date plus an answer, and stores only the date as args", async () => {
  const vault = makeVault({ [DAY]: LOG });
  assertEquals(Object.keys(model.methods.run.arguments.shape).sort(), ["answer", "date"]);
  const writes: Array<{ specName: string; data: Record<string, unknown> }> = [];
  await model.methods.run.execute({ date: DAY, answer: EXTRACTION }, {
    globalArgs: vault.settings,
    writeResource: (specName, name, data) => {
      writes.push({ specName, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(writes[0].specName, "result");
  assertEquals(writes[0].data.args, { date: DAY });
  assertEquals(ResultSchema.safeParse(writes[0].data).success, true);
});

Deno.test("result items carry the output shape", () => {
  const item = { date: DAY, path: `Processed/${DAY} processed.md`, todos: 1, permanentNotes: 0 };
  const result = { args: { date: DAY }, items: [item], ranAt: new Date().toISOString() };
  assertEquals(ResultSchema.safeParse(result).success, true);
  assertEquals(ResultSchema.safeParse({ ...result, items: [{ nope: 1 }] }).success, false);
});
