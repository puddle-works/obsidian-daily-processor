/**
 * Tests for @puddleworks/obsidian-daily-processor.
 *
 * Run with: make test
 *
 * @module
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { parse as parseYaml } from "jsr:@std/yaml@1";
import { Validator } from "npm:@cfworker/json-schema@4.1.1";
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
import { fingerprint } from "https://raw.githubusercontent.com/puddle-works/puddle-tooling/23e7e0b0aef150e6acde783906ca0ee177a554ce/fingerprint/fingerprint.ts";

/** Values for the required inputs. */
const REQUIRED = {};

/**
 * Placeholders that only need to pass the schema: these tests stub `run`.
 * Tests of the real behaviour call `run` with working settings of their own.
 */
const SETTINGS: GlobalArgs = {
  vaultPath: "example",
  dailyNotesFolder: "example",
  outputFolder: "example",
};

Deno.test("model type matches the request", () => {
  assertEquals(model.type, "@puddleworks/obsidian-daily-processor");
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
    assertEquals(
      RunArgsSchema.safeParse({ ...REQUIRED, [name]: value }).success,
      false,
      name,
    );
  }
});

/** A logger that drops everything, for tests that do not look at logs. */
const QUIET = { info: () => {} };

/** A logger that records each line. */
function recordingLogger() {
  const lines: Array<{ message: string; props?: Record<string, unknown> }> =
    [];
  return {
    lines,
    logger: {
      info: (message: string, props?: Record<string, unknown>) => {
        lines.push({ message, props });
      },
    },
  };
}

Deno.test("every setting must be set", () => {
  assertEquals(GlobalArgsSchema.safeParse({}).success, false);
  assertEquals(GlobalArgsSchema.safeParse(SETTINGS).success, true);
});

Deno.test("run writes one result resource with the arguments it ran with", async () => {
  using runStub = stub(behaviour, "run", () => Promise.resolve([]));
  const args = { ...RunArgsSchema.parse(REQUIRED), fingerprint: "sha256:x" };
  const writes: Array<{ specName: string; data: Record<string, unknown> }> = [];
  const out = await model.methods.run.execute(args, {
    globalArgs: SETTINGS,
    logger: QUIET,
    writeResource: (specName, name, data) => {
      writes.push({ specName, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(out.dataHandles.length, 1);
  assertSpyCallArgs(runStub, 0, [args, SETTINGS]);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].specName, "result");
  assertEquals(writes[0].data.args, { date: "" });
  assertEquals(ResultSchema.safeParse(writes[0].data).success, true);
});

// --- Behaviour: prepare and run work on a real temp vault; no network. ---

const EXTRACTION: Extraction = {
  todos: ["Email Sam the invoice", "Book the boiler service"],
  permanentNotes: [
    {
      title: "Small notes beat big systems",
      body:
        "Capturing ideas by voice works because it costs nothing at the moment of the idea.",
    },
  ],
};

/** A temp vault with a `Daily` folder; `days` maps YYYY-MM-DD to note text. */
function makeVault(days: Record<string, string>) {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(`${root}/Daily`);
  for (const [day, text] of Object.entries(days)) {
    Deno.writeTextFileSync(`${root}/Daily/${day}.md`, text);
  }
  const settings: GlobalArgs = {
    vaultPath: root,
    dailyNotesFolder: "Daily",
    outputFolder: "Processed",
  };
  return { root, settings };
}

const DAY = "2026-10-05";
const LOG =
  "Need to email Sam the invoice. Also book the boiler. Thought: voice notes work because they cost nothing.";
const LOG_FP = await fingerprint(LOG);
const vaultFiles = (root: string) =>
  [...Deno.readDirSync(root)].map((e) => e.name);

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
  const request = await prepare({ date: "" }, vault.settings, {
    now: () => new Date(2026, 9, 6, 23, 30),
  });
  assertEquals(request.date, "2026-10-06");
});

Deno.test("prepare still sends an empty daily note", async () => {
  const vault = makeVault({ [DAY]: "  \n" });
  const request = await prepare({ date: DAY }, vault.settings);
  assertStringIncludes(request.prompt, "<daily_log>");
});

Deno.test("prepare fails clearly when there is no daily note", async () => {
  const vault = makeVault({});
  await assertRejects(
    () => prepare({ date: DAY }, vault.settings),
    Error,
    `No daily note for ${DAY}`,
  );
});

Deno.test("prepare rejects a date that is not YYYY-MM-DD", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (const date of ["05/10/2026", "2026-13-01", "2026-02-30", "../../etc"]) {
    await assertRejects(
      () => prepare({ date }, vault.settings),
      Error,
      "YYYY-MM-DD",
      date,
    );
  }
});

