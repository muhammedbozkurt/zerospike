/**
 * Share-sheet file name of the PDF report. expo-print writes a random UUID
 * name; that is what the recipient (a doctor's mail, a messenger) would see.
 *
 * Dependency-free so scripts/reportFileName.test.ts runs it under plain Node.
 * Only the report word is localized, in ASCII on purpose: a non-Latin or
 * RTL file name renders reordered in several share targets and is rejected by
 * some mail gateways. No profile name and no reading ever goes into the name.
 */
const REPORT_WORD: Record<string, string> = {
  en: "report",
  tr: "rapor",
  de: "bericht",
  fr: "rapport",
  es: "informe",
  it: "rapporto",
  pt: "relatorio",
  ar: "taqrir",
  ja: "repoto",
};

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function reportPdfFileName(lang: string, date: Date): string {
  const word = REPORT_WORD[lang] ?? REPORT_WORD.en;
  const ymd = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `zerospike-${word}-${ymd}.pdf`;
}
