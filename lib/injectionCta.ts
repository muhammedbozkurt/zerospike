/** What is still missing before the injection form can be saved, so the
 *  disabled button can say why instead of just dimming. */
export function ctaBlockers(opts: { hasSite: boolean; doseOk: boolean }): {
  site: boolean;
  dose: boolean;
} {
  return { site: !opts.hasSite, dose: !opts.doseOk };
}
