/**
 * Tests for @mesgme/obsidian-daily-processor.
 *
 * Run with the "Test it" command in puddles/obsidian-daily-processor/README.md.
 *
 * @module
 */
import { assertEquals } from "jsr:@std/assert@1";
import { assertSpyCallArgs, stub } from "jsr:@std/testing@1/mock";
import {
  behaviour,
  type GlobalArgs,
  GlobalArgsSchema,
  model,
  ResultSchema,
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
