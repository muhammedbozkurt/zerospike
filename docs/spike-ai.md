# Spike AI

zerospike's in-app assistant. The regulation-critical core - the system prompt and
the data boundary - ships as the edge function `supabase/functions/ai-ask-spike/`.
The RN client + consent gate are specced below (not yet built this round).

## What Spike is (and is not)

- A **logbook + general diabetes-education + app-help** assistant.
- **Never** gives a dose number, diagnosis, treatment, or medication change (kind
  refusal → "ask your healthcare professional").
- On emergency symptoms: one calm sentence pointing to professional help. No panic.
- Every reply is shown under a fixed disclaimer: **"Spike does not give medical advice."**

The hard rules live in `SYSTEM_PROMPT` inside the edge function. Change them there.

## Data boundary (v1)

Only the **typed question + the trailing chat window** are sent. **No health records**
(glucose / meals / insulin) are attached, and the system prompt contains no user data.
The client MUST NOT put records into `messages`. The edge function also slices to the
last 16 messages and caps each at 1500 chars.

## Consent gate (Apple 5.1.1 lesson)

Before the first message, show an explicit consent screen and block until accepted:

- **What is sent**: only what you type and this chat.
- **To whom**: our server → OpenAI (processor).
- **What is NOT sent**: your glucose, meals, insulin, or any logged data.
- Link to the privacy policy.
- Neutral CTA: **"Accept and continue"** (TR "Kabul et ve devam et").

Persist consent with MMKV (or AsyncStorage) and be **fail-closed**: on launch, read the
flag; if unset, Spike is locked until accepted. Allow withdrawal in Settings (clears the
flag → consent required again). Add ~6 i18n keys (`spike.consentTitle`, `spike.sent`,
`spike.notSent`, `spike.recipient`, `spike.accept`, `spike.disclaimer`) across all 5
locales.

## Client wiring (to build)

- `lib/ai/spikeClient.ts`: POST `{ messages, lang }` to the function URL; return `reply`.
  Mirror statura's `lib/ai/askClient.ts`.
- Entry points (NOT a tab): an Insights/Settings row + a small dashboard card.
- Free/Pro **daily cap** via RevenueCat config (e.g. free 3/day, Pro 50/day). Enforce
  client-side with a per-day counter in MMKV; the exact numbers are a product call - pick
  in RC remote config and log the choice. (A server-side cap can be added later keyed by
  an anonymous device id + a `spike_usage` table.)
- Under every reply render `spike.disclaimer`.

## HUMAN steps

1. `supabase secrets set OPENAI_API_KEY=sk-...`
2. `supabase functions deploy ai-ask-spike` (deploy is HUMAN - not done here).
3. Put the function URL in app config; add the RC daily-cap entitlement/config.
4. Privacy policy: add the OpenAI processor + "no health data sent" line; link it from
   the consent screen.
