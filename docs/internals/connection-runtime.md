# Connection runtime

Web, the desktop renderer, and mobile share one connection owner per environment
in `packages/client-runtime`. Platform code supplies storage, credentials, network
signals, and application lifecycle events. React views consume the runtime.
Keeping retries and session lifetime here prevents competing reconnect loops when
several views need the same environment.

## One retry owner

The [supervisor](../../packages/client-runtime/src/connection/supervisor.ts) owns
retry policy; resolving an endpoint and opening an RPC session are single
attempts. Transient failures retry with capped backoff. Offline states and
authentication failures wait for a wakeup instead of spending attempts on
unchanged conditions.

Foregrounding needs different treatment depending on the connection's state.
It wakes a retry immediately, leaves an ordinary in-flight attempt alone, and
probes an established session before replacing it. A long mobile background
suspension forces replacement because the OS can kill a socket without reporting
closure. Treating every foreground event as a reconnect delays healthy attempts;
treating every resume as harmless leaves suspended sockets stuck.

The [registry](../../packages/client-runtime/src/connection/registry.ts) scopes
connections by environment. An involuntary disconnect retains the registration
and cached data. Explicit removal closes the scope and clears credentials,
projections, and platform-owned state such as drafts. Cloud-account changes apply
to relay registrations; they must not discard directly paired environments.

## Transport health and data freshness are separate

A socket opening is insufficient evidence that the environment is usable. The
[RPC session](../../packages/client-runtime/src/rpc/session.ts) waits for the
initial server configuration before becoming ready. Shell and thread data then
have their own synchronization state. A failed shell subscription can coexist
with a healthy connection; labeling that state "reconnecting" promises a
transport retry that will never happen.

Cached projections remain readable offline. They must neither imply a live
connection nor overwrite newer live data during a reconnect. Loading and
resuming snapshots belongs to the shared state services, so every view agrees
on which data is current.

[Thread detail](../../packages/client-runtime/src/state/threads.ts) separates
subscription lifetime from cache lifetime. Mounted consumers share one live
stream, which stops when the last consumer unmounts; hidden mounted routes still
count. A registry-local cache retains state and its replay cursor for five idle
minutes so back navigation can resume without another snapshot download.

Retain state and cursor together only after an update finishes. Cancellation must
not advance the cached cursor beyond the applied data, and an old scope must not
overwrite its successor's cache. Preserve pagination data on reuse, but clear
canceled loading state.

The [RPC boundary](../../packages/client-runtime/src/rpc/client.ts) resolves
requests against the current session at execution time. Durable subscriptions
follow replacement sessions. After a transport failure they wait for the
supervisor; an expected domain failure may resubscribe on the same healthy
session. Reconnection does not automatically replay mutations, whose retry and
idempotency rules belong to the operation.

### Android background ownership

Android can add a second application-root owner without adding a second
connection runtime. The opt-in **Keep connected in background** setting starts a
`remoteMessaging` foreground service in the normal application process. React
Native Headless JS cold-starts the existing mobile runtime and acquires
reference-counted leases against the same process-wide `appAtomRegistry` used by
the UI. Mounting the UI and background task together therefore still produces
one supervisor and one transport per saved environment.

The headless root retains:

- the environment catalog, server configurations, and shell state for every
  saved environment;
- aggregate thread-shell state;
- full detail for the last-opened thread and threads whose sessions are
  `starting` or `running`; and
- the shared, reference-counted thread-outbox drain worker.

It does not retain every historical thread body. Once running work settles and
is not the last-opened thread, the existing idle lifetime and persistence rules
remain authoritative.

T3 Connect authentication has matching `ui` and `background` owners. UI
ownership wins while the app is visible. A cold headless start loads the
persisted Clerk session and installs its token provider into the existing
`managedRelaySessionAtom`; direct and Tailscale startup is not blocked when
Clerk is signed out, unconfigured, or temporarily unavailable. There is no
background-only relay transport or authentication path.

The service is deliberately opt-in and defaults off. While enabled, Android
requires a silent ongoing notification. React Native owns a partial CPU wake
lock for the headless task, and the native service holds a best-effort
high-performance Wi-Fi lock. These locks and the continuously active network
connections have an intentional battery and data cost. A battery-optimization
exemption improves survival under device power management, but declining it
does not silently turn the feature off.

The service uses sticky restart behavior and restores an enabled preference
after package replacement or boot once credential-protected storage is
available. Android force-stop remains absolute: no receiver or service may
restart the app until the user launches it again. The app also cannot restart a
separately stopped Tailscale VPN.

At introduction, the direct/Tailscale path was exercised on a physical Android
device across lock, Doze, task removal, network transitions, package replacement,
and reboot. Cold T3 Connect ownership and token refresh have automated coverage,
but were not live-validated against a configured relay account on that device.