Deno.test("prepare rejects folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (
    const bad of [{ dailyNotesFolder: "../elsewhere" }, {
      outputFolder: "/tmp",
    }]
  ) {
    await assertRejects(
      () => prepare({ date: DAY }, { ...vault.settings, ...bad }),
      Error,
      "inside the vault",
    );
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
  const writes: Array<
    { specName: string; name: string; data: Record<string, unknown> }
  > = [];
  const out = await model.methods.prepare.execute({ date: DAY }, {
    globalArgs: vault.settings,
    logger: QUIET,
    writeResource: (specName, name, data) => {
      writes.push({ specName, name, data });
      return Promise.resolve({ name });
    },
  });
  assertEquals(out.dataHandles.length, 1);
  assertEquals([writes[0].specName, writes[0].name], ["request", "request"]);
  assertEquals(writes[0].data.date, DAY);
});

Deno.test("prepare puts the log's fingerprint in the request", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const request = await prepare({ date: DAY }, vault.settings);
  assertEquals(request.fingerprint, await fingerprint(LOG));
});

Deno.test("run after the log was edited fails and writes no note", async () => {
  const vault = makeVault({ [DAY]: LOG });
  Deno.writeTextFileSync(`${vault.root}/Daily/${DAY}.md`, LOG + "\nMore.");
  await assertRejects(
    () =>
      run(
        { date: DAY, answer: EXTRACTION, fingerprint: LOG_FP },
        vault.settings,
      ),
    Error,
    "changed since prepare",
  );
  assertEquals(vaultFiles(vault.root), ["Daily"]);
});

Deno.test("run fails with the no-daily-note error when the log was deleted", async () => {
  const vault = makeVault({});
  await assertRejects(
    () =>
      run(
        { date: DAY, answer: EXTRACTION, fingerprint: LOG_FP },
        vault.settings,
      ),
    Error,
    `No daily note for ${DAY}`,
  );
});

Deno.test("run without a fingerprint fails schema parse", () => {
  assertEquals(
    model.methods.run.arguments.safeParse({ date: DAY, answer: EXTRACTION })
      .success,
    false,
  );
  assertEquals(
    model.methods.run.arguments.safeParse({
      date: DAY,
      answer: EXTRACTION,
      fingerprint: "",
    }).success,
    false,
  );
});

Deno.test("run writes the processed note from a given answer", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const items = await run({
    date: DAY,
    answer: EXTRACTION,
    fingerprint: LOG_FP,
  }, vault.settings);
  assertEquals(items, [{
    date: DAY,
    path: `Processed/${DAY} processed.md`,
    todos: 2,
    permanentNotes: 1,
  }]);
  const note = Deno.readTextFileSync(
    `${vault.root}/Processed/${DAY} processed.md`,
  );
  assertStringIncludes(note, "- [ ] Email Sam the invoice");
  assertStringIncludes(note, "- [ ] Book the boiler service");
  assertStringIncludes(note, "### Small notes beat big systems");
  assertStringIncludes(note, DAY);
  assertStringIncludes(note, "Capturing ideas by voice works");
});

Deno.test("run with an empty date processes today", async () => {
  const vault = makeVault({ "2026-10-06": LOG });
  const items = await run(
    { date: "", answer: EXTRACTION, fingerprint: LOG_FP },
    vault.settings,
    {
      now: () => new Date(2026, 9, 6, 23, 30),
    },
  );
  assertEquals(items[0].date, "2026-10-06");
});

