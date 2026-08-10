## Tab reference

| Challenge | Tab 0 (OTel Arcade) | Tab 1 (Terminal) | Tab 2 (Honeycomb) |
|---|---|---|---|
| 1 — Wire the pipelines | ✓ | — | — |
| 2 — Connect to Honeycomb | ✓ | ✓ `sed`, `docker compose` | ✓ |
| 3 — Spot the Problems | ✓ | — | — |
| 4 — Clean Your Telemetry | ✓ | — | — |
| 5 — Checkpoint and Handoff | ✓ | — | — |

Keep both tabs visible across all challenges — hiding the terminal in Challenges 3 and 5 can disorient users if they go looking for it.

---

# Challenge 1: Your First Collector Pipeline

The OTel Arcade is running in your sandbox — a small browser-based arcade of mini-games that generates real OpenTelemetry telemetry as you play.

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab.
2. Inside the app, look at the left navigation. You'll see two
sections:
   - **Arcade** — the app itself. Play any game to generate telemetry.
   - **Collector** — your workshop tools. This is where you'll spend
   most of your time.
3. Select **◈ Visualizer** in the app's left navigation. Notice the
feed is empty — the Collector is running, but its pipelines aren't
wired to send anywhere useful yet. That's what you'll fix in this
challenge.

---

## How the Collector works

The OpenTelemetry Collector is a vendor-agnostic proxy for telemetry.
It sits between your services and your backend, receiving signals,
optionally transforming them, and exporting to one or more
destinations.

Every Collector config has three sections:

- **receivers** — how telemetry comes in
- **processors** — optional transforms and filters
- **exporters** — where telemetry goes out

Those pieces connect in a **pipelines** block. A pipeline is a named
route for one signal type — traces, metrics, or logs — from receiver
through processors to exporters.

---

## Wire the pipelines

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. Select the **Collector** tab to open the config editor.
3. Read through the file. Receivers, processors, and exporters are
all defined. Find the `pipelines` section — it has three
pipelines (`traces`, `metrics`, `logs`), each currently exporting
only to `debug`.
4. Identify the two exporters that are defined but not connected to
any pipeline:
   - `otlp_grpc/backend` — sends to Honeycomb
   - `otlp_http/visualizer` — sends to the live Visualizer feed
5. Both exporters are defined in the config but not yet connected to
any pipeline — without wiring them in, all telemetry stays in the
`debug` exporter and never reaches Honeycomb or the Visualizer. In
each of the three pipeline definitions under `pipelines`
(`traces`, `metrics`, and `logs`), update the `exporters` list so it
reads:
```yaml
exporters: [debug, otlp_grpc/backend, otlp_http/visualizer]
```
6. Select "Apply & Restart." You should see "Config saved. Collector restarted successfully."

---

## Verify

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **◈ Visualizer** in the app's left navigation.
2. Confirm you see:
   - The **Pipeline** panel showing your receiver → processor →
   exporter topology
   - The **Feed** panel filling with live spans
3. Play a game to generate a burst of traffic if the feed looks slow.

> [!IMPORTANT]
> If the feed stays empty, check the Collector logs in the Terminal tab:
> ```bash
> docker compose logs --tail=50 otel-collector-agent
> ```
> A YAML syntax error or unknown component name will appear there.

---

## Success criteria

- The Visualizer topology shows all three pipelines
- The feed shows live spans from `arcade-ui`, `score-api`, and
`leaderboard`

---

# Challenge 2: Connect to Honeycomb

Your pipeline is running and telemetry is flowing through the
Collector. Now you'll connect it to Honeycomb so traces are
queryable in a real observability backend.

---

## Create your environment and API key

1. Open the [button label="Honeycomb"](tab-2) tab — this opens Honeycomb in a new browser window. Log in.
2. Select your environment name in the left navigation.
3. Select **Manage Environments**.
4. Select **Create Environment**.
5. Name it `otel-arcade-workshop` and save.
6. Select the `otel-arcade-workshop` environment after it's created.
7. Select **API Keys** in the top navigation.
8. Select **Create Ingest API Key**.
9. Name it `otel-arcade-workshop`.
10. Copy the Key Secret.

> [!IMPORTANT]
> This is the only time you'll see this key. Copy it and keep it
> somewhere accessible — you'll need it in the next section and
> again in the next challenge.

---

## Add your API key to the sandbox

1. Select the [button label="Terminal"](tab-1) tab.
2. Run the following command, replacing `your-key-here` with your
API key:
```bash
sed -i 's/HONEYCOMB_API_KEY=.*/HONEYCOMB_API_KEY=your-key-here/' /root/otel-arcade-collector-workshop/.env
```
3. Verify the key was written correctly:
```bash
grep HONEYCOMB_API_KEY /root/otel-arcade-collector-workshop/.env
```
4. Recreate the Collector container to inject the new key:
```bash
cd /root/otel-arcade-collector-workshop && docker compose up --force-recreate otel-collector-agent -d
```

> [!NOTE]
> A full container recreate is required here — restarting the
> Collector alone is not enough because environment variables are
> only injected at container creation.

---

