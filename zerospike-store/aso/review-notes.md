# App Review Notes - zerospike 1.5.0 (paste into App Store Connect > App Review Information > Notes)

WHAT THE APP IS
zerospike is a personal diabetes LOGBOOK. Users manually record their own blood glucose readings, meals (carbs) and the insulin doses they have already decided on with their care team. It is not a medical device, performs no diagnosis, generates no treatment advice, and sends no alarms. A full medical disclaimer must be accepted during onboarding and is repeated on every relevant screen (dose surfaces, reports, AI replies).

NO ACCOUNT / NO LOGIN
There is no account system and no demo credentials are needed. All health records are stored locally on the device (SQLite). Nothing is required to reach full functionality for review.

60-SECOND TEST PATH
1. Complete onboarding (any values; defaults are fine).
2. Dashboard: tap "+ Add record" and log a glucose reading; the colored ring reflects the user's own target range.
3. Tap "I started eating": a post-meal timer starts (also visible as a Live Activity / lock screen).
4. Food tab: search a food (500+ item local database) or scan a barcode, log a meal.
5. Injections tab: log an injection by picking a body-map site point; the map only VISUALIZES past usage (least-recently-used point). It never tells the user where to inject.
6. Insights: time in range, AGP profile, estimated A1C (GMI) computed from the user's own logged data, descriptive only.
7. Settings > Data: doctor-ready PDF export of the user's own log.

ABOUT THE DOSE FIELD (proactive note re: guideline 1.4)
The meal screen can show an EDITABLE dose estimate computed strictly from ratios the USER entered during onboarding (carb ratio / correction factor, as provided by their own clinician). It is labeled as an estimate, is fully editable before saving, warns on unusually high values, and is accompanied by a visible "not medical advice" notice. The app never prescribes, never auto-adjusts, and contains no proprietary dosing algorithm; it is arithmetic on the user's own numbers, recorded as part of their logbook.

SPIKE (IN-APP ASSISTANT)
An optional chat assistant limited to app help and general diabetes education. Hard server-side restrictions: it refuses dose numbers, diagnosis, medication changes and off-topic requests; every reply carries "does not give medical advice". It is gated behind an explicit consent screen, receives ONLY the text the user types (never health records), and has daily usage limits. Requests are processed by our own backend service.

HEALTH PERMISSIONS
- HealthKit read (optional, Pro): imports the user's own glucose samples into the journal.
- HealthKit write (optional, off by default, Settings > Data): writes readings the user logs back to Apple Health. Both have purpose strings; the app works fully without either.
- Notifications are local only and user-configurable (post-meal reminder, optional basal/measurement reminders). No critical alerts are used.

APPLE WATCH
A companion watch app mirrors the last logged reading and the running post-meal timer (with complications). Data arrives from the phone via WatchConnectivity; the watch adds no independent medical functionality.

IN-APP PURCHASES (Pro)
Subscriptions (monthly / yearly with 7-day trial) and a lifetime purchase unlock: Apple Health sync, 30/90-day and custom-range insights, meal-response history comparison, PDF/CSV export, rotation summary, multiple profiles. The free tier is fully functional for logging and can be reviewed without purchasing; sandbox purchases work normally.

SOURCES
The in-app Sources screen cites the clinical references used for educational content (ADA Standards of Care, FITTER injection-technique guidance). Educational text is descriptive only.