Deno.test("run accepts empty lists and notes none found", async () => {
  const vault = makeVault({ [DAY]: "" });
  const items = await run({
    date: DAY,
    fingerprint: await fingerprint(""),
    answer: { todos: [], permanentNotes: [] },
  }, vault.settings);
  assertEquals(items[0].todos + items[0].permanentNotes, 0);
  assertStringIncludes(
    Deno.readTextFileSync(`${vault.root}/Processed/${DAY} processed.md`),
    "None found.",
  );
});

Deno.test("run refuses an answer that does not match and writes nothing", async () => {
  const vault = makeVault({ [DAY]: LOG });
  for (
    const answer of [undefined, null, { todos: "not a list" }, {
      todos: [],
      permanentNotes: [{ title: "x" }],
    }]
  ) {
    await assertRejects(
      () => run({ date: DAY, answer, fingerprint: LOG_FP }, vault.settings),
      Error,
    );
  }
  assertEquals(vaultFiles(vault.root), ["Daily"]);
});

Deno.test("run never edits the daily log", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await run(
    { date: DAY, answer: EXTRACTION, fingerprint: LOG_FP },
    vault.settings,
  );
  assertEquals(Deno.readTextFileSync(`${vault.root}/Daily/${DAY}.md`), LOG);
});

Deno.test("run rejects bad dates and folders outside the vault", async () => {
  const vault = makeVault({ [DAY]: LOG });
  await assertRejects(
    () =>
      run(
        { date: "2026-02-30", answer: EXTRACTION, fingerprint: LOG_FP },
        vault.settings,
      ),
    Error,
    "YYYY-MM-DD",
  );
  await assertRejects(
    () =>
      run({ date: DAY, answer: EXTRACTION, fingerprint: LOG_FP }, {
        ...vault.settings,
        outputFolder: "../out",
      }),
    Error,
    "inside the vault",
  );
});

