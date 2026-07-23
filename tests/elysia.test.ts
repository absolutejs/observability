import { describe, expect, test } from "bun:test";
import { createManagedObservabilityRelay } from "../src/elysia";

const PROJECT_ID = "6756f6d7-8e09-4ef9-b445-ed07092748ac";
const REPLAY_ID = "874e7e96-fd31-4182-af85-534661c9ba6d";

describe("managed observability relay", () => {
  test("keeps credentials on the replay upstream request", async () => {
    const requests: Request[] = [];
    const app = createManagedObservabilityRelay({
      endpoint: `https://control.example/api/projects/${PROJECT_ID}/observability`,
      fetch: async (request, init) => {
        requests.push(new Request(request, init));

        return new Response(null, { status: 200 });
      },
      project: PROJECT_ID,
      token: "project-token",
    });
    const response = await app.handle(
      new Request("http://site.test/api/observability/replays", {
        body: JSON.stringify({
          chunks: [{ events: [], from: 0, seq: 0, to: 0 }],
          manifest: {
            chunkCount: 1,
            durationMs: 0,
            project: PROJECT_ID,
            replayId: REPLAY_ID,
            startedAt: 1,
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://control.example/api/projects/${PROJECT_ID}/observability/replays/ingest`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer project-token",
    );
  });

  test("rejects cross-project browser payloads before forwarding", async () => {
    let forwarded = false;
    const app = createManagedObservabilityRelay({
      endpoint: `https://control.example/api/projects/${PROJECT_ID}/observability`,
      fetch: async () => {
        forwarded = true;

        return new Response(null, { status: 200 });
      },
      project: PROJECT_ID,
      token: "project-token",
    });
    const response = await app.handle(
      new Request("http://site.test/api/observability/errors", {
        body: JSON.stringify({
          events: [{ message: "failed", name: "Error" }],
          project: "97c54c57-48ab-4500-beb0-b16329490a59",
          v: 1,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(forwarded).toBe(false);
  });
});
