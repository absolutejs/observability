import { expect, test } from "bun:test";
import { createManagedObservabilityRelay } from "../src/elysia";
import { withRemoteSettings } from "../src/index";

const PROJECT_ID = "6756f6d7-8e09-4ef9-b445-ed07092748ac";

test("the relay reads the platform's settings with the runtime's token", async () => {
  const seen: Array<{ authorization: string | null; url: string }> = [];
  const relay = createManagedObservabilityRelay({
    endpoint: `https://platform.test/api/projects/${PROJECT_ID}/observability`,
    fetch: async (input, init) => {
      seen.push({
        authorization: new Headers(init?.headers).get("authorization"),
        url: String(input),
      });

      return Response.json({ maskAllText: true, replay: false });
    },
    project: PROJECT_ID,
    token: "runtime-token",
  });
  const answer = await relay.handle(
    new Request("http://app.test/api/observability/config"),
  );

  expect(await answer.json()).toEqual({ maskAllText: true, replay: false });
  expect(seen).toEqual([
    {
      authorization: "Bearer runtime-token",
      url: `https://platform.test/api/projects/${PROJECT_ID}/observability/config`,
    },
  ]);
});

test("the relay says so when the platform has no settings to give", async () => {
  const relay = createManagedObservabilityRelay({
    endpoint: `https://platform.test/api/projects/${PROJECT_ID}/observability`,
    fetch: async () => new Response("nope", { status: 401 }),
    project: PROJECT_ID,
    token: "runtime-token",
  });
  const answer = await relay.handle(
    new Request("http://app.test/api/observability/config"),
  );

  expect(answer.status).toBe(502);
});

test("the platform's settings win over the app's options, and only those it sends", () => {
  const merged = withRemoteSettings(
    {
      maskAllInputs: true,
      project: PROJECT_ID,
      recordCanvas: true,
      replay: true,
      vitals: true,
    },
    { maskAllText: true, recordCanvas: false, support: false },
  );

  expect(merged).toEqual({
    maskAllInputs: true,
    maskAllText: true,
    project: PROJECT_ID,
    recordCanvas: false,
    replay: true,
    support: false,
    vitals: true,
  });
});
