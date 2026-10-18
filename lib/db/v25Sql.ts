/**
 * The schema v25 statement, dependency-free so the tests run the REAL SQL.
 *
 * v25 stops storing the localized default profile name as text: a profile with
 * no name of its own keeps name = '' and the UI resolves the label at display
 * time (lib/profileName.ts). Rows holding exactly one of the 9 locales'
 * defaultName values (unchanged since 2.0.0) are emptied; any other name is untouched. The match is exact
 * (no trim, case-sensitive), so a user who typed one of these strings verbatim
 * is indistinguishable from the old default and is emptied too.
 *
 * scripts/profileNameMigration.test.ts keeps this list in sync with the
 * `profiles.defaultName` value of every locale.
 */
export const V25_DEFAULT_PROFILE_NAMES: string[] = [
  "Kendi Profilim",
  "My Profile",
  "Mein Profil",
  "Mon profil",
  "Mi perfil",
  "Il mio profilo",
  "Meu perfil",
  "ملفي الشخصي",
  "マイプロフィール",
];

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export const V25_EMPTY_DEFAULT_NAMES = `
  UPDATE user_profiles SET name = ''
  WHERE name IN (${V25_DEFAULT_PROFILE_NAMES.map(sqlLiteral).join(", ")});`;
