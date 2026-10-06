# zerospike

An offline-first diabetes logbook for iOS and Android. Glucose readings, meals
and injections go in; descriptive summaries, a doctor-ready report and a set of
glanceable surfaces come out.

zerospike is **not a medical device**. It records what the user enters and
describes it back. It never diagnoses, never recommends a treatment, and never
tells anyone how much insulin to take: the calculator is arithmetic over the
user's own ratios, and every figure it produces stays editable.

- **Bundle ID:** `com.greeneyeapp.zerospike`
- **Stack:** Expo SDK 57 · Expo Router · TypeScript · NativeWind v4 ·
  expo-sqlite · expo-camera · expo-notifications · react-native-svg ·
  react-native-purchases

## What it does

**Four tabs:** Dashboard (today as a live journal, with the last reading as the
hero ring), Meals, Injection, Settings. A profile that takes no insulin drops
the Injection tab and the whole dose apparatus.

- **Glucose logging.** A bottom sheet with one large numeral that takes its
  colour from the same classification the rest of the app uses, a period tag,
  optional context tags (sport, illness, stress, travel, alcohol) and a
  backdatable timestamp.
- **Meals.** A 1403-item multilingual food catalogue with FTS5 search across nine
  name columns (en, tr, de, fr, es, it, pt, ar, ja) plus synonyms, barcode
  scanning (Open Food Facts, cached locally so the second scan of a product
  works offline), custom foods, and one-tap re-log of recent meals.
- **Dose calculator.** carbs ÷ carb ratio, plus an optional correction toward
  the middle of the user's post-meal range, minus active insulin. Logging a meal
  also stores the glucose reading that was typed and, for a mealtime-insulin
  user, the matching bolus row, so active-insulin tracking actually sees it.
- **Injections.** A usage map at rotation-POINT resolution: eight body regions,
  each split into four points, coloured by how often and how recently the user
  used them. A picture of their own history, never a placement instruction.
- **Insights.** Time in range against the user's own target band, an AGP daily
  profile, daily averages, a percentile summary, time-of-day means, descriptive
  patterns, and a GMI estimate that is withheld until the sample can carry it.
- **Doctor report.** A one-tap PDF: summary tiles, the AGP chart drawn from the
  same geometry the app renders, and the full log tables. CSV export follows the
  profile's display unit and names it in its own column.
- **Spike.** An in-app assistant for app help and general diabetes education
  (Claude on Amazon Bedrock), behind an explicit consent gate and metered per
  day. It never returns a dose number: an output filter replaces any reply that
  would. Only the typed question and the chat window are sent. A separate,
  off-by-default switch adds a 14-day summary computed on the device (counts,
  averages, target range, meal tags, injection regions, logging habits, diabetes
  type, insulin, pills or neither); no single reading, timestamp, insulin amount
  or Health record is ever included.
- **SOS.** A calm screen that opens the dialer on the region's emergency number
  or hands a prefilled message (optionally with a location link) to a contact.
  Nothing is ever sent or dialled automatically.
- **Reminders.** Post-meal check with a live countdown, night insulin, glucose
  check, weekly summary, and an optional follow-up after a low reading.
- **Glanceable surfaces.** An iOS home-screen widget and post-meal Live Activity
  (lock screen + Dynamic Island), and an Android home-screen widget. All three
  render the same snapshot the app writes.
- **Family mode.** Multiple profiles, each with its own targets, ratios, unit
  and logs.

## Regulatory posture

- Neutral language throughout. No "alarm", no "warns you", no "recommended
  dose"; a dose is always "calculated" and always editable.
- The rotation map and every insight are descriptive summaries of the user's own
  entries.
- Spike declines dose questions in one sentence and points to the care team.
- Estimates carry a disclaimer at the point of decision, not only in Settings.
- A default ratio is never presented as if the user had chosen it: until they
  confirm their own ICR/ISF, the calculator says so on the result.

## Architecture

**SQLite is the single source of truth.** The app works fully offline and the
journal never leaves the device. What can leave it is opt-in or on request:
Spike messages (and, only with its own consent, the 14-day summary), usage
analytics (off until the user agrees) and the RevenueCat purchase records.
Crash reports (Crashlytics) and Open Food Facts lookups (barcode, food name) are
not behind a switch. `docs/apple-ads/privacy-2.3.7.md` has the exact lists.

```
app/                 expo-router screens (tabs + modal routes)
components/          shared UI
  rich/              the Midnight Monitor visual vocabulary
  charts/            AGP, trend and hourly charts
lib/
  db/                schema + migrations (v24), typed data access
  services/          notifications, health, export/report, purchases, live data
  analytics/         opt-in usage analytics: consent, event schema, outbox, sinks
  ai/                Spike client and the on-device 14-day summary packet
  identity/          the random per-install ID
  i18n/locales/      en, tr, de, fr, es, it, pt, ar, ja
  theme/             design tokens (mirrored in tailwind.config.js)
  glucose.ts         units + classification (the one glucose language)
  insulin.ts         the dose estimator + plausibility guardrails
  iob.ts             active insulin from logged bolus doses
modules/             local native modules (the Live Activity bridge)
targets/widget/      iOS WidgetKit + ActivityKit target (Swift)
supabase/functions/  ai-ask-spike, track, rc-webhook, delete-device (Deno, deployed separately)
supabase/migrations/ server schema: analytics, subscription events, Spike limits
scripts/             gate scripts, the math test suites, Apple Ads tooling
```

### Data model (schema v24)

