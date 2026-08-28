import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { ManagedObservabilityOptions } from "./index";

export const manifest = defineManifest<ManagedObservabilityOptions>()({
  contract: 2,
  identity: {
    accent: "#8b5cf6",
    category: "observability",
    description:
      "Correlated browser and server errors, privacy-masked session replay, vitals, and explicit privacy-audited Support Mode through a same-origin Elysia relay. Project credentials stay in the server runtime and never enter browser settings.",
    docsUrl: "https://github.com/absolutejs/observability",
    name: "@absolutejs/observability",
    tagline:
      "See and securely reproduce what went wrong without leaking a tenant credential.",
  },
  requires: {
    env: [
      {
        description: "Project-scoped control-plane observability destination.",
        key: "ABSOLUTE_OBSERVABILITY_ENDPOINT",
      },
      {
        description:
          "Write-only project credential. This is consumed only by the server relay.",
        key: "ABSOLUTE_OBSERVABILITY_TOKEN",
        secret: true,
      },
      {
        description:
          "Project identity shared by the server relay and generated browser settings.",
        key: "ABSOLUTE_PROJECT_ID",
      },
    ],
    peers: [
      {
        name: "elysia",
        range: "^2.0.0-beta.6",
        reason: "same-origin relay host",
      },
      {
        name: "rrweb",
        range: ">=2.1.1 <3",
        reason: "lazy-loaded session recording engine",
      },
    ],
  },
  settings: Type.Object({
    environment: Type.Optional(Type.String({ title: "Environment" })),
    flushIntervalMs: Type.Optional(
      Type.Integer({ minimum: 250, title: "Error flush interval" }),
    ),
    maskAllInputs: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Hide everything visitors type into form fields.",
        title: "Mask typed input",
      }),
    ),
    maskAllText: Type.Optional(
      Type.Boolean({
        description: "Hide all rendered text in replay sessions.",
        title: "Mask all text",
      }),
    ),
    maxBatch: Type.Optional(
      Type.Integer({
        maximum: 100,
        minimum: 1,
        title: "Errors per batch",
      }),
    ),
    project: Type.String({
      description: "Managed hosts set this to the tenant project id.",
      title: "Project",
    }),
    recordCanvas: Type.Optional(
      Type.Boolean({ title: "Record canvas elements" }),
    ),
    release: Type.Optional(Type.String({ title: "Release" })),
    replay: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Retain a bounded privacy-masked session tail when an error occurs.",
        title: "Session replay",
      }),
    ),
    support: Type.Optional(
      Type.Union(
        [
          Type.Boolean(),
          Type.Object({
            expiresInMs: Type.Optional(
              Type.Integer({ minimum: 60_000, title: "Artifact expiry" }),
            ),
            maxDurationMs: Type.Optional(
              Type.Integer({
                maximum: 3_600_000,
                minimum: 1_000,
                title: "Maximum support recording duration",
              }),
            ),
            propagateDiagnosticId: Type.Optional(
              Type.Boolean({
                default: false,
                description:
                  "Add a PII-free diagnostic correlation id to same-origin requests.",
                title: "Propagate diagnostic id",
              }),
            ),
          }),
        ],
        {
          default: true,
          description:
            "Install dormant, user-authorized Support Mode with privacy-audited network and console capture.",
          title: "Support Mode",
        },
      ),
    ),
    sampleRate: Type.Optional(
      Type.Number({
        default: 1,
        maximum: 1,
        minimum: 0,
        title: "Error sample rate",
      }),
    ),
    signals: Type.Optional(
      Type.Boolean({
        default: true,
        title: "Actionable browser signals",
      }),
    ),
    vitals: Type.Optional(
      Type.Boolean({ default: true, title: "Core Web Vitals" }),
    ),
  }),
  wiring: [
    {
      client: {
        client: {
          code: [
            "const observability = createManagedObservability(${settings});",
            "const disconnectSupportUi = connectManagedSupportReport(observability);",
            "// Place <absolute-support-report></absolute-support-report> anywhere in the app.",
          ].join("\n"),
          imports: [
            {
              from: "@absolutejs/observability",
              names: [
                "connectManagedSupportReport",
                "createManagedObservability",
              ],
            },
          ],
          placement: "client-entry",
        },
      },
      description:
        "Mount the credential-safe server error boundary and relay, then initialize correlated browser capture.",
      id: "default",
      server: {
        code: ".use(createManagedObservabilityRelayFromEnv())",
        imports: [
          {
            from: "@absolutejs/observability/elysia",
            names: ["createManagedObservabilityRelayFromEnv"],
          },
        ],
        placement: "server-boundary",
      },
      title:
        "Managed errors, privacy-masked replay, and user-authorized Support Mode",
    },
  ],
});
