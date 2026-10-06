# Spike AI

zerospike's in-app assistant. The regulation-critical core (system prompt, output
filter, data boundary) ships as the edge function `supabase/functions/ai-ask-spike/`,
which calls Claude on Amazon Bedrock. The RN side is `lib/ai/spikeClient.ts` (request,
streaming), `lib/ai/spikeContext.ts` (summary packet) and `lib/services/spikeConsent.ts`
(the two consents).

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
  of it (the /64 prefix for IPv6), deleted after 2 days.

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
Under every reply render `spike.disclaimer`.

Limits: the app meters free 3 / pro 50 messages a day for the user's benefit. The
function does not trust that: the `tier` field comes from the client and cannot be
verified, so anyone can claim pro. What really bounds cost is enforced in Postgres
before the model is called (`spike_reserve`), three ceilings that hold together: a
device and UTC day gets 3 messages when it says free and 50 when it says pro (so a
device that lies gets 50, never more); a caller address gets `SPIKE_IP_HOURLY_CAP`
(60) requests an hour, which is what bounds someone who rotates device ids; and the
whole service gets `SPIKE_GLOBAL_DAILY_CAP` (3000) calls per UTC day, which bounds
the bill whatever else happens.

## HUMAN steps

1. `supabase db push` (applies `spike_calls`, 90-day retention, service-role-only grants,
   and `spike_hardening`: the atomic reservation, address and global counters). Push it
   BEFORE deploying the function: the new version answers 503 until `spike_reserve` exists.
2. `supabase secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...`
   (optional: `AWS_REGION`, `SPIKE_MODEL`, `AWS_SESSION_TOKEN`). Model access must be
   enabled in the Bedrock console for that region.
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
