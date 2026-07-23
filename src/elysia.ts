import { Elysia, t } from "elysia";

const HTTP_BAD_GATEWAY = 502;
const HTTP_BAD_REQUEST = 400;
const MAX_ERROR_EVENTS = 100;
const MAX_REPLAY_CHUNKS = 200;
const MAX_REPLAY_EVENTS = 10_000;

type RelayEnvironment = Record<string, string | undefined>;
export type ObservabilityRelayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ManagedObservabilityRelayOptions = {
  endpoint: string;
  fetch?: ObservabilityRelayFetch;
  project: string;
  token: string;
};

const BeaconEventSchema = t.Object({
  at: t.Optional(t.Number()),
  extra: t.Optional(t.Record(t.String(), t.Unknown())),
  level: t.Optional(
    t.Union([
      t.Literal("fatal"),
      t.Literal("error"),
      t.Literal("warning"),
      t.Literal("info"),
    ]),
  ),
  message: t.String({ maxLength: 16_384, minLength: 1 }),
  name: t.String({ maxLength: 255, minLength: 1 }),
  replayId: t.Optional(t.String({ format: "uuid" })),
  spanId: t.Optional(t.String({ maxLength: 64, minLength: 1 })),
  stack: t.Optional(t.String({ maxLength: 131_072 })),
  tags: t.Optional(t.Record(t.String(), t.String())),
  traceId: t.Optional(t.String({ maxLength: 64, minLength: 1 })),
});
const BeaconEnvelopeSchema = t.Object({
  environment: t.Optional(t.String({ maxLength: 64 })),
  events: t.Array(BeaconEventSchema, { maxItems: MAX_ERROR_EVENTS }),
  project: t.String({ format: "uuid" }),
  release: t.Optional(t.String({ maxLength: 255 })),
  v: t.Literal(1),
});
const ReplayEventSchema = t.Object({
  data: t.Unknown(),
  timestamp: t.Number(),
  type: t.Integer(),
});
const ReplayWireChunkSchema = t.Object({
  events: t.Array(ReplayEventSchema, { maxItems: MAX_REPLAY_EVENTS }),
  from: t.Integer({ minimum: 0 }),
  seq: t.Integer({ minimum: 0 }),
  to: t.Integer({ minimum: 0 }),
});
const ReplayManifestSchema = t.Object({
  chunkCount: t.Integer({ minimum: 0 }),
  durationMs: t.Integer({ minimum: 0 }),
  environment: t.Optional(t.String({ maxLength: 64 })),
  project: t.String({ format: "uuid" }),
  release: t.Optional(t.String({ maxLength: 255 })),
  replayId: t.String({ format: "uuid" }),
  startedAt: t.Integer({ minimum: 0 }),
});
const ReplayUploadSchema = t.Object({
  chunks: t.Array(ReplayWireChunkSchema, {
    maxItems: MAX_REPLAY_CHUNKS,
    minItems: 1,
  }),
  manifest: ReplayManifestSchema,
});

const normalizedEndpoint = (value: string) => {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new Error("Observability endpoint must use HTTP or HTTPS");
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  endpoint.hash = "";
  endpoint.search = "";

  return endpoint;
};

export const createManagedObservabilityRelay = (
  options: ManagedObservabilityRelayOptions,
) => {
  const endpoint = normalizedEndpoint(options.endpoint);
  const doFetch: ObservabilityRelayFetch = options.fetch ?? globalThis.fetch;
  const upstream = async (
    url: URL,
    body: unknown,
    authorization = false,
  ) => {
    const response = await doFetch(url, {
      body: JSON.stringify(body),
      headers: {
        ...(authorization
          ? { authorization: `Bearer ${options.token}` }
          : {}),
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok)
      throw new Error(`Observability upstream responded ${response.status}`);
  };

  return new Elysia({
    name: "@absolutejs/observability",
    prefix: "/api/observability",
  })
    .post(
      "/errors",
      async ({ body, status }) => {
        if (body.project !== options.project)
          return status(
            HTTP_BAD_REQUEST,
            "Observability project does not match this runtime",
          );
        try {
          await upstream(
            new URL("/api/errors/ingest", endpoint),
            body,
          );

          return { accepted: body.events.length, project: options.project };
        } catch {
          return status(HTTP_BAD_GATEWAY, "Error ingest is unavailable");
        }
      },
      { body: BeaconEnvelopeSchema },
    )
    .post(
      "/replays",
      async ({ body, status }) => {
        if (body.manifest.project !== options.project)
          return status(
            HTTP_BAD_REQUEST,
            "Replay project does not match this runtime",
          );
        try {
          await upstream(
            new URL(`${endpoint.pathname}/replays/ingest`, endpoint),
            body,
            true,
          );

          return {
            accepted: body.chunks.length,
            replayId: body.manifest.replayId,
          };
        } catch {
          return status(HTTP_BAD_GATEWAY, "Replay ingest is unavailable");
        }
      },
      { body: ReplayUploadSchema },
    );
};

export const createManagedObservabilityRelayFromEnv = (
  env: RelayEnvironment = process.env,
) => {
  const endpoint = env.ABSOLUTE_OBSERVABILITY_ENDPOINT?.trim();
  const project = env.ABSOLUTE_PROJECT_ID?.trim();
  const token = env.ABSOLUTE_OBSERVABILITY_TOKEN?.trim();
  if (!endpoint || !project || !token)
    throw new Error(
      "ABSOLUTE_OBSERVABILITY_ENDPOINT, ABSOLUTE_PROJECT_ID, and ABSOLUTE_OBSERVABILITY_TOKEN are required",
    );

  return createManagedObservabilityRelay({ endpoint, project, token });
};

export type ManagedObservabilityRelay = ReturnType<
  typeof createManagedObservabilityRelay
>;
