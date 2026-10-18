/**
 * A profile without a name of its own stores name = '' and shows the localized
 * default at display time, so the label follows the active language.
 */
export function displayProfileName(
  profile: string | { name: string } | null | undefined,
  t: (key: string) => string
): string {
  const name = typeof profile === "string" ? profile : profile?.name;
  return name && name.trim() ? name : t("profiles.defaultName");
}
