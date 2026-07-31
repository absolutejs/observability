import { handoffErrorContext } from "@absolutejs/errors";
import {
  errorsPlugin,
  type ErrorsCapture,
  type ErrorsCaptureContext,
} from "@absolutejs/errors/elysia";
import type { HandoffSummary } from "@absolutejs/handoff";
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
  environment?: string;
  fetch?: ObservabilityRelayFetch;
  onCaptureError?: (error: unknown) => void;
  project: string;
  redact?: (value: string) => string;
  release?: string;
  serverErrors?: boolean;
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
const WebVitalSchema = t.Object({
  at: t.Number({ minimum: 0 }),
  environment: t.Optional(t.String({ maxLength: 64 })),
  id: t.String({ maxLength: 255, minLength: 1 }),
  name: t.Union([
    t.Literal("LCP"),
    t.Literal("INP"),
    t.Literal("CLS"),
    t.Literal("FCP"),
    t.Literal("TTFB"),
    t.Literal("TBT"),
  ]),
  navigationType: t.String({ maxLength: 64, minLength: 1 }),
  path: t.String({ maxLength: 2_048, minLength: 1 }),
  project: t.String({ format: "uuid" }),
  rating: t.Union([
    t.Literal("good"),
    t.Literal("needs-improvement"),
    t.Literal("poor"),
  ]),
  release: t.Optional(t.String({ maxLength: 255 })),
  replayId: t.Optional(t.String({ format: "uuid" })),
  samplingRate: t.Number({ exclusiveMinimum: 0, maximum: 1 }),
  schemaVersion: t.Integer({ minimum: 1 }),
  sdkVersion: t.Optional(t.String({ maxLength: 64, minLength: 1 })),
  traceId: t.Optional(
    t.String({ maxLength: 64, minLength: 16, pattern: "^[a-fA-F0-9]+$" }),
  ),
  value: t.Number({ minimum: 0 }),
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

const errorFrom = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/**
 * Promotes a reconciled handoff contradiction into the normal Issues pipeline.
 * Non-contradictory summaries are ignored, and the capture context excludes
 * evidence messages, references, external ids, and raw payloads.
 */
export const captureHandoffContradiction = async (
  capture: ErrorsCapture,
  summary: HandoffSummary,
  context: ErrorsCaptureContext = {},
) => {
  if (!summary.contradiction) return false;
  await capture(
    new Error("External handoff evidence contradicts authoritative outcome"),
    handoffErrorContext(summary, {
      ...context,
      level: context.level ?? "warning",
    }),
  );

  return true;
};

const redactContext = (
  value: unknown,
  redact: (value: string) => string,
  seen = new WeakSet<object>(),
): unknown => {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactContext(item, redact, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactContext(item, redact, seen),
    ]),
  );
};

const environmentRedactor = (env: RelayEnvironment) => {
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        value !== undefined &&
        value.length >= 8 &&
        /(DATABASE_URL|KEY|PASSWORD|SECRET|TOKEN)$/i.test(key),
    )
    .map(([, value]) => value!)
    .sort((left, right) => right.length - left.length);

  return (value: string) =>
    secrets.reduce(
      (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
      value,
    );
};

export const createManagedObservabilityRelay = (
  options: ManagedObservabilityRelayOptions,
) => {
  const endpoint = normalizedEndpoint(options.endpoint);
  const doFetch: ObservabilityRelayFetch = options.fetch ?? globalThis.fetch;
  const redact = options.redact ?? ((value: string) => value);
  const upstream = async (url: URL, body: unknown, authorization = false) => {
    const response = await doFetch(url, {
      body: JSON.stringify(body),
      headers: {
        ...(authorization ? { authorization: `Bearer ${options.token}` } : {}),
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok)
      throw new Error(`Observability upstream responded ${response.status}`);
  };
  const captureServerError = async (
    value: unknown,
    context?: ErrorsCaptureContext,
  ) => {
    const error = errorFrom(value);
    await upstream(
      new URL(`${endpoint.pathname}/errors/ingest`, endpoint),
      {
        ...(options.environment ? { environment: options.environment } : {}),
        events: [
          {
            ...(context?.extra
              ? {
                  extra: redactContext(context.extra, redact) as Record<
                    string,
                    unknown
                  >,
                }
              : {}),
            level: context?.level ?? "error",
            message: redact(error.message),
            name: error.name,
            ...(context?.replayId
              ? { replayId: redact(context.replayId) }
              : {}),
            ...(context?.spanId ? { spanId: redact(context.spanId) } : {}),
            ...(error.stack ? { stack: redact(error.stack) } : {}),
            ...(context?.tags
              ? {
                  tags: Object.fromEntries(
                    (
                      Object.entries(context.tags) as Array<[string, string]>
                    ).map(([key, value]) => [key, redact(value)]),
                  ),
                }
              : {}),
            ...(context?.traceId ? { traceId: redact(context.traceId) } : {}),
          },
        ],
        project: options.project,
        ...(options.release ? { release: options.release } : {}),
        v: 1,
      },
      true,
    );
  };
  const serverBoundary =
    options.serverErrors === false
      ? new Elysia({ name: "@absolutejs/observability/server-errors-disabled" })
      : errorsPlugin({
          server: {
            capture: captureServerError,
            ...(options.onCaptureError
              ? { onCaptureError: options.onCaptureError }
              : {}),
          },
        });

  return new Elysia({
    name: "@absolutejs/observability",
    prefix: "/api/observability",
  })
    .use(serverBoundary)
    .onError({ as: "global" }, ({ code, status }) => {
      if (code === "UNKNOWN") return status("Internal Server Error");

      return undefined;
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
            new URL(`${endpoint.pathname}/errors/ingest`, endpoint),
            body,
            true,
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
    )
    .post(
      "/vitals",
      async ({ body, status }) => {
        if (body.project !== options.project)
          return status(
            HTTP_BAD_REQUEST,
            "Web Vital project does not match this runtime",
          );
        try {
          await upstream(
            new URL(`${endpoint.pathname}/vitals/ingest`, endpoint),
            body,
            true,
          );

          return { accepted: 1, project: options.project };
        } catch {
          return status(HTTP_BAD_GATEWAY, "Web Vital ingest is unavailable");
        }
      },
      { body: WebVitalSchema },
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

  const release = env.RELEASE_ID?.trim() || env.GIT_SHA?.trim();

  return createManagedObservabilityRelay({
    endpoint,
    environment: env.NODE_ENV?.trim() || "development",
    project,
    redact: environmentRedactor(env),
    ...(release ? { release } : {}),
    token,
  });
};

export type ManagedObservabilityRelay = ReturnType<
  typeof createManagedObservabilityRelay
>;
