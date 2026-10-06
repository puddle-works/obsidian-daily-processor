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
const SETTINGS: GlobalArgs = { vaultPath: "example", dailyNotesFolder: "example", outputFolder: "example", claudePath: "example" };

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

// --- Behaviour: run reads a real temp vault and runs a fake `claude` command. ---

const EXTRACTION: Extraction = {
  todos: ["Email Sam the invoice", "Book the boiler service"],
  permanentNotes: [
    { title: "Small notes beat big systems", body: "Capturing ideas by voice works because it costs nothing at the moment of the idea." },
  ],
};

/** What `claude -p --output-format json` prints when it succeeds with structured output. */
const SUCCESS = { type: "result", subtype: "success", is_error: false, stop_reason: "tool_use", result: JSON.stringify(EXTRACTION), structured_output: EXTRACTION };

/**
 * A stand-in for the Claude Code command. It records its arguments and stdin,
 * prints `reply` and exits with `code`.
 */
function fakeClaude(reply: unknown = SUCCESS, code = 0) {
  const dir = Deno.makeTempDirSync();
  const path = `${dir}/claude`;
  Deno.writeTextFileSync(`${path}.reply`, JSON.stringify(reply));
  Deno.writeTextFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.args"\ncat > "$0.stdin"\ncat "$0.reply"\nexit ${code}\n`,
  );
  Deno.chmodSync(path, 0o755);
  const read = (ext: string) => {
    try {
      return Deno.readTextFileSync(`${path}.${ext}`);
    } catch {
      return undefined;
    }
  };
  return {
    path,
    /** Arguments of the last call, or undefined if it was never called. */
    args: () => read("args")?.split("\n").slice(0, -1),
    /** Stdin of the last call. */
    stdin: () => read("stdin"),
  };
}

/** A temp vault with a `Daily` folder; `days` maps YYYY-MM-DD to note text. */
function makeVault(days: Record<string, string>, claudePath: string) {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(`${root}/Daily`);
  for (const [day, text] of Object.entries(days)) {
    Deno.writeTextFileSync(`${root}/Daily/${day}.md`, text);
  }
  const settings: GlobalArgs = { vaultPath: root, dailyNotesFolder: "Daily", outputFolder: "Processed", claudePath };
  return { root, settings };
}

const DAY = "2026-10-05";
const LOG = "Need to email Sam the invoice. Also book the boiler. Thought: voice notes work because they cost nothing.";

Deno.test("run writes the processed note for the given day", async () => {
  const vault = makeVault({ [DAY]: LOG }, fakeClaude().path);
  const items = await run({ date: DAY }, vault.settings);

  assertEquals(items, [{ date: DAY, path: `Processed/${DAY} processed.md`, todos: 2, permanentNotes: 1 }]);
  const note = Deno.readTextFileSync(`${vault.root}/Processed/${DAY} processed.md`);
  assertStringIncludes(note, "- [ ] Email Sam the invoice");
  assertStringIncludes(note, "- [ ] Book the boiler service");
  assertStringIncludes(note, "### Small notes beat big systems");
  assertStringIncludes(note, DAY);
  assertStringIncludes(note, "Capturing ideas by voice works");
});

Deno.test("run with an empty date processes today", async () => {
  const vault = makeVault({ "2026-10-06": LOG }, fakeClaude().path);
  const items = await run({ date: "" }, vault.settings, { now: () => new Date(2026, 9, 6, 23, 30) });
  assertEquals(items[0].date, "2026-10-06");
});

Deno.test("run leaves the daily log untouched", async () => {
  const vault = makeVault({ [DAY]: LOG }, fakeClaude().path);
  await run({ date: DAY }, vault.settings);
  assertEquals(Deno.readTextFileSync(`${vault.root}/Daily/${DAY}.md`), LOG);
});

Deno.test("run asks Claude Code for structured output, with no tools, and passes the log on stdin", async () => {
  const claude = fakeClaude();
  const vault = makeVault({ [DAY]: LOG }, claude.path);
  await run({ date: DAY }, vault.settings);

  const args = claude.args()!;
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assertEquals(args.includes("-p"), true);
  assertEquals(after("--output-format"), "json");
  assertEquals(after("--model"), MODEL);
  assertEquals(after("--tools"), "");
  assertEquals(args.includes("--safe-mode"), true);
  assertEquals(args.includes("--no-session-persistence"), true);
  assertEquals(JSON.parse(after("--json-schema")).required, ["todos", "permanentNotes"]);
  assertStringIncludes(claude.stdin()!, LOG);
});

Deno.test("run fails clearly when there is no daily note for the day", async () => {
  const claude = fakeClaude();
  const vault = makeVault({}, claude.path);
  await assertRejects(() => run({ date: DAY }, vault.settings), Error, `No daily note for ${DAY}`);
  assertEquals(claude.args(), undefined);
});

Deno.test("run rejects a date that is not YYYY-MM-DD", async () => {
  const vault = makeVault({ [DAY]: LOG }, fakeClaude().path);
  for (const date of ["05/10/2026", "2026-13-01", "2026-02-30", "../../etc"]) {
    await assertRejects(() => run({ date }, vault.settings), Error, "YYYY-MM-DD", date);
  }
});

Deno.test("run rejects folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG }, fakeClaude().path);
  for (const bad of [{ dailyNotesFolder: "../elsewhere" }, { outputFolder: "/tmp" }]) {
    await assertRejects(() => run({ date: DAY }, { ...vault.settings, ...bad }), Error, "inside the vault");
  }
});

Deno.test("run fails clearly when Claude Code is not at claudePath", async () => {
  const vault = makeVault({ [DAY]: LOG }, "/nonexistent/claude");
  await assertRejects(() => run({ date: DAY }, vault.settings), Error, 'No Claude Code command at "/nonexistent/claude"');
});

Deno.test("run passes on Claude Code's own error and writes nothing", async () => {
  const reply = { type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" };
  const vault = makeVault({ [DAY]: LOG }, fakeClaude(reply, 1).path);
  await assertRejects(() => run({ date: DAY }, vault.settings), Error, "Not logged in");
  assertEquals([...Deno.readDirSync(vault.root)].map((e) => e.name), ["Daily"]);
});

Deno.test("run writes nothing when Claude gives no structured answer", async () => {
  const reply = { type: "result", subtype: "success", is_error: false, stop_reason: "refusal", result: "" };
  const vault = makeVault({ [DAY]: LOG }, fakeClaude(reply).path);
  await assertRejects(() => run({ date: DAY }, vault.settings), Error, "refusal");
  assertEquals([...Deno.readDirSync(vault.root)].map((e) => e.name), ["Daily"]);
});

Deno.test("run on an empty daily note skips Claude and records nothing found", async () => {
  const claude = fakeClaude();
  const vault = makeVault({ [DAY]: "  \n" }, claude.path);
  const items = await run({ date: DAY }, vault.settings);
  assertEquals(claude.args(), undefined);
  assertEquals(items[0].todos + items[0].permanentNotes, 0);
});

Deno.test("result items carry the output shape", () => {
  const item = { date: DAY, path: `Processed/${DAY} processed.md`, todos: 1, permanentNotes: 0 };
  const result = { args: { date: DAY }, items: [item], ranAt: new Date().toISOString() };
  assertEquals(ResultSchema.safeParse(result).success, true);
  assertEquals(ResultSchema.safeParse({ ...result, items: [{ nope: 1 }] }).success, false);
});
