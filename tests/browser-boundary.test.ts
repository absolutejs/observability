import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("browser entry boundary", () => {
  test("does not pull Effect, Errors, or Elysia into the browser graph", async () => {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../src/index.ts")],
      metafile: true,
      minify: true,
      target: "browser",
    });

    expect(result.success).toBe(true);
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    const serverRuntimeInput =
      /node_modules\/(?:@absolutejs\/errors(?:-elysia)?|effect|elysia)\//;

    expect(inputs.filter((input) => serverRuntimeInput.test(input))).toEqual(
      [],
    );

    const bytes = result.outputs.reduce(
      (total, output) => total + output.size,
      0,
    );
    // Effect alone would add a material six-figure payload. Leave normal room
    // for Beacon/Replay evolution while catching an accidental server graph.
    expect(bytes).toBeLessThan(500_000);
  });
});
