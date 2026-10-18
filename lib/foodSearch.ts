import { foodName } from "./db/types";
import type { Food, Lang } from "./db/types";
import { isLocalStaple } from "./foodMeta";

/**
 * Pure ranking and matching for food search, kept apart from lib/db/foods.ts
 * (which needs expo-sqlite) so scripts/foodSearch.test.ts can run it in Node.
 */

/** Case, accent and spelling-variant folding shared by queries and names.
 *  Turkish dotted/dotless i all collapse to plain i (so "ISPANAK", "İskender"
 *  and "kasarli" match "ıspanak", "iskender" and "kaşarlı"), ß becomes ss and
 *  the remaining diacritics are stripped (ñ, ç, é, ä, ğ, ş...). */
export function fold(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The folded query plus, for German, its ae/oe/ue transliteration collapsed
 *  to a/o/u ("kaese" finds "Käse", which folds to "kase"). */
export function queryVariants(query: string, lang: Lang): string[] {
  const base = fold(query);
  if (!base) return [];
  const out = [base];
  if (lang === "de") {
    const collapsed = base.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
    if (collapsed !== base) out.push(collapsed);
  }
  return out;
}

/**
 * Common alternative names for one food, per language. Every group has been
 * checked against lib/db/seed.ts: each names at least one catalogue food, and
 * a term with no catalogue counterpart is not listed. Plain-accent pairs such
 * as yogurt/yoğurt are not here, fold() already makes them equal.
 */
export const SYNONYM_GROUPS: Partial<Record<Lang, readonly (readonly string[])[]>> = {
  tr: [
    ["makarna", "spagetti"],
    ["ekmek", "somun"],
    ["simit", "gevrek"],
    ["pilav", "pirinç pilavı"],
    ["çay", "siyah çay"],
    ["lahmacun", "Türk pizzası"],
  ],
  de: [
    ["Brötchen", "Semmel", "Schrippe"],
    ["Kartoffel", "Erdapfel"],
    ["Quark", "Topfen"],
    ["Nudeln", "Pasta"],
    ["Pommes", "Fritten"],
  ],
};

/** Terms (raw spelling) that mean the same as what was typed. The typed value
 *  must be at least 3 characters and a prefix of a group term, so "somu"
 *  reaches the "somun" group; the term(s) it already matches are not echoed. */
export function synonymAlternates(query: string, lang: Lang): string[] {
  const groups = SYNONYM_GROUPS[lang];
  const q = fold(query);
  if (!groups || q.length < 3) return [];
  const out: string[] = [];
  for (const group of groups) {
    if (!group.some((t) => fold(t).startsWith(q))) continue;
    for (const t of group) {
      if (!fold(t).startsWith(q) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** 0 exact, 1 name prefix, 2 word prefix, 3 contains, 4 no match. */
export type MatchTier = 0 | 1 | 2 | 3 | 4;

export function matchTier(foldedName: string, variants: readonly string[]): MatchTier {
  let best: MatchTier = 4;
  const bare = foldedName.replace(/\s*\(.*\)\s*$/, "");
  for (const v of variants) {
    if (!v) continue;
    let t: MatchTier = 4;
    if (foldedName === v || bare === v) t = 0;
    else if (foldedName.startsWith(v)) t = 1;
    else if (
      foldedName.split(/[\s()/,\-]+/).some((w) => w.startsWith(v)) ||
      foldedName.includes(` ${v}`)
    ) t = 2;
    else if (foldedName.includes(v) || v.split(" ").every((tok) => foldedName.includes(tok))) t = 3;
    if (t < best) best = t;
  }
  return best;
}

export interface FoodUsage {
  count: number;
  /** ISO timestamp of the latest meal log of this food. */
  last: string | null;
}

const DAY_MS = 86_400_000;

/** 0 for a never-logged food, otherwise how often (capped) plus a bonus for
 *  having been logged in the last 14 / 60 days. */
export function usageScore(u: FoodUsage | undefined, now: number): number {
  if (!u || u.count <= 0) return 0;
  let score = Math.min(u.count, 20);
  const t = u.last ? Date.parse(u.last) : NaN;
  if (Number.isFinite(t)) {
    const days = (now - t) / DAY_MS;
    if (days <= 14) score += 5;
    else if (days <= 60) score += 2;
  }
  return score;
}

type NameFields = Pick<
  Food,
  | "name_tr" | "name_en" | "name_de" | "name_es" | "name_fr"
  | "name_it" | "name_pt" | "name_ar" | "name_ja"
  | "aliases_json" | "brand_name"
>;

/** Whether any phrase (all of its words) occurs in any name, alias or brand. */
export function foodMatchesAny(food: NameFields, phrases: readonly string[]): boolean {
  const hay = fold(
    [
      food.name_tr, food.name_en, food.name_de, food.name_es, food.name_fr,
      food.name_it, food.name_pt, food.name_ar, food.name_ja,
      food.aliases_json, food.brand_name,
    ]
      .filter(Boolean)
      .join(" | ")
  );
  return phrases.some((p) => p && p.split(" ").every((tok) => hay.includes(tok)));
}

export interface RankContext {
  lang: Lang;
  variants: readonly string[];
  /** Folded synonym phrases for the query. */
  synonyms: readonly string[];
  usage: ReadonlyMap<string, FoodUsage>;
  now: number;
}

/**
 * Orders search candidates. Match groups come first: exact name, then
 * prefix / word-prefix, then contains, then everything else (matched through
 * another language). Inside a group, foods the user has logged come first
 * (more and more recent first), then the finer tier, direct matches before
 * synonym matches, the user's own foods, the market's staples, and finally the
 * active language's alphabetical order.
 */
export function rankFoods(rows: readonly Food[], ctx: RankContext): Food[] {
  const { lang, variants, synonyms, usage, now } = ctx;
  const info = new Map<string, { tier: number; syn: number; used: number }>();
  for (const f of rows) {
    const name = fold(foodName(f, lang));
    const direct = matchTier(name, variants);
    let tier: number = direct;
    let syn = 0;
    if (synonyms.length > 0) {
      const s = matchTier(name, synonyms);
      if (s < 4) {
        const st = Math.max(s, 1);
        if (st < direct) {
          tier = st;
          syn = 1;
        }
      }
    }
    info.set(f.id, { tier, syn, used: usageScore(usage.get(f.id), now) });
  }
  const group = (t: number) => (t === 0 ? 0 : t <= 2 ? 1 : t === 3 ? 2 : 3);
  return [...rows].sort((a, b) => {
    const ia = info.get(a.id)!;
    const ib = info.get(b.id)!;
    const ga = group(ia.tier);
    const gb = group(ib.tier);
    if (ga !== gb) return ga - gb;
    if (ia.used !== ib.used) return ib.used - ia.used;
    if (ia.tier !== ib.tier) return ia.tier - ib.tier;
    if (ia.syn !== ib.syn) return ia.syn - ib.syn;
    if (a.is_custom !== b.is_custom) return b.is_custom - a.is_custom;
    const sa = isLocalStaple(a, lang) ? 0 : 1;
    const sb = isLocalStaple(b, lang) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return foodName(a, lang).localeCompare(foodName(b, lang), lang);
  });
}
