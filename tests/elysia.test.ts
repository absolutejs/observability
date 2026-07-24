import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createManagedObservabilityRelay } from "../src/elysia";

const PROJECT_ID = "6756f6d7-8e09-4ef9-b445-ed07092748ac";
const REPLAY_ID = "874e7e96-fd31-4182-af85-534661c9ba6d";

describe("managed observability relay", () => {
  test("captures server failures through the authenticated project ingest", async () => {
    const requests: Request[] = [];
    const secret = "database-password-value";
    const app = createManagedObservabilityRelay({
      endpoint: `https://control.example/api/projects/${PROJECT_ID}/observability`,
      environment: "test",
      fetch: async (request, init) => {
        requests.push(new Request(request, init));

        return new Response(null, { status: 200 });
      },
      project: PROJECT_ID,
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
      token: "project-token",
    }).get("/server-boom", () => {
      throw new Error(`database failed with ${secret}`);
    });
    const response = await app.handle(
      new Request("http://site.test/api/observability/server-boom"),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(secret);
    expect(response.headers.get("x-trace-id")).toMatch(/^[0-9a-f]{32}$/);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://control.example/api/projects/${PROJECT_ID}/observability/errors/ingest`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer project-token",
    );
    const body = await requests[0]!.json();
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body).toMatchObject({
      environment: "test",
      project: PROJECT_ID,
      v: 1,
    });
  });

  test("captures host routes registered after the relay plugin", async () => {
    const capturedPaths: string[] = [];
    const relay = () =>
      createManagedObservabilityRelay({
        endpoint: `https://control.example/api/projects/${PROJECT_ID}/observability`,
        fetch: async (request, init) => {
          const forwarded = new Request(request, init);
          if (forwarded.url.endsWith("/errors/ingest")) {
            const body = await forwarded.json();
            capturedPaths.push(body.events[0]?.tags?.path);
          }

          return new Response(null, { status: 200 });
        },
        project: PROJECT_ID,
        token: "project-token",
      });
    const after = new Elysia().use(relay()).get("/after", () => {
      throw new Error("after failed");
    });

    expect(
      (await after.handle(new Request("http://site.test/after"))).status,
    ).toBe(500);
    expect(capturedPaths).toEqual(["/after"]);
  });

  test("authenticates browser error forwarding to the project boundary", async () => {
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
      new Request("http://site.test/api/observability/errors", {
        body: JSON.stringify({
          events: [{ message: "failed", name: "Error" }],
          project: PROJECT_ID,
          v: 1,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(requests[0]?.url).toBe(
      `https://control.example/api/projects/${PROJECT_ID}/observability/errors/ingest`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer project-token",
    );
  });

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
