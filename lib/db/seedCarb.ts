import type { SeedFood } from "./seed";

/**
 * Foods added from a documented source. Every row here must carry `src` and
 * `srcId`; scripts/seed.test.ts enforces it. Sources, licences and the
 * per-row table live in docs/food-sources.md. Type-only import of ./seed: no
 * cycle at runtime.
 *
 * usda: srcId is the FoodData Central fdcId, carb is "Carbohydrate, by
 * difference" per 100 g. off: srcId is the barcode of one reference product,
 * carb is the rounded median of carbohydrates_100g over that Open Food Facts
 * category (table in docs/food-sources.md). std: a manufacturer data sheet,
 * srcId is its document number. Preset portions come from USDA household
 * measures or, for std/off rows, a product label (docs/food-sources.md); where
 * the gram weight is not established there are none. gi is 0: no established
 * figure.
 */
export const SEED_CARB: SeedFood[] = [
  { cat: "sweets", tr: "Marie bisküvi", en: "Marie biscuit", de: "Marie-Keks", es: "Galletas María", fr: "Biscuit Marie", it: "Biscotto Marie", pt: "Biscoito Maria", ar: "بسكويت ماري", ja: "マリービスケット", carb: 70.5, gi: 0, portion: 28, portions: [["piece", 6]], src: "usda", srcId: "171867" },
  { cat: "staples", tr: "Papadum", en: "Poppadom (papad)", de: "Papadam", es: "Papadum", fr: "Papadum", it: "Papadum", pt: "Papadum", ar: "بابادوم", ja: "パパダム", carb: 59.9, gi: 0, portion: 18, portions: [["piece", 9]], src: "usda", srcId: "168106" },
  { cat: "vegetables", tr: "Fırında kızarmış patates", en: "Roast potato", de: "Röstkartoffeln aus dem Ofen", es: "Patatas asadas al horno", fr: "Pommes de terre rôties", it: "Patate arrosto al forno", pt: "Batatas assadas no forno", ar: "بطاطا مشوية في الفرن", ja: "ローストポテト", carb: 20.5, gi: 0, portion: 170, portions: [["medium", 170], ["cup", 160]], src: "usda", srcId: "2709402" },
  { cat: "vegetables", tr: "Tavada sote patates", en: "Pan-fried potatoes (home fries)", de: "Bratkartoffeln", es: "Patatas salteadas", fr: "Pommes de terre sautées", it: "Patate saltate in padella", pt: "Batatas salteadas", ar: "بطاطا مقلية بالمقلاة", ja: "ポテトソテー", carb: 18.8, gi: 0, portion: 200, portions: [["cup", 200]], src: "usda", srcId: "2709474" },
  { cat: "sweets", tr: "Natillas (sütlü yumurta kreması)", en: "Natillas (custard)", de: "Natillas (Vanillecreme)", es: "Natillas", fr: "Natillas (crème à la vanille)", it: "Natillas (crema alla vaniglia)", pt: "Natillas (creme de baunilha)", ar: "ناتيّاس (كاسترد الفانيليا الإسباني)", ja: "ナティージャス(スペインのカスタード)", carb: 18, gi: 0, portion: 130, portions: [["cup", 260]], src: "off", srcId: "8411400000972" },
  { cat: "sweets", tr: "Chouquette (küçük şu hamuru topu)", en: "Chouquette (cream puff)", de: "Chouquette (Windbeutelchen)", es: "Chouquette", fr: "Chouquette", it: "Chouquette (bignè)", pt: "Chouquette (carolina)", ar: "شوكيت (معجنات الشو)", ja: "シュケット", carb: 45, gi: 0, portion: 10, portions: [["piece", 10]], src: "std", srcId: "18404" },
  { cat: "sweets", tr: "Digestive bisküvi", en: "Digestive biscuit", de: "Digestive-Keks", es: "Galletas digestive", fr: "Biscuit digestive", it: "Biscotto Digestive", pt: "Biscoito Digestive", ar: "بسكويت الديجستيف", ja: "ダイジェスティブビスケット", carb: 63, gi: 0, portion: 14, portions: [["piece", 14]], src: "off", srcId: "5010251830160" },
  { cat: "bakery", tr: "Yorkshire pudingi", en: "Yorkshire pudding", de: "Yorkshire Pudding", es: "Yorkshire pudding", fr: "Yorkshire pudding", it: "Yorkshire pudding", pt: "Yorkshire pudding", ar: "يوركشاير بودينغ", ja: "ヨークシャープディング", carb: 37, gi: 0, portion: 33, portions: [["piece", 33]], src: "off", srcId: "5052004690065" },
  { cat: "sweets", tr: "Flapjack (yulaflı bar)", en: "Flapjack (oat bar)", de: "Flapjack (Haferriegel)", es: "Flapjack (barrita de avena)", fr: "Flapjack (barre d'avoine)", it: "Flapjack (barretta di avena)", pt: "Flapjack (barra de aveia)", ar: "فلاب جاك (لوح الشوفان)", ja: "フラップジャック(オーツバー)", carb: 54, gi: 0, src: "off", srcId: "5017174096086" },
  { cat: "bakery", tr: "Yulaf bisküvisi (oatcake)", en: "Oatcake", de: "Haferkeks (Oatcake)", es: "Galleta de avena (oatcake)", fr: "Galette d'avoine (oatcake)", it: "Oatcake (galletta d'avena)", pt: "Oatcake (bolacha de aveia)", ar: "أوتكيك (قرص الشوفان)", ja: "オートケーキ(オーツ麦ビスケット)", carb: 56, gi: 0, src: "off", srcId: "0612322030278" },
];
