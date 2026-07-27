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

export type ManagedObservabilityOptions = {
  environment?: string;
  project: string;
  release?: string;
  sampleRate?: number;
  signals?: boolean;
  vitals?: boolean;
  replay?: boolean;
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

  return {
    beacon,
    close: async () => {
      await Promise.all([beacon.close(), replay?.stop()]);
    },
    flushReplay: () => replay?.flush() ?? Promise.resolve(null),
    ...(replay === undefined ? {} : { replay }),
  };
};
