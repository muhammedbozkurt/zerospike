# zerospike R5 - delivery report

Big-tour build. Every phase gated on `npx tsc --noEmit` + `node scripts/i18n-check.js`.
`app.json` version/build **not touched** (bump owned by the release hub). No em-dashes
in shipped strings; every new string is in all 5 locales (tr schema source).

## Gate status (final)

```
npx tsc --noEmit            → exit 0
node scripts/i18n-check.js  → OK (550 schema keys, no missing static t() keys)
```

i18n key count 565 → 550: removed 24 pen keys, added 3 insulin-type + 1 streak + 5 heat-map.

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 0 | Remove insulin-pen feature | **Done, verified** |
| 1 | Design system + motion language | **Done, verified** |
| 2 | Redesign screens | **Core done** (dashboard weekly, journal motion, injection tab); rest follow the same pattern |
| 3 | Unified quick-log flow | **Deferred** (plan below) |
| 4 | Injection heat map | **Done, verified** |
| 5 | mySugr-parity PDF report | **Deferred** (pen column removed; plan below) |
| 6 | Spike AI | **Core done** (edge function + docs); RN client/consent deferred |
| 7a | Notification hardening | **Done, verified** (JS); entitlement is a HUMAN step |
| 7 | Shared live-data source (JS spine for LA/widget/watch) | **Done, verified** |
| 7b/8/9 | Live Activity, widget, watch (native targets) | **Documented + HUMAN** (`docs/native-live-surfaces.md`) |

This is one session of an explicitly multi-week contract; the finished phases are
complete and gate-green, the rest are specced with concrete file paths and HUMAN steps.

## Phase 0 - pen removal

Direct-field injections replace pen/stock tracking. User now picks the insulin type
(basal/bolus segmented) directly; the picker seeds from the last-used type. Injection
history fully preserved.

- **Migration decision** (`lib/db/index.ts`, schema v6→v7): `DROP TABLE IF EXISTS
  insulin_pens`. With FKs ON, the FK's `ON DELETE SET NULL` nulls every
  `injection_logs.pen_id` first, so **no injection row is deleted**. Fresh installs get
  no `insulin_pens` table and no `pen_id` column; pre-R5 installs keep a dormant
  `pen_id` column (never read/written; inert dangling FK since we only ever write NULL).
- **Removed**: `app/pens.tsx` + route; pen CRUD/accounting + `updateInjection` refunds
  (`lib/db/injections.ts`); `maybeNotifyPenLow` + low-pen constants
  (`lib/services/notifications.ts`); `penLow` pref (`notificationPrefs.ts`); dashboard
  active-pen card; injection low-pen banner + pen picker + "My pens" links; settings
  pen-low + pens rows; onboarding `penLow`; paywall `pens` reason; pen column in
  report/CSV export; demo pens; journal pen join; all `pen.*` i18n + related keys.
- **Files**: `app/(tabs)/index.tsx`, `app/(tabs)/injection.tsx`, `app/(tabs)/settings.tsx`,
  `app/onboarding.tsx`, `app/paywall.tsx`, `app/_layout.tsx`, `components/InjectionEditSheet.tsx`,
  `components/JournalItem.tsx`, `lib/db/{types,injections,index,journal,demo}.ts`,
  `lib/services/{notifications,notificationPrefs,report,export}.ts`, 5 locale files.

## Phase 1 - design system + motion

- `lib/theme/tokens.ts` - single source: color palette, spacing (4/8pt), radii,
  elevation, type scale, `TABULAR` (tabular figures), `HIT_TARGET` 44pt, and the
  **glucose color language** (`GLUCOSE_COLORS`).
- `lib/theme/motion.tsx` - `DURATION`, `SPRING`, `stagger`, `FadeSlideIn`, `useCountUp`,
  `PressableScale` (press 0.96 + haptic), list entering/exiting/layout. **Every
  primitive honors Reduce Motion** (snaps to final state). `components/onboarding/motion.tsx`
  now re-exports these (deduped).
- Components: `AnimatedNumber`, `StatCard`, `Sparkline`, `Skeleton`(+`SkeletonGroup`),
  `EmptyState`, and `IconRow`/`SegmentedStat` (in `components/ui.tsx`).
- `lib/theme/fonts.ts` - typography scaffolding.

### ⚠️ Glucose color language changed (please confirm)

R5 spec mandated: **low=red, target=green, high=amber, very-high=orange**, one source,
every surface. Implemented in `GLUCOSE_COLORS` → `lib/glucose.ts STATUS_COLOR` →
`tailwind.config.js` (mirror) → charts. **This replaces the previous deliberate
blue-for-low palette** (whose rationale was avoiding red-vs-green confusion). The app
never relies on color alone - every reading shows its value + period label - but this
is a real change to a prior safety-reviewed decision, so it's called out here.

### Font decision