## Verify

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and play a game to generate a few traces.
2. Open Honeycomb in your browser and navigate to your
`otel-arcade-workshop` environment.
3. Confirm traces are arriving from all three services: `arcade-ui`,
`score-api`, and `leaderboard`.

> [!IMPORTANT]
> If no traces appear in Honeycomb, check the Collector logs for
> auth errors in the Terminal tab:
> ```bash
> docker compose logs --tail=50 otel-collector-agent
> ```
> An invalid or missing API key will show up as a 401 error in the
> exporter output.

---

## Success criteria

- Traces from `arcade-ui`, `score-api`, and `leaderboard` are
visible in Honeycomb in the `otel-arcade-workshop` environment

---

# Challenge 3: Spot the Problems

Your pipeline is clean and traces are flowing to Honeycomb. Before
you touch any configuration, take a few minutes to look at what's
actually in the feed.

---

## Look at the Visualizer feed

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab.
2. Select **◈ Visualizer** in the app's left navigation.
3. Play two or three different games to generate a variety of spans.
4. Look at the feed. Notice some spans are highlighted in orange.

---

## Investigate the highlighted spans

1. Select an orange-highlighted span to expand it.
2. Look at the span name and its attributes carefully.
3. Work through the following questions before moving on:

   - **Span names:** Do any span names look like they contain dynamic
   or unique values? What's the problem with storing those as-is?
   - **player.id:** Find a span with a `player.id` attribute. What
   kind of data is this? Should it be stored in telemetry?
   - **Health probes:** Look for spans named something like
   `GET /health` or `GET /ready`. How frequently do they appear?
   What value do they add?
   - **Attribute values:** Find a span with a `browser.user_agent`
   attribute. How long is the value?
   - **Resource attributes:** Look for a span from the `leaderboard`
   service. Does it have both `app.name` and `service.name` resource
   attributes? What do they contain?

> [!NOTE]
> The **⚠ N smells** counter in the feed header tells you how many
> problematic spans are currently in the feed. Take note of the
> number before you move on — you'll get it to zero in the next
> challenge.

---

## Success criteria

- You can identify all five telemetry problems in the feed before
moving to Challenge 4:
  1. High-cardinality SQL span names
  2. `player.id` PII in span attributes
  3. High-volume health probe spans
  4. Excessively long attribute values
  5. Redundant `app.name` resource attribute on `leaderboard` spans

---

# Challenge 4: Clean Your Telemetry

You've identified five telemetry problems in the feed. Now you'll
fix them using the OpenTelemetry Transformation Language (OTTL) —
a small expression language built into the Collector for reading
and writing telemetry.

Two processors handle this work:

- **`transform`** — modifies span or resource attributes in place
- **`filter`** — drops spans entirely before they reach the backend

---

## Load the Lab 2 template

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab.
2. Select **⚙ Deploy & Configure** in the app's left navigation.
3. Select **Load template → OTTL transforms**.
4. Read through the scaffolding. Each commented block is labeled
with a Fix number — you'll uncomment them one at a time in the
steps below.
5. Select **◈ Visualizer** and view **Split** in the feed header.
The Split view shows spans before and after your transforms side
by side — spans with changes get an amber border in the After
column.

> [!NOTE]
> The Split view only populates after the Lab 2 template is loaded.
> If the After column is empty, confirm the template was applied
> and the Collector restarted successfully.

---

## Fix 1 — Normalize high-cardinality SQL span names

The `score-api` service creates spans whose names are raw SQL
queries. Those names are unique per query and make every trace
look different even for identical operations.

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. Find the Fix 1 block in the `transform/normalize` processor.
3. This statement matches any span whose name begins with a SQL
keyword and collapses the whole name down to `db.query` — turning
thousands of unique per-query span names into one stable, queryable
label. In the `transform/normalize` processor, find the Fix 1 comment
and uncomment the line below it:
```yaml
- replace_pattern(span.name, "^(SELECT|INSERT|UPDATE|DELETE|CREATE).*", "db.query")
```
4. Add `transform/normalize` to the end of the `processors` list in
the `traces` pipeline under `service.pipelines`. It should come after
`batch`.
5. Select **Apply & Restart**. You should see "Config saved. Collector restarted successfully."
6. Select **◈ Visualizer** and check the Split view. SQL span names
should be normalized in the After column.

---

## Fix 2 — Redact player.id PII

The app attaches a `player.id` attribute to many spans. This is a
user identifier and shouldn't be stored as-is.

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. Find the Fix 2 block in the `transform/normalize` processor.
3. This statement replaces the value of `player.id` with `***` on
every span that carries it — the key is preserved so you can confirm
PII was present, but the actual identifier is never stored. In the
`transform/normalize` processor, find the Fix 2 comment and uncomment
the line below it:
```yaml
- set(span.attributes["player.id"], "***") where span.attributes["player.id"] != nil
```
4. Select **Apply & Restart**. You should see "Config saved. Collector restarted successfully."
5. Expand a span in the After column. Confirm `player.id` shows
`***`.

---

## Fix 3 — Drop health probe spans

