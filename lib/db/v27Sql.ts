/**
 * The schema v27 statement, dependency-free so the migration test runs the
 * REAL SQL.
 *
 * Until 2.4.0 ratios_confirmed meant different things over time: 1 for every
 * install that predates v8, 1 after any stepper change in Settings, 1 after the
 * old sheet's Save. None of that says the user checked the numbers with their
 * diabetes team, so the flag is unreliable for everyone. v27 clears it once;
 * from here it means one thing (see lib/calcSetup.ts): the user entered their
 * own ratios and ticked the confirmation box.
 *
 * Only the flag moves. The ratio columns, injection_logs and every saved dose
 * are not touched, so the sheet that follows opens with the stored values filled
 * in and only the box left to tick.
 */
export const V27_RESET_RATIO_CONFIRMATION = "UPDATE user_profiles SET ratios_confirmed = 0;";
