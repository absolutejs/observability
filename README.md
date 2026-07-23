# @absolutejs/observability

Managed browser observability for AbsoluteJS applications. It composes
`@absolutejs/beacon` and `@absolutejs/replay`, correlates every captured issue
with its privacy-masked session tail, and sends both through a same-origin
Elysia relay.

The browser receives only its non-secret project id. The relay reads the
project-scoped destination and write credential from the server environment.

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

Required server environment:

- `ABSOLUTE_OBSERVABILITY_ENDPOINT`
- `ABSOLUTE_OBSERVABILITY_TOKEN`
- `ABSOLUTE_PROJECT_ID`

Inputs are masked by default. Add `class="rr-block"` to elements that must
never be recorded.