The web services emit spans for every `/health` and `/ready` HTTP
request. These are high-volume, low-value noise.

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. This processor drops any span whose name matches a health probe URL
pattern before it reaches any downstream processors — catching probes
here means they never cost you batching or transform work. In the
`processors:` section, find the Fix 3 comment and uncomment the
entire `filter/drop_probes` block below it:
```yaml
filter/drop_probes:
  error_mode: ignore
  traces:
    span:
      - 'IsMatch(name, "^(GET|POST) /(health|ready)$")'
```
3. Add `filter/drop_probes` to the `processors` list in the `traces`
pipeline under `service.pipelines`. It should come before `batch` so
spans are dropped before they're batched for export.
4. Select **Apply & Restart**. You should see "Config saved. Collector restarted successfully."
5. Confirm no `/health` or `/ready` spans appear in the feed.

> [!IMPORTANT]
> Order matters. The `filter` processor should run before
> `transform` in your pipeline — drop spans you don't need before
> spending time transforming them.

---

## Fix 4 — Truncate long attribute values

Some attribute values are very long strings — full user-agent
strings, raw stack traces. These inflate storage and make traces
noisy.

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. Find the Fix 4 block in the `transform/normalize` processor.
3. This statement applies a single character limit to every attribute
on a span at once — long values like full user-agent strings get cut
to 128 characters, reducing span size without removing the attribute.
In the `transform/normalize` processor, find the Fix 4 comment and
uncomment the line below it:
```yaml
- truncate_all(span.attributes, 128)
```
4. Select **Apply & Restart**. You should see "Config saved. Collector restarted successfully."
5. Find a span with a `browser.user_agent` attribute in the Split
view. Confirm the After column shows a truncated value.

---

## Fix 5 — Remove a redundant resource attribute

The `leaderboard` service attaches an `app.name` attribute at the
resource level, duplicating data already in `service.name`.

1. Select **⚙ Deploy & Configure** in the app's left navigation.
2. Find the Fix 5 block in the `transform/normalize` processor.
3. This statement removes `app.name` from the resource of every span
that has it — the same value is already stored in `service.name`, so
keeping both wastes storage. In the `transform/normalize` processor,
find the Fix 5 comment and uncomment the `delete_key` line inside the
`resource` context block:
```yaml
- delete_key(resource.attributes, "app.name")
```
4. Select **Apply & Restart**. You should see "Config saved. Collector restarted successfully."
5. Find a `leaderboard` span in the Split view. Confirm `app.name`
is absent in the After column.

---

## Verify

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **◈ Visualizer**.
2. Confirm the **⚠ smells** counter in the feed header reads **0**.
3. Review the Split view — the Before column shows raw spans, the
After column shows cleaned-up versions with amber borders on
modified rows.

> [!IMPORTANT]
> If the counter is still above 0, select an orange-highlighted
> span to see which attribute is still flagged, then revisit the
> corresponding fix above.

---

## Success criteria

- The smells counter reads **0**
- SQL span names in the After column show `db.query`
- `player.id` shows `***` in the After column
- No `/health` or `/ready` spans appear in the feed
- `browser.user_agent` values are truncated to 128 characters
- `app.name` is absent from `leaderboard` spans in the After column

---

# Challenge 5: Checkpoint and Handoff

You've built a working Collector pipeline and cleaned up five
telemetry quality problems. Before you finish, confirm your final
config is complete.

---

## Verify your config

1. Select the [button label="OpenTelemetry Arcade"](tab-0) tab and select **⚙ Deploy & Configure** in the app's left navigation.
2. Review your current `collector-agent-config.yaml`. Confirm your
config has all of the following:
   - All five OTTL fixes uncommented in `transform/normalize`
   - The `filter/drop_probes` processor wired before `batch` in the
   traces pipeline
   - All three pipelines exporting to `otlp_grpc/backend` and
   `otlp_http/visualizer`

> [!NOTE]
> If you need a reference, load **Workshop 1 complete** from the
> **Template** dropdown — it contains all five Lab 2 fixes applied
> and wired into the pipeline. Apply it and continue from there. This
> is the expected starting state for Workshop 2.

---

## Confirm your environment is ready for Workshop 2

Workshop 2 picks up exactly where you are now. The only step you'll
need to repeat is adding your Honeycomb API key — the pipeline
config carries over.

Keep the following handy for Workshop 2:

- Your Honeycomb API key
- Your `otel-arcade-workshop` environment in Honeycomb

---

## What you built

In this workshop you:

- Wired a working OTel Collector pipeline from receivers through
processors to exporters
- Connected your pipeline to Honeycomb
- Used OTTL to fix five real telemetry quality problems
- Used the `filter` processor to drop high-volume noise before it
reaches the backend

Workshop 2 builds on this foundation — you'll configure Collector
self-telemetry, set up an agent-to-gateway architecture, and explore
advanced patterns like tail sampling and routing.

---

## Success criteria

- The smells counter in the Visualizer reads **0**
- All five fixes are applied and the traces pipeline processors list
reads `[memory_limiter, filter/drop_probes, batch, transform/normalize]`
- Traces are visible in your `otel-arcade-workshop` Honeycomb
environment
