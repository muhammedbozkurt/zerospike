# Spike AI

zerospike's in-app assistant. The regulation-critical core (system prompt, output
filter, data boundary) ships as the edge function `supabase/functions/ai-ask-spike/`,
which calls Claude on Amazon Bedrock. The RN side is `lib/ai/spikeClient.ts` (request,
streaming), `lib/ai/spikeContext.ts` (summary packet) and `lib/services/spikeConsent.ts`
(the two consents; the chat consent is versioned, see below).

## What Spike is (and is not)

- A **logbook + general diabetes-education + app-help** assistant.
- **Never** gives a dose number, diagnosis, treatment, or medication change (kind
  refusal → "ask your healthcare professional").
- On emergency symptoms: one calm sentence pointing to professional help. No panic.
- With the summary consent on, it may **describe** the user's own 14-day summary and
  suggest logging habits (reminders, post-meal timer); it never interprets it.
- Every reply is shown under a fixed disclaimer: **"Spike does not give medical advice."**

The hard rules live in `prompt.ts` (system prompt) and `filter.ts` (output gate: a reply
that matches a dosing or diagnosis pattern is replaced with a fixed safe text in the
user's language) inside the edge function. Change them there.

## Data boundary (v2)

- **Always sent**: the typed question + the trailing chat window (last 16 messages,
  1500 chars each), the app language and the free/pro tier.
- **Only with the second, separate summary consent**: a 14-day summary packet
  (ContextPacket v1) built on the device: counts, averages, the target range, meal tag
  and injection region counts, logging gaps and streak, plus the profile details the
  consent screen lists (diabetes type; insulin, pills or neither; glucose unit). Never a
  single reading, a timestamp, an insulin amount, free text, or anything read from Apple
  Health / Health Connect. The request then carries `x-consent-context: 1`; a packet
  without it gets 403.
- The function whitelists and clamps the packet, rejects one over 2 KB, and puts it into
  that request's prompt only: it is never logged and never written to a table.
- **Processor**: Amazon Web Services (Amazon Bedrock, region `eu-central-1` unless
  `AWS_REGION` says otherwise), model Claude by Anthropic.
- **Stored server-side**: `spike_usage` (daily count per random device id),
  `spike_global_usage` (the day's total of calls) and `spike_calls` (model, token
  counts, latency, whether the filter replaced the reply). No message text, no
  summary. All three are deleted after 90 days (`purge_spike_logs()`). The same random
  install id is also what analytics events and the RevenueCat record carry, which is
  why the consent text lists all four uses. `spike_ip_usage` counts requests per caller
  address and hour for rate limiting: the address is never stored, only a keyed hash
  of it (the /64 prefix for IPv6), deleted after 2 days. `spike_reject_usage` counts
  rejected requests (429 only) per hour and reason (`ip`, `device`, `global`) with the
  cap and a count: no device id, no address hash, no text, so no personal data. It is
  increased inside `spike_reserve` and deleted after 90 days (`purge_spike_logs()`);
  the view `v_spike_gate_daily` gives the weekly report the rejection rate.

## Consent gate (Apple 5.1.1 lesson)

Fail-closed, two levels:

1. **Chat consent** before the first message: what is sent (what you type and this
   chat), to whom (our server → Amazon Web Services / Bedrock as processor), what is not
   sent (logged data, unless 2 is on), link to the privacy policy, neutral CTA
   **"Accept and continue"** (TR "Kabul et ve devam et"). Withdrawal in Settings
   re-locks Spike.
2. **Summary consent**, off by default, on its own screen: allows the 14-day summary
   packet. It can be turned off from the chat at any time and only counts while 1 stands.

## Client contract

POST `{ locale, tier, stream, messages, context }` with `x-device-id` (and
`x-consent-context: 1` when `context` is not null). `stream: true` answers with
server-sent events (`delta`... `done`); every `done` carries the final text in `reply`
(code fence and meta line already stripped) and the app shows that instead of the
streamed words; a filtered reply ends with `done{filtered: true, reply: <safe text>}`,
and `truncated: true` marks a reply the model cut off at its token ceiling. The full
contract and error codes are in the header of `supabase/functions/ai-ask-spike/index.ts`.
Render `spike.disclaimer` as a fixed note at the top of the chat.

Limits: the app meters free 3 / pro 50 messages a day for the user's benefit. The
function does not trust that: the `tier` field comes from the client and cannot be
verified, so anyone can claim pro. What really bounds cost is enforced in Postgres
before the model is called (`spike_reserve`), three ceilings that hold together: a
device and UTC day gets 3 messages when it says free and 50 when it says pro (so a
device that lies gets 50, never more); a caller address gets `SPIKE_IP_HOURLY_CAP`
(60) requests an hour, which is what bounds someone who rotates device ids; and the
whole service gets `SPIKE_GLOBAL_DAILY_CAP` (3000) calls per UTC day, which bounds
the bill whatever else happens.

## Carb estimate mode

`mode: "carb_estimate"` on the same function turns a free-text meal description into an
approximate carbohydrate estimate for the user's own log. Request
`{ mode, locale, tier, text }` (text 1-300 characters), response
`{ items: [{ name, quantity, unit, grams_carb }], total_grams_carb, filtered, charged, usage }`
(`charged`: true = a model call ran and the device slot is spent; false = refused by the medical pre-filter before any model call),
JSON only, one turn, no stream. It has its own system prompt (food carbohydrate
estimate only; no insulin, dose, treatment or diagnosis) and its own daily counter
(`ce:<deviceId>` through `spike_reserve`: free 1, pro 50) under the same address and
global ceilings; over the quota answers 429 `daily_limit_carb`. The same output gate
applies to the free-text fields and a request that mentions insulin or doses is refused
without a model call. An answer that does not fit the schema is 502 `estimate_failed` and the slot stays spent, the body being `{ error: "estimate_failed", charged: true }` so the client counts the use (the model ran and was billed, so the global cap keeps bounding the bill); only an upstream failure (model not reached) gives the slot back.
The meal text and the answer are neither stored nor logged; `spike_calls` gets only
`mode`, token counts and latency. The note "this is an estimate, not a dose" is fixed
client copy (i18n), not server text. Details: `supabase/functions/ai-ask-spike/README.md`.

### Carb estimate, app side (K27-P6)

- Files: `lib/ai/carbEstimateClient.ts` (one JSON POST, 45 s ceiling, error mapping:
  `daily_limit_carb` limit, `rate_limit`/`capacity` busy, `estimate_failed`/`upstream`/
  `unavailable` failed, `bad_request` input), `lib/ai/carbEstimateLimit.ts` (device-scoped
  daily tally, free 1 / pro 50, day key = UTC date like the server), `components/CarbEstimateSheet.tsx`.
- Entry: the Food tab (chip under the title row) and a button inside the meal sheet
  (`MealComposeSheet`, `onEstimate`). Hidden when `extra.spikeFnUrl` is unset.
- Consent: the same Spike consent, now **version 2** (`SPIKE_CONSENT_VERSION`, key
  `zerospike.spikeConsentVersion`). The version adds the paragraph `spike.consentCarb`. A
  consent stored without a version (v1) no longer counts, so existing users see the consent
  screen once more; without a current consent `estimateCarbs` throws `consent_required` and
  nothing is sent. The sheet shows the same consent text when it opens without consent.
- Flow: text (300 characters, example placeholder) -> "Estimate" -> editable rows (name,
  amount, unit, grams of carbohydrate) and a total, with the fixed note
  `carbEstimate.note` under every result -> "Add to log". Nothing is written when the
  result arrives: the journal row (`addMealLog`, insulin 0, portion 0) is written only by
  the Add button, from the edited figures. There is no dose calculation anywhere in the flow.
- Quota: the local tally only saves a free user a refused request; the server count binds.
  A `daily_limit_carb` answer fills the local tally. A free user at the limit sees the
  limit text plus a Pro line and the usual Pro button (paywall reason `spike`).
- Privacy: the meal text lives in component state only. It is not put in AsyncStorage, not
  logged and not in any crash context. Analytics (schema v3, counts only, no text and no
  grams): `carb_estimate_used {tier, item_count, source: food_tab|meal_sheet}` and
  `carb_estimate_blocked {reason: quota|filtered|error}`.
- Weekly report (`scripts/metrics-weekly.mjs`): server calls by mode from
  `spike_calls.mode` (`carb_estimate`, and how many were filtered) plus the two client events.

## HUMAN steps

1. `supabase db push` (applies `spike_calls`, 90-day retention, service-role-only grants,
   and `spike_hardening`: the atomic reservation, address and global counters). Push it
   BEFORE deploying the function: the new version answers 503 until `spike_reserve` exists.
2. `supabase secrets set AWS_BEARER_TOKEN_BEDROCK=... AWS_REGION=eu-central-1 SPIKE_MODEL_PREFIX=eu.`
   (Bedrock API key, bearer path; alternatively `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
   for the Mantle path; optional: `SPIKE_MODEL`, `AWS_SESSION_TOKEN`). Model access must be
   enabled in the Bedrock console for that region; `eu.` keeps inference inside EU regions.
3. `supabase functions deploy ai-ask-spike --no-verify-jwt`, then
   `supabase secrets unset OPENAI_API_KEY` once the new version is verified live.
4. Nothing to run by hand for the 90-day retention: the `cron_enable` migration
   (`20261006143100`, applied by the same `supabase db push`) enables pg_cron and schedules
   `purge-spike-logs` (`purge_spike_logs()`, daily 03:17 UTC) next to the two other purge jobs, and
   it drops the old `spike-logs-retention` job. The push fails if pg_cron cannot be created, so a
   missing job cannot go unnoticed. Check: `select jobname, schedule from cron.job;`.
5. Privacy policy and consent copy name Amazon Web Services (Bedrock) as the processor
   and describe the optional summary packet and the 90-day retention (done for 2.3.7 in
   all nine languages; keep them in step with any change here). The App Store privacy
   label and the Play Data safety form follow `docs/apple-ads/privacy-2.3.7.md`.
6. Eval before rollout: see `supabase/functions/ai-ask-spike/README.md`.
7. Carb estimate rollout: `supabase db push` for `20261019100000_spike_calls_mode.sql`, then
   deploy `ai-ask-spike` and **redeploy `track`** (event schema v3 adds the two carb events;
   until then the server drops them). Update the privacy policy, the App Store privacy label
   and the Play Data safety form for the meal text sent to the processor (not stored).