Deno.test("run method takes the date plus an answer, and stores only the date as args", async () => {
  const vault = makeVault({ [DAY]: LOG });
  assertEquals(Object.keys(model.methods.run.arguments.shape).sort(), [
    "answer",
    "date",
    "fingerprint",
  ]);
  const writes: Array<{ specName: string; data: Record<string, unknown> }> = [];
  await model.methods.run.execute({
    date: DAY,
    answer: EXTRACTION,
    fingerprint: LOG_FP,
  }, {
    globalArgs: vault.settings,
    logger: QUIET,
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
  const item = {
    date: DAY,
    path: `Processed/${DAY} processed.md`,
    todos: 1,
    permanentNotes: 0,
  };
  const result = {
    args: { date: DAY },
    items: [item],
    ranAt: new Date().toISOString(),
  };
  assertEquals(ResultSchema.safeParse(result).success, true);
  assertEquals(
    ResultSchema.safeParse({ ...result, items: [{ nope: 1 }] }).success,
    false,
  );
});

// --- The workflow wires prepare -> ask -> (opt-in review) -> run. ---

interface TriggerCondition {
  type: string;
  conditions?: TriggerCondition[];
}

interface WorkflowStep {
  name: string;
  guard?: string;
  dependsOn?: Array<{ step: string; condition: TriggerCondition }>;
  task: { type: string; prompt?: string; timeout?: number };
}

interface WorkflowDefinition {
  name: string;
  inputs: { properties: Record<string, { type: string; default?: unknown }> };
  jobs: Array<{ name: string; steps: WorkflowStep[] }>;
}

function loadWorkflow(): WorkflowDefinition {
  const path = new URL(
    "../../workflows/workflow-obsidian-daily-process.yaml",
    import.meta.url,
  );
  return parseYaml(Deno.readTextFileSync(path)) as WorkflowDefinition;
}

function findStep(workflow: WorkflowDefinition, name: string): WorkflowStep {
  const step = workflow.jobs.flatMap((job) => job.steps).find(
    (s) => s.name === name,
  );
  assert(step, `workflow has no step named ${name}`);
  return step;
}

Deno.test("workflow review input is an opt-in boolean, off by default", () => {
  const review = loadWorkflow().inputs.properties.review;
  assert(review, "workflow must declare a review input");
  assertEquals(review.type, "boolean");
  assertEquals(review.default, false);
});

Deno.test("workflow review step is a manual_approval gate on ask", () => {
  const step = findStep(loadWorkflow(), "review");
  assertEquals(step.task.type, "manual_approval");
  assertEquals(step.guard, "${{ !inputs.review }}");
  assertEquals(step.task.timeout, 86400);
  assertEquals(step.dependsOn, [
    { step: "ask", condition: { type: "succeeded" } },
  ]);
});

Deno.test("workflow run depends on review, accepting success or a guarded skip", () => {
  const run = findStep(loadWorkflow(), "run");
  assertEquals(run.dependsOn?.map((d) => d.step), ["review"]);
  assertEquals(run.dependsOn?.[0].condition.type, "or");
  assertEquals(
    run.dependsOn?.[0].condition.conditions?.map((c) => c.type),
    ["succeeded", "skipped"],
  );
});

Deno.test("workflow run step passes the request fingerprint", () => {
  const run = findStep(loadWorkflow(), "run") as WorkflowStep & {
    task: { inputs?: Record<string, string> };
  };
  assertEquals(
    run.task.inputs?.fingerprint,
    '${{ data.latest("obsidian-daily-processor", "request").attributes.fingerprint }}',
  );
});

Deno.test("extraction JSON Schema rejects empty todo and note strings", () => {
  const validator = new Validator(
    EXTRACTION_JSON_SCHEMA as unknown as ConstructorParameters<
      typeof Validator
    >[0],
  );
  for (
    const answer of [
      { todos: [""], permanentNotes: [] },
      { todos: [], permanentNotes: [{ title: "", body: "text" }] },
      { todos: [], permanentNotes: [{ title: "title", body: "" }] },
    ]
  ) {
    assertEquals(validator.validate(answer).valid, false);
  }
  assertEquals(
    validator.validate({ todos: [], permanentNotes: [] }).valid,
    true,
  );
});

// --- Packaging: the workflow ships in the package under the collective ---

Deno.test("workflow is named under the package's collective", () => {
  assertEquals(loadWorkflow().name, "@puddleworks/obsidian-daily-process");
});

Deno.test("manifest ships the workflow and depends on @puddleworks/opencode", () => {
  const manifest = parseYaml(
    Deno.readTextFileSync(new URL("../../manifest.yaml", import.meta.url)),
  ) as {
    name: string;
    visibility?: string;
    dependencies?: string[];
    workflows?: string[];
  };
  assertEquals(manifest.name, model.type);
  assertEquals(manifest.visibility, "public");
  assertEquals(manifest.dependencies, ["@puddleworks/opencode"]);
  assertEquals(manifest.workflows, ["workflow-obsidian-daily-process.yaml"]);
});

Deno.test("the ask step names the @puddleworks/opencode type", () => {
  const ask = findStep(loadWorkflow(), "ask") as WorkflowStep & {
    description?: string;
  };
  assertStringIncludes(String(ask.description), "@puddleworks/opencode");
});

Deno.test("methods log at info on entry and completion with structured placeholders", async () => {
  const vault = makeVault({ [DAY]: LOG });
  const write = (_s: string, name: string) => Promise.resolve({ name });

  const prepared = recordingLogger();
  await model.methods.prepare.execute({ date: DAY }, {
    globalArgs: vault.settings,
    logger: prepared.logger,
    writeResource: write,
  });
  assertEquals(prepared.lines.length, 2);
  assertEquals(prepared.lines[0].props?.date, DAY);
  assertEquals(prepared.lines[1].props?.dailyPath, `Daily/${DAY}.md`);

  const ran = recordingLogger();
  await model.methods.run.execute(
    { date: DAY, answer: EXTRACTION, fingerprint: LOG_FP },
    { globalArgs: vault.settings, logger: ran.logger, writeResource: write },
  );
  assertEquals(ran.lines.length, 2);
  assertEquals(ran.lines[0].props?.date, DAY);
  assertEquals(ran.lines[1].props?.path, `Processed/${DAY} processed.md`);
  assertEquals(ran.lines[1].props?.todos, 2);

  for (const line of [...prepared.lines, ...ran.lines]) {
    assertEquals(line.message.includes(LOG), false, "a log line holds the log");
  }
});