`user_profiles` carries the personal numbers: target RANGES (fasting and
post-meal, each a min and a max), the user's own low threshold, a carb ratio per
meal slot, insulin sensitivity, a daily carb range, display unit, diabetes type
(wording only, never a calculation input), insulin mode, and whether the ratios
were confirmed by the user or are still defaults.

`sugar_logs`, `meal_logs` and `injection_logs` hold the entries. Injections
carry a region, an optional rotation point (1-4), and where the row came from.
The insulin-pen stock feature was removed in R5; its last dormant column was
dropped in the v8 table rebuild.

`analytics_queue` (v24) is the on-device outbox of the opt-in analytics sink. It
has no profile and no foreign key, so clearing a profile's logs never touches it.

## Development

Use `npx expo install` for Expo-managed packages so SDK-compatible versions are
picked.

```bash
npm install
npm start          # Expo dev server
npm run ios        # or: npm run android
```

Gates, all of which must pass:

```bash
npm run typecheck                    # tsc --noEmit + i18n key check
npm run i18n:check                   # i18n key check + regulatory-wording scan (reg:check)
npx tsx scripts/calc.test.ts         # units, classification, dose math, IOB
npx tsx scripts/feedback.test.ts
npx tsx scripts/offParse.test.ts
```

The other suites in `scripts/*.test.ts` (analytics consent and schema, Spike
summary, purchases, trial timeline, Pro welcome, onboarding steps, migrations)
print their exact run command in the file header. The Spike output filter has a
Deno suite, see `supabase/functions/ai-ask-spike/README.md`.

Every new string is added in all nine languages (en, tr, de, fr, es, it, pt, ar,
ja). The translation schema is `lib/i18n/locales/tr.ts`; TypeScript enforces
parity across the other eight.

### Native steps

The widget and the Live Activity need work outside this repo:

- `npx expo prebuild` and a device build, with the App Group
  `group.com.greeneyeapp.zerospike` and the Live Activity capability enabled in
  the Apple Developer portal and in EAS credentials.

### Server side (Supabase)

Four edge functions and the migrations behind them are deployed by hand, never
by the app build. Push the migrations first: the new `ai-ask-spike` calls
`spike_reserve` and answers 503 until it exists.

```bash
supabase db push   # app_events, spike_calls, subscription_events_retention, spike_hardening
supabase secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=eu-central-1
supabase secrets set RC_WEBHOOK_SECRET=...
supabase functions deploy ai-ask-spike --no-verify-jwt
supabase functions deploy track --no-verify-jwt
supabase functions deploy rc-webhook --no-verify-jwt
supabase functions deploy delete-device --no-verify-jwt
supabase secrets unset OPENAI_API_KEY   # once the new ai-ask-spike is verified live
```

| Secret | Needed | Default and notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | an IAM user that may call the model through Bedrock only; the model must be enabled for the region in the Bedrock console |
| `AWS_REGION` | no | `eu-central-1`; only `eu-central-1`, `eu-west-1`, `eu-west-3` and `eu-north-1` are accepted |
| `SPIKE_MODEL` | no | `anthropic.claude-sonnet-5-5`; `anthropic.claude-opus-5-5` and `anthropic.claude-haiku-4-5` are the other accepted values |
| `SPIKE_GLOBAL_DAILY_CAP` | no | `3000` model calls per UTC day, all callers |
| `RC_WEBHOOK_SECRET` | yes | must equal the Authorization value set in RevenueCat's webhook; without it `rc-webhook` answers 401 to everyone |
| `TRACK_GLOBAL_DAILY_CAP` | no | `500000` analytics rows per UTC day, all devices |

`AWS_SESSION_TOKEN` (temporary credentials only) and `SPIKE_IP_HOURLY_CAP` are
described in `supabase/functions/ai-ask-spike/README.md`. In RevenueCat >
Integrations > Webhooks, point the webhook at
`https://<project-ref>.supabase.co/functions/v1/rc-webhook` and put the same
value in its Authorization header. The function URLs live in `app.json`
(`expo.extra.spikeFnUrl`, `trackFnUrl`, `deleteDeviceFnUrl`). Until
`spikeFnUrl` is set, every Spike entry point stays hidden rather than opening a
dead end; without `trackFnUrl` the analytics sink stays off.

The three retention jobs are scheduled by the migrations when pg_cron is
enabled. After `db push`, check them in the SQL editor:

```sql
select jobname, schedule from cron.job
 where jobname in ('purge-app-events', 'spike-logs-retention', 'purge-subscription-events');
```

Three rows are expected. Fewer means pg_cron is not enabled: enable it in the
Supabase dashboard and run the commented `cron.schedule` line of each migration
once. Retention is 180 days for `app_events`, 90 days for the Spike counters and
call log, and 24 months for `subscription_events` (its raw webhook body 90 days).

### Apple Ads (release day)

The US test campaign (`ZS-US-Test`, 14 days, 3.50 USD a day) is created PAUSED
and switched on the day the release goes live. The developer runs these by hand;
credentials and every option are in `scripts/apple-ads-README.md`.

```bash
node scripts/apple-ads-setup.mjs --dry-run --market us                    # plan only, no network
node scripts/apple-ads-setup.mjs --apply --market us --start YYYY-MM-DD   # apply: creates it PAUSED, YYYY-MM-DD is the release day (UTC)
node scripts/apple-ads-status.mjs enabled ZS-US-Test                      # enable on release day
node scripts/apple-ads-report.mjs --days 14 --prefix ZS-US-Test           # read-only report
```