Custom `.ttf` binaries can't be produced in this environment. The **type scale + tabular
figures ship now** on the system font (`fontVariant: tabular-nums` → count-ups never
shift width). Enabling a licensed family (Lexend/Inter) is a HUMAN drop-in documented in
`lib/theme/fonts.ts` (add `.ttf` + license under `assets/fonts/`, `useFonts`, set
`FONT_FAMILY`). expo-font is already installed.

## Phase 2 - core screens

- Dashboard "This week": two `StatCard`s (avg glucose with `Sparkline`, colored by the
  glucose language; time-in-range) + a `SegmentedStat` strip (readings / injections /
  streak), animated counts, `EmptyState` when empty.
- Journal feed rows stagger in (`listEntering`, reduced-motion aware).
- Injection tab: heat map centerpiece (Phase 4), direct insulin-type picker.

## Phase 4 - injection heat map

`components/InjectionBodyMap.tsx`: front body silhouette (SVG), 8 sites shaded by
last-30-day usage intensity (brand-cyan opacity ramp - not a glucose color), count
badges, dashed neutral **least-used** marker, tap-to-select. Replaces the 2-column site
grid in `app/(tabs)/injection.tsx`. Language is neutral ("last 30 days", "least used");
no "recommended". Empty state faint.

## Phase 7 - notifications + live-data spine

- **7a** (`lib/services/notifications.ts`): iOS **Time-Sensitive** interruption level on
  the four actionable reminders (post-meal, basal, glucose, low-follow-up); weekly/trial
  stay standard. Android already HIGH-importance. **Critical Alerts deliberately NOT
  used** (medical-device risk). Text stays neutral.
- **Shared source** (`lib/services/liveData.ts`): one `LiveData` snapshot (next reminder
  time + last glucose value/time) written to shared storage; every live surface reads
  it. Refreshed from the dashboard. App Group write seam documented.

## Phase 6 - Spike AI (core)

`supabase/functions/ai-ask-spike/index.ts` - the regulation-critical system prompt
(logbook + general education only; **never a dose number**; no diagnosis/treatment;
emergency → one calm sentence; **no health records ever sent**) + input caps.
`tsconfig.json` excludes `supabase/` so the Deno function isn't in the app build.
Consent copy, data boundary, RC daily-cap plan, and client wiring in `docs/spike-ai.md`.

## Deferred phases - plans

- **Phase 3 (unified quick-log)**: one bottom sheet opened from anywhere with a
  glucose/meal/insulin segment; existing `GlucoseInputSheet`/`InjectionEditSheet`/food
  flows nest under it; primary action is one tap. Dashboard already surfaces "most
  relevant now" (post-meal timer / last reading). Estimated: 1 new sheet + FAB wiring.
- **Phase 5 (mySugr-parity report)**: `lib/services/report.ts` currently base + AGP SVG
  + tables (pen column already removed). Add: summary stat chips (reuse StatCard visual
  language), colored range ruler (glucose colors), weekly summary, and the 24-hour
  daily timeline SVG (basal/bolus/glucose/carb lanes, per-day total) built with the
  `buildAgpSvg` pattern, embedded in the expo-print HTML. No medical interpretation.
- **Phase 6 client + consent gate**: see `docs/spike-ai.md`.
- **Phases 7b/8/9 (native)**: see `docs/native-live-surfaces.md`.

## HUMAN steps (cannot be done/verified here)

1. **Font** (optional): add licensed `.ttf` + license to `assets/fonts/`, wire per
   `lib/theme/fonts.ts`.
2. **iOS Time-Sensitive entitlement**: add
   `com.apple.developer.usernotifications.time-sensitive` in `app.json`, prebuild.
3. **Spike deploy**: `supabase secrets set OPENAI_API_KEY=…`; `supabase functions deploy
   ai-ask-spike`; wire the URL + RC daily cap.
4. **Native targets** (LA/widget/watch): install `@bacons/apple-targets` +
   `react-native-android-widget`; Apple Developer portal (App Group
   `group.com.greeneyeapp.zerospike`, Live Activity capability, Watch app id +
   provisioning); App Group entitlement + `NSSupportsLiveActivities`; EAS credentials;
   `expo prebuild --clean`; device build. Full checklist in `docs/native-live-surfaces.md`.
5. **Device QA + native signing + service deploy** in general.
6. **Do not bump** `app.json` version/build (release hub).

## Recommended commits (per phase)

1. `feat(injection): remove insulin-pen feature; log insulin type directly (schema v7)`
2. `feat(design): design tokens, glucose color language, motion library + component kit`
3. `feat(dashboard): weekly StatCards + sparkline + journal enter motion`
4. `feat(injection): body-map usage heat map replacing the site grid`
5. `feat(notifications): iOS Time-Sensitive reminders + shared live-data source`
6. `feat(spike): ai-ask-spike edge function (system prompt + data boundary) + docs`
7. `docs: native live-surfaces + spike-ai + R5 delivery report`
