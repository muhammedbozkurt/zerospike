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
 * category (table in docs/food-sources.md). Preset portions come only from
 * USDA household measures; where the gram weight is not established there are
 * none. gi is 0: no established figure.
 */
export const SEED_CARB: SeedFood[] = [
  { cat: "sweets", tr: "Marie bisküvi", en: "Marie biscuit", de: "Marie-Keks", es: "Galletas María", fr: "Biscuit Marie", carb: 70.5, gi: 0, src: "usda", srcId: "171867" },
  { cat: "staples", tr: "Papadum", en: "Poppadom (papad)", de: "Papadam", es: "Papadum", fr: "Papadum", carb: 59.9, gi: 0, src: "usda", srcId: "168106" },
  { cat: "vegetables", tr: "Fırında kızarmış patates", en: "Roast potato", de: "Röstkartoffeln aus dem Ofen", es: "Patatas asadas al horno", fr: "Pommes de terre rôties", carb: 20.5, gi: 0, portion: 170, portions: [["medium", 170], ["cup", 160]], src: "usda", srcId: "2709402" },
  { cat: "vegetables", tr: "Tavada patates kızartması", en: "Pan-fried potatoes (home fries)", de: "Bratkartoffeln", es: "Patatas salteadas", fr: "Pommes de terre sautées", carb: 18.8, gi: 0, portion: 200, portions: [["cup", 200]], src: "usda", srcId: "2709474" },
  { cat: "sweets", tr: "Natillas (sütlü yumurta kreması)", en: "Natillas (custard)", de: "Natillas (Vanillecreme)", es: "Natillas", fr: "Natillas (crème à la vanille)", carb: 11, gi: 0, portion: 130, portions: [["cup", 260]], src: "usda", srcId: "2705682" },
  { cat: "sweets", tr: "Chouquette (sade)", en: "Chouquette (plain cream puff)", de: "Chouquette (ungefülltes Windbeutelchen)", es: "Chouquette", fr: "Chouquette", carb: 22.8, gi: 0, portion: 27, portions: [["piece", 27]], src: "usda", srcId: "2708033" },
  { cat: "sweets", tr: "Digestive bisküvi", en: "Digestive biscuit", de: "Digestive-Keks", es: "Galletas digestive", fr: "Biscuit digestive", carb: 63, gi: 0, src: "off", srcId: "5010251830160" },
  { cat: "bakery", tr: "Yorkshire pudingi", en: "Yorkshire pudding", de: "Yorkshire Pudding", es: "Yorkshire pudding", fr: "Yorkshire pudding", carb: 36, gi: 0, src: "off", srcId: "5052004690065" },
  { cat: "sweets", tr: "Flapjack (yulaflı bar)", en: "Flapjack", de: "Flapjack (Haferriegel)", es: "Flapjack (barrita de avena)", fr: "Flapjack (barre d'avoine)", carb: 58, gi: 0, src: "off", srcId: "00364317" },
  { cat: "bakery", tr: "Yulaf bisküvisi (oatcake)", en: "Oatcake", de: "Haferkeks (Oatcake)", es: "Galleta de avena (oatcake)", fr: "Galette d'avoine (oatcake)", carb: 62, gi: 0, src: "off", srcId: "5015168000019" },
];
