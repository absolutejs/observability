import {
  createBeacon,
  type Beacon,
  type BeaconEvent,
  type BeaconOptions,
} from "@absolutejs/beacon";
import {
  createReplayController,
  type ReplayController,
  type ReplayControllerOptions,
} from "@absolutejs/replay";
import {
  createBrowserDiagnostics,
  type BrowserDiagnostics,
} from "@absolutejs/diagnostics/browser";
import {
  connectSupportReportElements,
  createSupportModeController,
  type SupportModeController,
} from "@absolutejs/diagnostics/ui";

export { connectSupportReportElements } from "@absolutejs/diagnostics/ui";

export type ManagedSupportOptions = {
  endpoint?: string;
  expiresInMs?: number;
  maxDurationMs?: number;
  propagateDiagnosticId?: boolean;
};

export type ManagedObservabilityOptions = {
  environment?: string;
  project: string;
  release?: string;
  sampleRate?: number;
  signals?: boolean;
  vitals?: boolean;
  replay?: boolean;
  support?: boolean | ManagedSupportOptions;
  supportContext?: () =>
    | Promise<Record<string, unknown> | undefined>
    | Record<string, unknown>
    | undefined;
  supportIssueFingerprints?: () => Promise<string[]> | string[];
  supportTraceIds?: () => Promise<string[]> | string[];
  maskAllInputs?: boolean;
  maskAllText?: boolean;
  recordCanvas?: boolean;
  flushIntervalMs?: number;
  maxBatch?: number;
};

export type ManagedObservability = {
  beacon: Beacon;
  close: () => Promise<void>;
  flushReplay: () => Promise<string | null>;
  replay?: ReplayController;
  diagnostics?: BrowserDiagnostics;
  support?: SupportModeController;
};

export const connectManagedSupportReport = (
  observability: ManagedObservability,
  options?: { root?: Document | HTMLElement; tagName?: string },
): (() => void) => {
  if (observability.support === undefined) return () => undefined;
  return connectSupportReportElements(observability.support, options);
};

const replayOptions = (
  options: ManagedObservabilityOptions,
): ReplayControllerOptions => ({
  endpoint: "/api/observability/replays",
  project: options.project,
  ...(options.environment === undefined
    ? {}
    : { environment: options.environment }),
  ...(options.release === undefined ? {} : { release: options.release }),
  persistSessionKey: `absolutejs:observability:${options.project}`,
  recorder: {
    ...(options.maskAllInputs === undefined
      ? {}
      : { maskAllInputs: options.maskAllInputs }),
    ...(options.maskAllText === undefined
      ? {}
      : { maskAllText: options.maskAllText }),
    ...(options.recordCanvas === undefined
      ? {}
      : { recordCanvas: options.recordCanvas }),
  },
});

export const createManagedObservability = (
  options: ManagedObservabilityOptions,
): ManagedObservability => {
  const replay =
    options.replay === false
      ? undefined
      : createReplayController(replayOptions(options));
  const beforeSend = (event: BeaconEvent) => {
    replay?.flushThrottled();

    return event;
  };
  const beaconOptions: BeaconOptions = {
    beforeSend,
    endpoint: "/api/observability/errors",
    project: options.project,
    ...(replay === undefined ? {} : { getReplayId: replay.getReplayId }),
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.flushIntervalMs === undefined
      ? {}
      : { flushIntervalMs: options.flushIntervalMs }),
    ...(options.maxBatch === undefined ? {} : { maxBatch: options.maxBatch }),
    ...(options.release === undefined ? {} : { release: options.release }),
    ...(options.sampleRate === undefined
      ? {}
      : { sampleRate: options.sampleRate }),
    ...(options.signals === undefined ? {} : { signals: options.signals }),
    vitals:
      options.vitals === false
        ? false
        : { endpoint: "/api/observability/vitals" },
  };
  const beacon = createBeacon(beaconOptions);
  const supportOptions =
    typeof options.support === "object" ? options.support : {};
  const diagnostics =
    options.support === false
      ? undefined
      : createBrowserDiagnostics({
          ...(options.environment === undefined
            ? {}
            : { environment: options.environment }),
          ignoredUrlSubstrings: [
            supportOptions.endpoint ?? "/api/observability/diagnostics",
          ],
          project: options.project,
          propagateDiagnosticId: supportOptions.propagateDiagnosticId ?? false,
          ...(options.release === undefined
            ? {}
            : { release: options.release }),
          ...(replay === undefined ? {} : { replayId: replay.getReplayId }),
        });
  const support =
    diagnostics === undefined
      ? undefined
      : createSupportModeController({
          diagnostics,
          ...(supportOptions.expiresInMs === undefined
            ? {}
            : { expiresInMs: supportOptions.expiresInMs }),
          ...(supportOptions.maxDurationMs === undefined
            ? {}
            : { maxDurationMs: supportOptions.maxDurationMs }),
          ...(options.supportContext === undefined
            ? {}
            : { context: options.supportContext }),
          ...(options.supportIssueFingerprints === undefined
            ? {}
            : { issueFingerprints: options.supportIssueFingerprints }),
          ...(options.supportTraceIds === undefined
            ? {}
            : { traceIds: options.supportTraceIds }),
          submit: async (bundle) => {
            await replay?.flush();
            const response = await fetch(
              supportOptions.endpoint ?? "/api/observability/diagnostics",
              {
                body: JSON.stringify({ bundle }),
                headers: { "content-type": "application/json" },
                method: "POST",
              },
            );
            if (!response.ok) {
              throw new Error(
                `Support report upload failed with HTTP ${response.status}.`,
              );
            }
            return (await response.json()) as { id?: string };
          },
        });

  return {
    beacon,
    close: async () => {
      support?.discard();
      await Promise.all([beacon.close(), replay?.stop()]);
    },
    flushReplay: () => replay?.flush() ?? Promise.resolve(null),
    ...(replay === undefined ? {} : { replay }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(support === undefined ? {} : { support }),
  };
};
