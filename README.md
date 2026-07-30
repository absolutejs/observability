# @absolutejs/observability

Managed browser observability for AbsoluteJS applications. It composes
`@absolutejs/beacon` and `@absolutejs/replay`, correlates every captured issue
with its privacy-masked session tail, and sends both through a same-origin
Elysia relay. The relay also composes `@absolutejs/errors-elysia`: thrown
server exceptions, sanitized handled 5xx responses, and unexplained returned
5xx responses enter the same project-fenced issue history with a safe trace id.

The browser receives only its non-secret project id. The relay reads the
project-scoped destination and write credential from the server environment.
Server error messages, stacks, tags, and context are redacted against
secret-shaped environment values before leaving the workload, then redacted
again by the control plane before persistence.

```ts
import { createManagedObservability } from "@absolutejs/observability";

const observability = createManagedObservability({
  project: "6756f6d7-8e09-4ef9-b445-ed07092748ac",
});
```

```ts
import { createManagedObservabilityRelayFromEnv } from "@absolutejs/observability/elysia";

new Elysia().use(createManagedObservabilityRelayFromEnv());
```

Mount the relay before application routes. Its manifest declares the
`server-boundary` placement, so AbsoluteJS Studio does this automatically and
the error hook observes every generated handler.

`captureHandoffContradiction()` promotes a contradictory
`@absolutejs/handoff` summary into the same Issues pipeline at warning severity.
It ignores non-contradictory summaries and excludes evidence messages,
references, external ids, and raw payloads.

Required server environment:

- `ABSOLUTE_OBSERVABILITY_ENDPOINT`
- `ABSOLUTE_OBSERVABILITY_TOKEN`
- `ABSOLUTE_PROJECT_ID`

Inputs are masked by default. Add `class="rr-block"` to elements that must
never be recorded.
