import { describe, expect, test } from "bun:test";
import { createManagedObservability } from "../src";

describe("managed Support Mode", () => {
  test("is dormant until explicitly started and uploads one correlated bundle", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = (async (input, init) => {
      requests.push(
        new Request(
          typeof input === "string"
            ? new URL(input, "https://app.example.test")
            : input,
          init,
        ),
      );
      return Response.json({ id: "support-1" });
    }) as typeof fetch;
    const observability = createManagedObservability({
      environment: "test",
      project: "support-project",
      release: "release-1",
      replay: false,
      supportIssueFingerprints: () => ["issue-one"],
      supportTraceIds: () => ["0af7651916cd43dd8448eb211c80319c"],
    });

    expect(observability.support?.snapshot().phase).toBe("idle");
    observability.support?.start("payment failed");
    observability.support?.mark("wallet opened");
    const bundle = await observability.support?.stop();
    expect(bundle?.manifest).toMatchObject({
      environment: "test",
      project: "support-project",
      release: "release-1",
    });
    await observability.support?.send();

    const upload = requests.find((request) =>
      request.url.endsWith("/api/observability/diagnostics"),
    );
    expect(upload).toBeDefined();
    const body = (await upload!.json()) as { bundle: typeof bundle };
    expect(body.bundle?.correlations.issueFingerprints).toEqual(["issue-one"]);
    expect(body.bundle?.audit.safeToShare).toBe(true);
    await observability.close();
    globalThis.fetch = originalFetch;
  });
});
