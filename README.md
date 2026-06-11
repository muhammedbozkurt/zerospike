# Zerospike 🌴

Minimalist, **offline-first** glycemic index & glucose tracker.
Pure-black UI, 5 languages, local SQLite (with FTS5 search), barcode scanning,
time-based insulin estimation, multi-profile family mode, and real CSV export —
**no server, no mandatory login, everything works offline.**

- **Bundle ID:** `com.greeneyeapp.zerospike`
- **Stack:** Expo SDK 51 · Expo Router · TypeScript · NativeWind v4 · expo-sqlite (typed API) · expo-camera · expo-notifications · expo-file-system · expo-sharing · expo-localization

---

## 1. Setup

> ⚠️ Use **`npx expo install`** (not `npm install`) so SDK-compatible versions
> are selected. The versions in `package.json` are already pinned for SDK 51 —
> most importantly **NativeWind is pinned to `4.1.23`** (newer 4.2.x pulls
> `react-native-css-interop` that references Reanimated-4's
> `react-native-worklets/plugin`, which does not exist on SDK 51).

```bash
# 1) Install (respects the pinned versions in package.json)
npm install

# (Recommended on macOS to avoid Metro "EMFILE: too many open files")
brew install watchman

# 2) These features need a native dev build (not Expo Go):
#    expo-camera (barcode scanner) + expo-notifications scheduling.
npx expo prebuild --clean
npx expo run:ios       # or: npx expo run:android

# 3) Day-to-day, after the dev build is installed:
npx expo start --clear
```

> Local notifications, SQLite, file export and sharing also run in **Expo Go**,
> but the **camera barcode scanner** requires a development build.

---

## 2. Project structure

```
app/                         # Expo Router (file-based)
  _layout.tsx                # providers, DB+i18n bootstrap, onboarding gate
  onboarding.tsx             # first-run targets + medical disclaimer
  (tabs)/
    _layout.tsx              # 3 tabs: Dashboard · Food & Scan · Settings
    index.tsx                # Dashboard: fast loggers, CGM toggle, journal feed
    food.tsx                 # search, favorites, scan/add entry points
    settings.tsx             # profile, ratios, language, Pro, export, dev toggle
  scan.tsx                   # expo-camera barcode/QR scanner (offline lookup)
  calculator.tsx             # portion slider + estimated dose + meal logging
  add-food.tsx               # custom food form (+ barcode capture)
  paywall.tsx                # Zerospike Pro paywall (mock RevenueCat)

lib/
  db/                        # schema, FTS5, 173-item seed, typed queries
    index.ts  seed.ts  foods.ts  logs.ts  profiles.ts  favorites.ts
    journal.ts  types.ts
  i18n/                      # i18next setup + tr/en/de/es/fr locales
  services/                  # notifications · purchases(mock) · health(mock) · export(CSV)
  store/AppContext.tsx       # active profile, isPro, language, ready/onboarding
  glucose.ts  insulin.ts  guardrails.ts  format.ts  uuid.ts

components/                  # Button/Field/Segmented, JournalItem, FoodRow,
                             # ProfileSwitcher, GlucoseInputSheet, TimeField, Disclaimer
```

---

## 3. Key implementation notes

### Database & search
- On first launch, the DB is seeded **once** (guarded by `PRAGMA user_version`)
  with **173 foods** (Turkish staples + global) localized in 5 languages.
- A **FTS5** virtual table (`foods_fts`) indexes all 5 name columns + aliases +
  brand, kept in sync by triggers. Searching `rice`, `reis`, `arroz` or `pilav`
  all return the same record. LIKE fallback if FTS is unavailable.
- Tables: `user_profiles` (UUID, per-meal carb ratios + ISF), `foods`
  (aliases_json, barcode, portion, brand), `sugar_logs` (period_tag), `meal_logs`
  (photo + note), `favorites`. Foreign keys cascade per profile.

### Insulin estimation (time-based)
- Active carb ratio is chosen by the clock: **Breakfast 06–11 · Lunch 11–17 ·
  Dinner/Night 17–06** (overridable in the calculator).
- Dose = `carbs / activeRatio` + optional ISF correction. Always presented as an
  **"Estimated Dose Recommendation"** and fully editable — never prescriptive.

### Notifications (no server)
- Daily **night-insulin** reminder at the user's chosen time (rescheduled on
  change; never stacked).
- A **2-hour post-meal** reminder is scheduled whenever a fasting/pre-meal
  reading is logged. Permissions are requested gracefully (denial just disables
  reminders).

### Health / CGM
- `lib/services/health.ts` exposes the real permission-request surface (stubbed)
  and a mock CGM stream that writes `BloodGlucose` samples straight into SQLite,
  deduped by timestamp. The Dashboard toggle imports on enable.

### CSV export (real, offline)
- `lib/services/export.ts` builds a proper UTF-8 (BOM) CSV of the full journal
  (Date, Time, Type, Glucose, Carbs, Insulin, Food, Note) with `expo-file-system`
  and opens the native share sheet (`expo-sharing`) → WhatsApp / Email / etc.

### Free vs Pro (mock RevenueCat)
- Free tier: **3 custom foods** and **5 total logs** (glucose + meals combined).
  Hitting a limit opens the paywall with the relevant message.
- `lib/services/purchases.ts` mirrors a RevenueCat integration but is backed by
  AsyncStorage. **Settings → Developer → "Simulate Pro"** flips Pro on/off so you
  can test both states locally. To go live, swap the three function bodies for
  `react-native-purchases` calls — the rest of the app already consumes this API.

### Medical disclaimer
- Shown during onboarding **and** permanently in Settings:
  *"Zerospike bir tıbbi cihaz değildir, lütfen tedavi kararlarınız için
  doktorunuza danışınız."* (localized in all 5 languages).

---

## 4. Going to production (lessons baked in)

These are pre-applied from prior store-submission experience:

- NativeWind pinned to `4.1.23`; `tailwind.config.js` `content` covers
  `app/`, `components/`, **and** `lib/`.
- `app.json`: `usesNonExemptEncryption: false`; Android `targetSdkVersion 35`
  via `expo-build-properties`; camera/notification/health permission strings.
- Paywall includes **Privacy Policy + Terms** links (required for store review);
  update `PRIVACY_URL` / `TERMS_URL` in `app/paywall.tsx` and
  `app/(tabs)/settings.tsx`.
- If targeting API 35 you may hit the known Kotlin/Swift build errors
  (`react-native-screens` `removeLast()`, `expo-modules-core` nullable
  permissions, `expo-localization` exhaustive switch) — fix with `patch-package`
  (a `postinstall` hook is already wired in `package.json`).

> The `assets/*.png` are generated solid-color placeholders — replace with your
> real 1024×1024 icon / splash before shipping.
