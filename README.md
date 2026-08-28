# @absolutejs/observability

Managed browser observability for AbsoluteJS applications. It composes
`@absolutejs/beacon`, `@absolutejs/replay`, and `@absolutejs/diagnostics`, correlates every captured issue
with its privacy-masked session tail, and sends both through a same-origin
Elysia relay. The relay also composes `@absolutejs/errors/elysia`: thrown
server exceptions, sanitized handled 5xx responses, and unexplained returned
5xx responses enter the same project-fenced issue history with a safe trace id.
Its dormant Support Mode lets a user explicitly record, review, and send a
privacy-audited support bundle without exposing the project write credential.

## Browser and server correlation

The browser receives only its non-secret project id. The relay reads the
project-scoped destination and write credential from the server environment.
Server error messages, stacks, tags, and context are redacted against
secret-shaped environment values before leaving the workload, then redacted
again by the control plane before persistence.

## Quick start

```ts
import {
  connectManagedSupportReport,
  createManagedObservability,
} from "@absolutejs/observability";

const observability = createManagedObservability({
  project: "6756f6d7-8e09-4ef9-b445-ed07092748ac",
});

// Optional native UI; the recorder remains dormant until the user clicks Start.
connectManagedSupportReport(observability);
```

Place the framework-neutral element anywhere in the application:

```html
<absolute-support-report></absolute-support-report>
```

```ts
import { createManagedObservabilityRelayFromEnv } from "@absolutejs/observability/elysia";

new Elysia().use(createManagedObservabilityRelayFromEnv());
```

Mount the relay before application routes. Its manifest declares the
`server-boundary` placement, so the hosted AbsoluteJS.ai platform does this automatically and
the error hook observes every generated handler.

## Support Mode

Applications can use the UI or the headless controller:

```ts
observability.support?.start("Apple Pay did not complete");
observability.support?.mark("wallet sheet opened");
observability.support?.mark("payment failed");
const bundle = await observability.support?.stop();
await observability.support?.send();
```

The support-session id joins the redacted HAR and console timeline to Replay,
Beacon issues, release/environment metadata, and request-level trace ids. Replay
is flushed before the bundle is forwarded. The same-origin relay re-creates and
re-audits the bundle before authenticating it to the project boundary.

## Agent handoff contradictions

`captureHandoffContradiction()` promotes a contradictory
`@absolutejs/handoff` summary into the same Issues pipeline at warning severity.
It ignores non-contradictory summaries and excludes evidence messages,
references, external ids, and raw payloads.

## Server configuration

Required server environment:

- `ABSOLUTE_OBSERVABILITY_ENDPOINT`
- `ABSOLUTE_OBSERVABILITY_TOKEN`
- `ABSOLUTE_PROJECT_ID`

Inputs are masked by default. Add `class="rr-block"` to elements that must
never be recorded.
