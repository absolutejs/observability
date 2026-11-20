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
  /**
   * Read what to record from the hosting platform through the relay's
   * `/config` (on unless `false`). The platform's settings win over these
   * options; if it doesn't answer within `timeoutMs`, these apply.
   */
  remoteSettings?: boolean | { endpoint?: string; timeoutMs?: number };
};

/** What the hosting platform says to record, from the relay's `/config`. */
export type RemoteObservabilitySettings = {
  maskAllInputs?: boolean;
  maskAllText?: boolean;
  recordCanvas?: boolean;
  replay?: boolean;
  /** Of the visits that report, how many are recorded, 0 to 1. */
  replaySampleRate?: number;
  /** How many visitors report at all, 0 to 1. */
  sampleRate?: number;
  signals?: boolean;
  /** Whether the "Report a problem" button shows. */
  support?: boolean;
  vitals?: boolean;
};

const REMOTE_SETTINGS_ENDPOINT = "/api/observability/config";
const REMOTE_SETTINGS_TIMEOUT_MS = 3000;

/** The app's own options with the platform's settings over them. */
export const withRemoteSettings = (
  options: ManagedObservabilityOptions,
  remote: RemoteObservabilitySettings,
): ManagedObservabilityOptions => ({
  ...options,
  ...(remote.maskAllInputs === undefined
    ? {}
    : { maskAllInputs: remote.maskAllInputs }),
  ...(remote.maskAllText === undefined
    ? {}
    : { maskAllText: remote.maskAllText }),
  ...(remote.recordCanvas === undefined
    ? {}
    : { recordCanvas: remote.recordCanvas }),
  ...(remote.replay === undefined ? {} : { replay: remote.replay }),
  ...(remote.signals === undefined ? {} : { signals: remote.signals }),
  ...(remote.support === undefined ? {} : { support: remote.support }),
  ...(remote.vitals === undefined ? {} : { vitals: remote.vitals }),
});

/* Whether this visit falls inside a share of visits. */
const sampledIn = (rate: number | undefined, draw = Math.random()) =>
  rate === undefined || draw < rate;

const remoteSettingsTarget = (options: ManagedObservabilityOptions) => {
  if (options.remoteSettings === false) return null;
  if (typeof fetch === "undefined") return null;
  const configured =
    typeof options.remoteSettings === "object" ? options.remoteSettings : {};

  return {
    endpoint: configured.endpoint ?? REMOTE_SETTINGS_ENDPOINT,
    timeoutMs: configured.timeoutMs ?? REMOTE_SETTINGS_TIMEOUT_MS,
  };
};

/* The platform's settings, or null when it doesn't answer in time. */
const loadRemoteSettings = async (target: {
  endpoint: string;
  timeoutMs: number;
}) => {
  try {
    const response = await fetch(target.endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    if (!response.ok) return null;

    return (await response.json()) as RemoteObservabilitySettings;
  } catch {
    return null;
  }
};

export type ManagedObservability = {
  beacon: Beacon;
  /** The platform's settings once read (null when there were none). */
  settings: Promise<RemoteObservabilitySettings | null>;
  close: () => Promise<void>;
  flushReplay: () => Promise<string | null>;
  /** Undefined until it starts: at once, or once the platform's settings
   *  are read (and not at all when they turn it off). */
  replay?: ReplayController | undefined;
  diagnostics?: BrowserDiagnostics;
  support?: SupportModeController;
};

export const connectManagedSupportReport = (
  observability: ManagedObservability,
  options?: { root?: Document | HTMLElement; tagName?: string },
): (() => void) => {
  if (observability.support === undefined) return () => undefined;
  const disconnect = connectSupportReportElements(
    observability.support,
    options,
  );
  /* The platform can turn the button off without a code change. */
  void observability.settings.then((settings) => {
    if (settings?.support !== false) return;
    const root = options?.root ?? document;
    for (const element of root.querySelectorAll(
      options?.tagName ?? "absolute-support-report",
    ))
      (element as HTMLElement).hidden = true;
  });

  return disconnect;
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
  const remoteTarget = remoteSettingsTarget(options);
  /* With the platform's settings to wait for, replay starts once they're
   * read, so its privacy choices apply from the first frame. */
  let replay: ReplayController | undefined =
    remoteTarget === null && options.replay !== false
      ? createReplayController(replayOptions(options))
      : undefined;
  const getReplayId = () => replay?.getReplayId();
  const beforeSend = (event: BeaconEvent) => {
    replay?.flushThrottled();

    return event;
  };
  const beaconOptions: BeaconOptions = {
    beforeSend,
    endpoint: "/api/observability/errors",
    project: options.project,
    getReplayId,
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
          replayId: getReplayId,
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

  const settings =
    remoteTarget === null
      ? Promise.resolve(null)
      : loadRemoteSettings(remoteTarget).then((remote) => {
          const merged =
            remote === null ? options : withRemoteSettings(options, remote);
          if (merged.replay !== false && sampledIn(remote?.replaySampleRate))
            replay = createReplayController(replayOptions(merged));
          /* A visitor outside the share that reports sends nothing. */
          if (!sampledIn(remote?.sampleRate)) void beacon.close();

          return remote;
        });

  return {
    beacon,
    settings,
    close: async () => {
      support?.discard();
      await Promise.all([beacon.close(), replay?.stop()]);
    },
    flushReplay: () => replay?.flush() ?? Promise.resolve(null),
    get replay() {
      return replay;
    },
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(support === undefined ? {} : { support }),
  };
};
