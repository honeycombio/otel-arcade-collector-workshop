# Lab 2: Cleaning Up Telemetry with OTTL

## What you'll do

Use the OpenTelemetry Transformation Language (OTTL) to fix five real telemetry quality problems baked into the OTel Arcade. The Visualizer will tell you how many problems remain as you work through each one.

## Prerequisites

- Lab 1 complete: the Collector is running and spans are flowing to the Visualizer
- The Visualizer feed is showing live spans at **http://localhost:3000**

---

## Concepts

Real instrumentation is almost never perfect when it first arrives at the Collector. Common problems include:
- **High-cardinality span names** — unique values (SQL queries, URLs with IDs) that blow up your trace index
- **PII in attributes** — player IDs, emails, or other personal data that shouldn't be stored
- **Noise** — health probes and readiness checks that aren't useful as traces
- **Redundant attributes** — data duplicated at both the span and resource level

The Collector's `transform` processor lets you fix these in the pipeline using OTTL — a small expression language for reading and writing telemetry. The `filter` processor lets you drop spans entirely.

The Visualizer highlights problematic spans in orange and counts them with a **⚠ N smells** badge in the feed header. Your goal is to get that counter to zero.

---

## Before you start: look at the feed

Before loading the Lab 2 template, spend a minute in the Visualizer feed with your Lab 1 config still running.

- What patterns do you see in the span names? Do any look like they contain dynamic or high-cardinality values?
- Click on a highlighted (orange) span and expand it. What attribute looks wrong?
- Notice the **Split** button in the feed header — it's grayed out for now. It activates once you load the Lab 2 template, which adds the pipeline that feeds the Before column.

Try to name the five problems before you look at the template hints.

---

## Steps

### 1. Load the Lab 2 template

In the Collector editor, click **Load template → Lab 2 — OTTL transforms**.

The template adds:
- A `transform/normalize` processor with commented-out OTTL statements for each fix
- A scaffolded `filter/drop_probes` processor block for Fix 3
- A `traces/raw` pipeline that sends pre-transform spans to the Visualizer's Before column

Read through the scaffolding. Each commented block has a hint about what it should do.

### 2. Fix 1 — Normalize high-cardinality SQL span names

The `score-api` service creates spans whose names are raw SQL queries. Those names are unique per-query and make every trace look different even for identical operations.

In the `transform/normalize` processor, find the Fix 1 block. You need an OTTL statement that:
- Matches span names starting with a SQL keyword (`SELECT`, `INSERT`, `UPDATE`, etc.)
- Replaces the whole name with a normalized value like `db.query`

The OTTL function you want is `replace_pattern`. It takes a field, a regex pattern, and a replacement string.

Apply your change and look at the split view. Do the SQL spans look different in the After column?

### 3. Fix 2 — Redact PII in player.id

The app attaches a `player.id` attribute to many spans. This is a user identifier and shouldn't be stored as-is.

Write an OTTL statement that sets `attributes["player.id"]` to a placeholder value, but only when the attribute is present. The `where` clause lets you add a condition.

After applying, expand a span in the After column. What does `player.id` show now?

### 4. Fix 3 — Drop health probe spans

The web services emit spans for every `/health` and `/ready` HTTP request. These are high-volume, low-value noise.

This fix uses the `filter` processor (not `transform`), because you want to drop the span entirely rather than modify it.

The hint uses `IsMatch` — a function that tests a value against a regex. The filter block is already scaffolded; you need to uncomment it and wire it into your pipeline in the right position. Think about where in the processor chain it should go — before or after your transforms?

### 5. Fix 4 — Truncate long attribute values

Some attribute values are very long strings (full user-agent strings, raw stack traces). These inflate storage and make traces noisy.

The OTTL function `truncate_all` applies a length limit to every attribute on a span at once. Add it to your transform statements.

### 6. Fix 5 — Remove a redundant resource attribute

The `leaderboard` service attaches an `app.name` attribute at the **resource** level, duplicating data already present in the standard `service.name` resource attribute.

Resource-level attributes use a different OTTL context than span attributes. The function is `delete_key`, but you need it to run in the `resource` context, not the `span` context.

In the `transform/normalize` processor, look for how to specify a context. Add a statement that deletes `app.name` from resource attributes.

### 7. Check the smells counter

After all five fixes are applied, the **⚠ smells** counter in the Visualizer feed header should reach zero. If it's still showing a number, expand a highlighted span to see which attribute is still flagged.

---

## What success looks like

- The smells counter reads **0**
- The Before column in split view shows raw, messy spans; the After column shows cleaned-up versions with amber borders on modified rows
- SQL span names in the After column are normalized (not raw queries)
- `player.id` is redacted in the After column
- No health probe spans appear in the feed at all

---

## OTTL quick reference

| Function | What it does |
|---|---|
| `replace_pattern(field, regex, replacement)` | Regex-replace a field value |
| `set(field, value) where condition` | Set a field conditionally |
| `truncate_all(attributes, limit)` | Trim all attribute values to max length |
| `delete_key(attributes, key)` | Remove a single attribute |
| `IsMatch(field, regex)` | Test a value against a regex (use in `where` or `filter`) |

OTTL contexts: `span` attributes use `attributes["key"]`; resource attributes use a `resource` context block in the transform processor. Check the scaffolding for the exact syntax.

---

## Going further

- Use the **TelemetryGen** page (`/telemetrygen.html`) to fire a specific span with controlled attributes. This is useful for testing whether your OTTL expression handles an edge case correctly — you don't have to play the game to trigger the exact attribute value you're working with.
- Try the **Logs** and **Metrics** signal tabs in the feed. Are there any smells in those signals worth fixing?

### Bonus: two more deliberate smells

Two games hide extra problems that the smells counter doesn't track. If you've finished the five required fixes and want more, these are worth finding.

**Simon Says** — play a round and find the `sequence_shown` event span in the Visualizer. Look at its attributes. One of them reveals the full Simon Says sequence to any observer of the telemetry. How would you redact or remove it?

**Word Scramble** — play a round with a wrong guess. Find the `guess_wrong` span. One attribute exposes the correct answer, even when the player failed. What OTTL statement would remove it?

Neither of these is tracked by the smells counter — fixing them is optional. Use the split view to verify that your transforms are working: the Before column should show the raw attribute, and the After column should show it redacted or absent.
