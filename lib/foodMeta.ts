import { categoryEmoji } from "./db/categories";
import type { Lang } from "./db/types";

/**
 * Food-level metadata layered on TOP of the catalogue: a specific icon per dish
 * instead of one icon per shelf, a small ranking nudge toward the foods a given
 * locale actually eats day to day, and a query bridge for the two UI languages
 * whose users type in words the catalogue's five name columns don't carry.
 *
 * Everything here is derived at read time from `name_en` (the one column every
 * row has, seeded or scanned) - no migration, no new column. A custom or
 * barcode-cached food gets the same treatment as a seeded one for free.
 */

type EmojiRule = readonly [string, string];

/**
 * Keyword -> emoji, checked TOP TO BOTTOM, first match wins. Order is not
 * cosmetic: a compound ("cheesecake", "eggplant", "hot dog bun") has to sit
 * above the single word it would otherwise be caught by ("cheese", "egg",
 * "bread"), and a short, collision-prone word ("pea", "corn") has to sit below
 * every longer word that contains it ("peanut", "pear", "popcorn").
 */
export const EMOJI_RULES: readonly EmojiRule[] = [
  // ── collision guards - specific compounds ahead of the generic word they
  //    would otherwise be swallowed by, AND ahead of any rule that targets the
  //    same emoji as the food's own category default (a match that lands on
  //    the shelf's own icon is not a differentiated icon) ────────────────────
  ["eggplant", "🍆"],
  ["pineapple", "🍍"], // ahead of "apple"
  ["peanut flour", "🌾"], // ahead of "peanut"
  ["peanut butter", "🫙"],
  ["almond butter", "🫙"],
  ["sugar-coated peanuts", "🍬"],
  ["salted peanuts", "🧂"],
  ["peanut", "🥜"],
  ["pear", "🍐"], // ahead of "pea"
  ["peach", "🍑"], // ahead of "pea"
  ["popcorn", "🍿"], // ahead of "corn"
  ["coconut", "🥥"], // ahead of "milk" / "rice" / "water"
  ["milkshake", "🍨"],
  ["milk chocolate", "🍫"],
  ["hot chocolate", "☕"],
  ["chocolate cake", "🍫"],
  ["chocolate mousse", "🍮"],
  ["sticky chocolate cake", "🍫"],
  ["cheesecake", "🧀"],
  ["cheeseburger", "🍔"],
  ["chicken burger", "🍗"],
  ["fish burger", "🐟"],
  ["wet burger", "🍅"],
  ["cream cheese", "🧀"],
  ["ice cream", "🍨"],
  ["rice pudding", "🍮"],
  ["rice porridge", "🍮"],
  ["rice cake", "🍘"],
  ["rice flour", "🌾"], // ahead of "rice"
  ["rice noodles", "🍜"],
  ["fish and chips", "🐟"],
  ["gingerbread", "🍪"],
  ["shortbread", "🍪"],
  ["flatbread", "🫓"],
  ["breadfruit", "🍞"],
  ["sausage roll", "🌭"],
  ["french toast", "🥞"],
  ["tartiflette", "🥔"],
  ["frozen mixed vegetables", "🧊"],
  ["mixed green salad", "🥬"],
  ["ayran", "🥤"], // ahead of "milk"/dairy default
  // raw poultry CUTS ahead of "wing"/"nugget" (fastfood tier) and the plain
  // "chicken"/"turkey" match (both = the protein shelf's own default 🍗)
  ["chicken breast", "🥩"],
  ["chicken thigh", "🥩"],
  ["chicken wings", "🥩"],
  ["chicken drumstick", "🥩"],
  ["ground chicken", "🥩"],
  ["turkey breast", "🥩"],
  ["turkey leg", "🥩"],

  // ── dumplings & stuffed pastries (global) ───────────────────────────────
  ["manti", "🥟"],
  ["gyoza", "🥟"],
  ["wonton", "🥟"],
  ["pierogi", "🥟"],
  ["pelmeni", "🥟"],
  ["maultaschen", "🥟"],
  ["samosa", "🥟"],
  ["empanada", "🥟"],
  ["pupusa", "🥟"],
  ["kibbeh", "🥟"],
  ["dumpling", "🥟"],
  ["borek", "🥟"],
  ["börek", "🥟"],
  ["gozleme", "🥟"],
  ["su börek", "🥟"],
  ["dim sum", "🥟"],

  // ── Turkish & Middle Eastern proper-noun dishes ─────────────────────────
  ["kebab", "🍢"],
  ["kebap", "🍢"],
  ["cevapi", "🍢"],
  ["kofte", "🍖"],
  ["köfte", "🍖"],
  ["meatball", "🍖"],
  ["königsberger klopse", "🍖"],
  ["lahmacun", "🍕"],
  ["flammkuchen", "🍕"],
  ["pide", "🍕"],
  ["manakish", "🍕"],
  ["dolma", "🍇"],
  ["stuffed vine leaves", "🍇"],
  ["vine leaf", "🍇"],
  ["sarma", "🥬"],
  ["cabbage roll", "🥬"],
  ["stuffed pepper", "🫑"],
  ["stuffed eggplant", "🍆"],
  ["imam bayildi", "🍆"],
  ["hunkar begendi", "🍆"],
  ["ali nazik", "🍆"],
  ["palak paneer", "🥬"],
  ["baklava", "🍯"],
  ["kunefe", "🍯"],
  ["turkish delight", "🍬"],
  ["halva", "🍯"],
  ["revani", "🍯"],
  ["kadayif", "🍯"],
  ["sekerpare", "🍯"],
  ["tulumba", "🍯"],
  ["lokma", "🍯"],
  ["basbousa", "🍯"],
  ["kalburabasti", "🍯"],
  ["hanim gobegi", "🍯"],
  ["maamoul", "🍪"],
  ["gullac", "🍮"],
  ["pismaniye", "🍬"],
  ["cezerye", "🍬"],
  ["zerde", "🍮"],
  ["muhallebi", "🍮"],
  ["keskul", "🍮"],
  ["supangle", "🍮"],
  ["trilece", "🍮"],
  ["kazandibi", "🍮"],
  ["ashure", "🍮"],
  ["qatayef", "🍯"],
  ["umm ali", "🍮"],
  ["boza", "🌾"],
  ["salep", "🍮"],
  ["simit", "🥯"],
  ["falafel", "🧆"],
  ["hummus", "🧆"],
  ["shawarma", "🌯"],
  ["doner", "🌯"],
  ["döner", "🌯"],
  ["gyros", "🌯"],
  ["tantuni", "🌯"],
  ["souvlaki", "🍢"],
  ["tabbouleh", "🥗"],
  ["fattoush", "🥗"],
  ["kisir", "🥗"],
  ["piyaz", "🥗"],
  ["som tam", "🥗"],
  ["larb", "🥗"],
  ["baba ganoush", "🍆"],
  ["cacik", "🥒"],
  ["haydari", "🥣"],
  ["tahini", "🫙"],
  ["kavurma", "🍖"],
  ["kokorec", "🍖"],
  ["cilbir", "🍳"],
  ["keskek", "🍖"],
  ["harira", "🥣"],
  ["mujadara", "🍚"],
  ["maqluba", "🍚"],
  ["bastilla", "🥧"],
  ["ful medames", "🫘"],

  // ── flatbreads / wraps / tacos ───────────────────────────────────────────
  ["pita", "🫓"],
  ["naan", "🫓"],
  ["lavash", "🫓"],
  ["tortilla", "🫓"],
  ["roti", "🫓"],
  ["chapati", "🫓"],
  ["paratha", "🫓"],
  ["injera", "🫓"],
  ["yufka", "🫓"],
  ["bazlama", "🫓"],
  ["arepa", "🫓"],
  ["piadina", "🫓"],
  ["dosa", "🫓"],
  ["ayvalik toast", "🥪"],
  ["wrap", "🌯"],
  ["burrito", "🌯"],
  ["vada pav", "🥔"],
  ["taco", "🌮"],
  ["quesadilla", "🌮"],
  ["nachos", "🌮"],
  ["enchilada", "🌮"],
  ["fajita", "🌮"],
  ["chilaquiles", "🌮"],
  ["pozole", "🥘"],
  ["mole poblano", "🌶️"],

  // ── East Asian rice / noodle / curry dishes ─────────────────────────────
  ["sushi", "🍣"],
  ["sashimi", "🍣"],
  ["onigiri", "🍙"],
  ["arancini", "🍙"],
  ["kimbap", "🍙"],
  ["nasi goreng", "🍚"],
  ["fried rice", "🍚"],
  ["bibimbap", "🍚"],
  ["congee", "🍚"],
  ["biryani", "🍚"],
  ["paella", "🍚"],
  ["jollof", "🍚"],
  ["pabellón criollo", "🍚"],
  ["mie goreng", "🍜"],
  ["ramen", "🍜"],
  ["udon", "🍜"],
  ["soba", "🍜"],
  ["pho", "🍜"],
  ["laksa", "🍜"],
  ["pad thai", "🍜"],
  ["chow mein", "🍜"],
  ["japchae", "🍜"],
  ["fideuà", "🍜"],
  ["noodle", "🍜"],
  ["vermicelli", "🍜"],
  ["tempura", "🍤"],
  ["teriyaki", "🍗"],
  ["yakitori", "🍗"],
  ["katsu", "🍖"],
  ["tonkatsu", "🍖"],
  ["okonomiyaki", "🥞"],
  ["jianbing", "🥞"],
  ["takoyaki", "🐙"],
  ["miso", "🥣"],
  ["kimchi", "🥬"],
  ["bulgogi", "🍖"],
  ["tteokbokki", "🍢"],
  ["satay", "🍢"],
  ["tang yuan", "🍡"],
  ["dorayaki", "🥞"],
  ["taiyaki", "🥞"],
  ["curry", "🍛"],
  ["masala", "🍛"],
  ["tikka", "🍛"],
  ["pilaf", "🍚"],

  // ── Italian pizza / pasta ────────────────────────────────────────────────
  ["pizza", "🍕"],
  ["calzone", "🍕"],
  ["focaccia", "🍕"],
  ["älplermagronen", "🍝"],
  ["pastitsio", "🍝"],
  ["spaghetti", "🍝"],
  ["carbonara", "🍝"],
  ["lasagna", "🍝"],
  ["gnocchi", "🍝"],
  ["risotto", "🍚"],
  ["penne", "🍝"],
  ["fusilli", "🍝"],
  ["farfalle", "🍝"],
  ["rigatoni", "🍝"],
  ["tagliatelle", "🍝"],
  ["fettuccine", "🍝"],
  ["linguine", "🍝"],
  ["macaroni", "🍝"],
  ["mac and cheese", "🍝"],
  ["orzo", "🍝"],
  ["pasta", "🍝"],
  ["spätzle", "🍝"], // German egg noodle, same spelling in de/fr/es
  ["minestrone", "🥣"],
  ["tiramisu", "🍮"],
  ["pavlova", "🍮"], // meringue + cream + fruit dessert
  ["panna cotta", "🍮"],
  ["gelato", "🍨"],
  ["kulfi", "🍨"],

  // ── burgers / sandwiches / fried fast food ──────────────────────────────
  ["hamburger", "🍔"],
  ["burger", "🍔"],
  ["hot dog", "🌭"],
  ["banh mi", "🥪"],
  ["croque", "🥪"],
  ["sandwich", "🥪"],
  ["panini", "🥪"],
  ["mozzarella sticks", "🧀"],
  ["hash brown", "🥔"],
  ["french fries", "🍟"],
  ["fries", "🍟"],
  ["chips", "🍟"],
  ["nugget", "🍗"],
  ["wing", "🍗"],
  ["poutine", "🍟"],
  ["kumpir", "🥔"],

  // ── eggs ─────────────────────────────────────────────────────────────────
  ["omelette", "🍳"],
  ["omelet", "🍳"],
  ["shakshuka", "🍳"],
  ["menemen", "🍳"],
  ["quiche", "🍳"],
  ["scrambled egg", "🍳"],
  ["egg tart", "🍳"],
  ["egg", "🥚"],

  // ── soups / stews / salads ───────────────────────────────────────────────
  ["gazpacho", "🥣"],
  ["salmorejo", "🥣"],
  ["soup", "🥣"],
  ["chowder", "🥣"],
  ["borscht", "🥣"],
  ["bouillabaisse", "🥣"],
  ["callos a la madrileña", "🥘"],
  ["cocido madrileño", "🥘"],
  ["sancocho", "🥘"],
  ["bigos", "🥘"],
  ["cassoulet", "🫘"],
  ["fabada asturiana", "🫘"],
  ["feijoada", "🫘"],
  ["moussaka", "🍆"],
  ["ratatouille", "🍅"],
  ["pisto", "🍅"],
  ["piperade", "🫑"],
  ["moqueca", "🐟"],
  ["ceviche", "🐟"],
  ["osso buco", "🥩"],
  ["sauerbraten", "🥩"],
  ["zwiebelrostbraten", "🥩"],
  ["tafelspitz", "🥩"],
  ["zürcher geschnetzeltes", "🥩"],
  ["bœuf bourguignon", "🥩"],
  ["bourguignon", "🥩"],
  ["blanquette de veau", "🥩"],
  ["pot-au-feu", "🥩"],
  ["navarin d'agneau", "🥩"],
  ["ropa vieja", "🥩"],
  ["lomo saltado", "🥩"],
  ["churrasco", "🥩"],
  ["milanesa a la napolitana", "🍖"],
  ["ají de gallina", "🍗"],
  ["poulet basquaise", "🍗"],
  ["coq au vin", "🍗"],
  ["bobotie", "🍖"],
  ["rendang", "🥩"],
  ["schnitzel", "🍖"],
  ["cordon bleu", "🍖"],
  ["leberkäse", "🍖"],
  ["gulaş", "🍖"],
  ["goulash", "🥘"],
  ["gumbo", "🍤"],
  ["gambas al ajillo", "🍤"],
  ["pulpo a la gallega", "🐙"],
  ["bacalao", "🐟"],
  ["brandade de morue", "🐟"],
  ["escargot", "🐌"],
  ["moules marinières", "🦪"],
  ["choucroute", "🥬"],
  ["sauerkraut", "🥬"],
  ["rösti", "🥔"],
  ["patatas bravas", "🥔"],
  ["gratin dauphinois", "🥔"],
  ["aligot", "🥔"],
  ["fondue", "🧀"],
  ["tamale", "🫔"],
  ["english breakfast", "🍳"],
  ["stew", "🥘"],
  ["casserole", "🥘"],
  ["salad", "🥗"],
  ["coleslaw", "🥬"],
  ["guacamole", "🥑"],

  // ── bread & bakery ───────────────────────────────────────────────────────
  ["baguette", "🥖"],
  ["ciabatta", "🥖"],
  ["brioche", "🥐"],
  ["pogaca", "🥖"],
  ["scone", "🧁"],
  ["madeleine", "🧁"],
  ["canelé", "🧁"],
  ["stollen", "🥐"],
  ["panettone", "🥐"],
  ["babka", "🥐"],
  ["mille-feuille", "🥐"],
  ["cannoli", "🥐"],
  ["eclair", "🥐"],
  ["profiterole", "🥐"],
  ["puff pastry", "🥐"],
  ["challah", "🥖"],
  ["pumpernickel", "🥖"],
  ["fougasse", "🥖"],
  ["taralli", "🍘"],
  ["breadstick", "🥨"],
  ["grissini", "🥨"],
  ["cracker", "🍘"],
  ["rusk", "🍘"],
  ["melba toast", "🍘"],
  ["matzo", "🫓"],
  ["crouton", "🥖"],
  ["croissant", "🥐"],
  ["pretzel", "🥨"],
  ["bagel", "🥯"],
  ["muffin", "🧁"],
  ["cupcake", "🧁"],
  ["loaf", "🥖"],
  ["bun", "🥖"],
  ["roll", "🥖"],
  ["crumpet", "🥞"],
  ["pancake", "🥞"],
  ["kaiserschmarrn", "🥞"],
  ["waffle", "🧇"],
  ["crepe", "🥞"],
  ["crêpe", "🥞"],
  ["bread", "🥖"],

  // ── rice / grains / cereal staples ──────────────────────────────────────
  ["flour", "🌾"],
  ["starch", "🌾"],
  ["polenta", "🌽"],
  ["rice", "🍚"],
  ["oat", "🥣"],
  ["porridge", "🥣"],
  ["granola", "🥣"],
  ["muesli", "🥣"],
  ["cornflake", "🥣"],
  ["cereal", "🥣"],
  ["tarhana", "🥣"],
  ["quinoa", "🌾"],
  ["couscous", "🌾"],
  ["bulgur", "🌾"],
  ["barley", "🌾"],
  ["millet", "🌾"],
  ["buckwheat", "🌾"],
  ["farro", "🌾"],
  ["spelt", "🌾"],
  ["wheat berries", "🌾"],
  ["sorghum", "🌾"],
  ["teff", "🌾"],
  ["amaranth", "🌾"],
  ["rye", "🌾"],
  ["freekeh", "🌾"],
  ["semolina", "🌾"],
  ["cassava", "🥔"],
  ["taro", "🥔"],
  ["yam", "🥔"],

  // ── legumes ──────────────────────────────────────────────────────────────
  ["chickpea", "🫘"],
  ["bean", "🫘"],
  ["lentil", "🫘"],
  ["tempeh", "🫘"],
  ["edamame", "🫛"],
  ["pea", "🫛"],

  // ── vegetables ───────────────────────────────────────────────────────────
  ["tomato", "🍅"],
  ["zucchini", "🥒"],
  ["cucumber", "🥒"],
  ["pickle", "🥒"],
  ["shallot", "🧅"],
  ["carrot", "🥕"],
  ["celeriac", "🥕"],
  ["parsnip", "🥕"],
  ["salsify", "🥕"],
  ["beetroot", "🥕"],
  ["radish", "🌱"],
  ["turnip", "🥕"],
  ["potato", "🥔"],
  ["pumpkin", "🎃"],
  ["squash", "🎃"],
  ["popcorn", "🍿"],
  ["corn", "🌽"],
  ["broccoli", "🥦"],
  ["cauliflower", "🥦"],
  ["brussels sprout", "🥬"],
  ["sprout", "🌱"],
  ["pepper", "🫑"],
  ["chili", "🌶️"],
  ["onion", "🧅"],
  ["garlic", "🧄"],
  ["oyster mushroom", "🍄"],
  ["mushroom", "🍄"],
  ["avocado", "🥑"],
  ["olive", "🫒"],
  ["caper", "🫒"],
  ["endive", "🥬"],
  ["radicchio", "🥬"],
  ["lettuce", "🥬"],
  ["spinach", "🥬"],
  ["kale", "🥬"],
  ["cabbage", "🥬"],
  ["chard", "🥬"],
  ["leek", "🥬"],
  ["seaweed", "🌿"],
  ["kelp", "🌿"],
  ["nori", "🌿"],
  ["wakame", "🌿"],
  ["kombu", "🌿"],
  ["samphire", "🌿"],
  ["asparagus", "🌱"],
  ["celery", "🌿"],
  ["okra", "🌿"],
  ["artichoke", "🌿"],
  ["fennel", "🌿"],
  ["arugula", "🥬"],
  ["parsley", "🌿"],
  ["dill", "🌿"],
  ["basil", "🌿"],
  ["mint", "🌿"],
  ["coriander", "🌿"],
  ["cress", "🌿"],
  ["chives", "🌿"],
  ["purslane", "🌿"],
  ["sorrel", "🌿"],
  ["bok choy", "🥬"],
  ["kohlrabi", "🥬"],

  // ── fruits ───────────────────────────────────────────────────────────────
  ["plantain", "🍌"],
  ["banana", "🍌"],
  ["apple", "🍏"],
  ["orange", "🍊"],
  ["tangerine", "🍊"],
  ["mandarin", "🍊"],
  ["clementine", "🍊"],
  ["grapefruit", "🍊"],
  ["kumquat", "🍊"],
  ["raisin", "🍇"],
  ["grape", "🍇"],
  ["plum", "🍇"],
  ["pomegranate", "🍇"],
  ["fig", "🍇"],
  ["prune", "🍇"],
  ["currant", "🫐"],
  ["watermelon", "🍉"],
  ["melon", "🍈"],
  ["strawberr", "🍓"],
  ["raspberr", "🍓"],
  ["blackberr", "🫐"],
  ["cranberr", "🫐"],
  ["mulberr", "🫐"],
  ["gooseberr", "🫐"],
  ["elderberr", "🫐"],
  ["chokeberry", "🫐"],
  ["greengage", "🍇"], // a plum variety
  ["nectarine", "🍑"],
  ["apricot", "🍑"],
  ["cherr", "🍒"],
  ["kiwi", "🥝"],
  ["mango", "🥭"],
  ["blueberr", "🫐"],
  ["lemon", "🍋"],
  ["lime", "🍋"],
  ["date", "🌴"],
  ["quince", "🍐"],
  ["papaya", "🥭"],
  ["lychee", "🥭"],
  ["rambutan", "🥭"],
  ["longan", "🥭"],
  ["mangosteen", "🥭"],
  ["durian", "🥭"],
  ["jackfruit", "🥭"],
  ["cherimoya", "🥭"],
  ["soursop", "🥭"],
  ["feijoa", "🥭"],
  ["guava", "🥭"],
  ["dragon fruit", "🥭"],
  ["persimmon", "🥭"],
  ["passion fruit", "🥭"],
  ["starfruit", "🥭"],
  ["loquat", "🥭"],
  ["rosehip", "🍇"],
  ["tamarind", "🍇"],
  ["goji", "🫐"],

  // ── protein / meat / fish ────────────────────────────────────────────────
  // (raw poultry cuts are guarded at the top of the table, ahead of "wing")
  ["liver", "🍖"],
  ["foie gras", "🦆"],
  ["chicken", "🍗"],
  ["turkey", "🍗"],
  ["duck", "🦆"],
  ["goose", "🦢"],
  ["pheasant", "🐦"],
  ["rabbit", "🐇"],
  ["venison", "🦌"],
  ["salmon", "🐟"],
  ["tuna", "🐟"],
  ["cod", "🐟"],
  ["trout", "🐟"],
  ["sea bass", "🐟"],
  ["sea bream", "🐟"],
  ["mackerel", "🐟"],
  ["sardine", "🐟"],
  ["anchovy", "🐟"],
  ["bonito", "🐟"],
  ["mullet", "🐟"],
  ["whiting", "🐟"],
  ["hake", "🐟"],
  ["sole", "🐟"],
  ["turbot", "🐟"],
  ["herring", "🐟"],
  ["carp", "🐟"],
  ["tilapia", "🐟"],
  ["fish", "🐟"],
  ["shrimp", "🍤"],
  ["prawn", "🍤"],
  ["crab", "🦀"],
  ["lobster", "🦞"],
  ["squid", "🦑"],
  ["calamari", "🦑"],
  ["octopus", "🐙"],
  ["mussel", "🦪"],
  ["oyster", "🦪"],
  ["scallop", "🦪"],
  ["clam", "🦪"],
  ["snail", "🐌"],
  ["caviar", "🐟"],
  ["bacon", "🥓"],
  ["prosciutto", "🍖"],
  ["mortadella", "🍖"],
  ["bresaola", "🍖"],
  ["tripe", "🍖"],
  ["ham", "🍖"],
  ["pastrami", "🍖"],
  ["chorizo", "🌭"],
  ["bratwurst", "🌭"],
  ["sausage", "🌭"],
  ["salami", "🍖"],
  ["steak", "🥩"],
  ["beef", "🥩"],
  ["veal", "🥩"],
  ["lamb", "🥩"],
  ["pork", "🥓"],
  ["tofu", "🧊"],
  ["seitan", "🌱"],
  ["textured soy protein", "🌱"],

  // ── dairy ────────────────────────────────────────────────────────────────
  ["gouda", "🧀"],
  ["parmesan", "🧀"],
  ["brie", "🧀"],
  ["camembert", "🧀"],
  ["ricotta", "🧀"],
  ["halloumi", "🧀"],
  ["mozzarella", "🧀"],
  ["emmental", "🧀"],
  ["tilsiter", "🧀"],
  ["edam", "🧀"],
  ["gruyère", "🧀"],
  ["roquefort", "🧀"],
  ["comté", "🧀"],
  ["fromage", "🧀"],
  ["manchego", "🧀"],
  ["pecorino", "🧀"],
  ["gorgonzola", "🧀"],
  ["mascarpone", "🧀"],
  ["burrata", "🧀"],
  ["graviera", "🧀"],
  ["raclette", "🧀"],
  ["cheese", "🧀"],
  ["skyr", "🥣"],
  ["lassi", "🥣"],
  ["yogurt", "🥣"],
  ["yoghurt", "🥣"],
  ["kefir", "🥣"],
  ["labneh", "🥣"],
  ["butter", "🧈"],
  ["ghee", "🧈"],
  ["quark", "🥣"], // German curd cheese, same spelling in fr/es
  ["crème fraîche", "🥣"],
  ["cream", "🥣"],
  ["milk", "🍼"],

  // ── sweets / desserts ────────────────────────────────────────────────────
  ["mooncake", "🥮"],
  ["mochi", "🍡"],
  ["dulce de leche", "🍯"],
  ["jalebi", "🍯"],
  ["maple syrup", "🍯"],
  ["fruit leather", "🍇"],
  ["kheer", "🍮"],
  ["crème brûlée", "🍮"],
  ["creme brulee", "🍮"],
  ["soufflé", "🍮"],
  ["souffle", "🍮"],
  ["tres leches", "🍮"],
  ["custard", "🍮"],
  ["flan", "🍮"],
  ["jelly", "🍮"],
  ["pudding", "🍮"],
  ["mousse", "🍮"],
  ["strudel", "🥧"],
  ["sachertorte", "🍫"],
  ["brigadeiro", "🍫"],
  ["brownie", "🍫"],
  ["chocolate", "🍫"],
  ["macaron", "🍬"],
  ["ladoo", "🍬"],
  ["candy", "🍬"],
  ["caramel", "🍬"],
  ["fudge", "🍬"],
  ["marshmallow", "🍬"],
  ["nougat", "🍬"],
  ["marzipan", "🍬"],
  ["lollipop", "🍭"],
  ["gummy", "🍬"],
  ["churros", "🍩"],
  ["donut", "🍩"],
  ["dónut", "🍩"],
  ["lebkuchen", "🍪"],
  ["biscotti", "🍪"],
  ["polvorón", "🍪"],
  ["alfajor", "🍪"],
  ["wafer", "🍪"],
  ["cookie", "🍪"],
  ["biscuit", "🍪"],
  ["pie", "🥧"],
  ["tart", "🥧"],
  ["sorbet", "🍧"],
  ["halo-halo", "🍧"],
  ["honey", "🍯"],
  ["jam", "🍯"],
  ["acai bowl", "🥣"],
  ["overnight oats", "🥣"],
  ["chia pudding", "🍮"],
  ["protein bar", "🍫"],
  ["granola bar", "🍫"],
  ["trail mix", "🥜"],
  ["cake", "🧁"],

  // ── nuts / seeds ─────────────────────────────────────────────────────────
  ["chestnut", "🌰"],
  ["tiger nut", "🌰"],
  ["walnut", "🌰"],
  ["almond", "🌰"],
  ["hazelnut", "🌰"],
  ["pistachio", "🌰"],
  ["cashew", "🌰"],
  ["pecan", "🌰"],
  ["macadamia", "🌰"],
  ["brazil nut", "🌰"],
  ["pine nut", "🌰"],
  ["sunflower seed", "🌻"],
  ["chia", "🌱"],
  ["flaxseed", "🌱"],
  ["sesame", "🌱"],
  ["pumpkin seed", "🌱"],
  ["hemp seed", "🌱"],
  ["poppy seed", "🌱"],
  ["cumin seed", "🌱"],
  ["seed", "🌱"],

  // ── beverages ────────────────────────────────────────────────────────────
  ["flat white", "☕"],
  ["cortado", "☕"],
  ["espresso", "☕"],
  ["cappuccino", "☕"],
  ["latte", "☕"],
  ["mocha", "☕"],
  ["americano", "☕"],
  ["coffee", "☕"],
  ["matcha", "🍵"],
  ["kombucha", "🍵"],
  ["tea", "🍵"],
  ["beer", "🍺"],
  ["wine", "🍷"],
  ["raki", "🥃"],
  ["vodka", "🥃"],
  ["whisky", "🥃"],
  ["gin", "🍸"],
  ["mojito", "🍹"],
  ["cocktail", "🍸"],
  ["juice", "🧃"],
  ["smoothie", "🍹"],
  ["shake", "🥛"],
  ["sports drink", "⚡"],
  ["energy drink", "⚡"],
  ["cola", "🫧"],
  ["soda", "🫧"],
  ["lemonade", "🍋"],
  ["water", "💧"],

  // ── localized everyday words (tr/de/es/fr/it/pt/ar/ja) ──────────────────
  // Everything above this line is matched almost exclusively against
  // ENGLISH text (name_en, always what FoodRow/FoodPlate pass in). This
  // block exists for the ONE path that is not English: a custom food
  // (app/add-food.tsx), where name_en holds whatever the user actually
  // typed, in whatever language the app is running in. Measuring the seed
  // catalogue's tr/de/es/fr columns against the table above showed a large
  // gap there (~55-65% falling to the category default) even though the
  // catalogue itself is fine (~1% on name_en) - this section closes part of
  // that gap for the nine UI languages, without touching a single English
  // match above: everything here is appended AFTER every English/proper-
  // noun rule, so it only ever fires once nothing above already resolved
  // the name, and it can never steal a match from the table above it.
  //
  // Ordering rule inside this block is the same as the rest of the file:
  // a compound that would otherwise be swallowed by a shorter word this
  // block ALSO defines sits in the guard group first (e.g. Spanish
  // "aguacate" ahead of "agua", so avocado does not read as a glass of
  // water). Every guard below was checked against the real seed catalogue
  // (scripts/seed.test.ts's own SEED_FOODS) before being added.

  // -- collision guards for this block's own generic words ----------------
  ["pomme de terre", "🥔"], // ahead of "pomme" (apple)
  ["pois chiche", "🫘"], // ahead of "pois" (pea) - singular also matches the plural
  ["chou-fleur", "🥦"], // ahead of "chou" (cabbage, see vegetables below)
  ["sütlaç", "🍮"], // ahead of "süt" (milk) - Turkish rice pudding
  ["ıspanak", "🥬"], // ahead of "pan" (bread) - Turkish spinach, dotless ı
  ["ispanak", "🥬"], // same word, dotted-i spelling as it appears after .toLowerCase()
  ["pancar", "🥕"], // ahead of "pan" - Turkish beetroot (closest EN rule: beetroot)
  ["panais", "🥕"], // ahead of "pan" - French parsnip
  ["pankek", "🥞"], // ahead of "pan" and "kek" - Turkish pancake
  ["laitue", "🥬"], // ahead of "lait" (milk) - French lettuce
  ["domuz", "🥓"], // ahead of "muz" (banana) - Turkish pork
  ["kruvasan", "🥐"], // ahead of "uva" (grape) - Turkish croissant
  ["keşkek", "🍖"], // ahead of "kek" (cake) - Turkish wheat/meat porridge
  ["keks", "🍪"], // ahead of "kek" - German biscuit
  ["poireau", "🥬"], // ahead of "poire" (pear) - French leek
  ["massepain", "🍬"], // ahead of "pain" (bread) - French marzipan
  ["escalope", "🍖"], // ahead of "pan" - a breaded escalope is meat, not bread
  ["col rizada", "🥬"], // ahead of "riz" (rice) - Spanish kale
  ["agua saborizada", "💧"], // ahead of "riz" - Spanish flavored water
  ["aguacate", "🥑"], // ahead of "agua" (water) - Spanish avocado
  ["aguaturma", "🌿"], // ahead of "agua" - Spanish Jerusalem artichoke
  ["granatapfel", "🍇"], // ahead of "nata" (cream) - German pomegranate
  ["pastel de carne", "🍖"], // ahead of "pastel" (cake) - Spanish meat pie, not dessert
  ["wassermelone", "🍉"], // ahead of "wasser" (water) - German watermelon
  ["salatalık", "🥒"], // ahead of "salata" (salad) - Turkish cucumber
  ["hackfleisch", "🥩"], // ahead of "fleisch" (meat) - German ground meat

  // -- proteins -------------------------------------------------------------
  ["tavuk", "🍗"], ["hähnchen", "🍗"], ["pollo", "🍗"], ["poulet", "🍗"],
  ["frango", "🍗"], ["دجاج", "🍗"], ["鶏肉", "🍗"],
  ["dana", "🥩"], ["rind", "🥩"], ["ternera", "🥩"], ["bœuf", "🥩"], ["manzo", "🥩"],
  ["kuzu", "🥩"], ["lamm", "🥩"], ["cordero", "🥩"], ["agneau", "🥩"], ["agnello", "🥩"],
  ["cordeiro", "🥩"], ["لحم غنم", "🥩"], ["羊肉", "🥩"],
  ["schwein", "🥓"], ["cerdo", "🥓"], ["porc", "🥓"], ["maiale", "🥓"], ["porco", "🥓"],
  ["لحم خنزير", "🥓"], ["豚肉", "🥓"],
  ["balık", "🐟"], ["fisch", "🐟"], ["pescado", "🐟"], ["poisson", "🐟"], ["pesce", "🐟"],
  ["peixe", "🐟"], ["سمك", "🐟"], ["魚", "🐟"], ["lachs", "🐟"], ["thunfisch", "🐟"],
  ["yumurta", "🥚"], ["huevo", "🥚"], ["œuf", "🥚"], ["uovo", "🥚"], ["ovo", "🥚"],
  ["بيضة", "🥚"], ["たまご", "🥚"],
  ["carne", "🍖"], ["viande", "🍖"], ["fleisch", "🍖"],

  // -- dairy ------------------------------------------------------------------
  ["süt", "🍼"], ["milch", "🍼"], ["leche", "🍼"], ["lait", "🍼"], ["leite", "🍼"],
  ["peynir", "🧀"], ["käse", "🧀"], ["queso", "🧀"], ["queijo", "🧀"], ["جبن", "🧀"], ["チーズ", "🧀"],
  ["yoğurt", "🥣"], ["joghurt", "🥣"], ["yogur", "🥣"], ["yaourt", "🥣"], ["iogurte", "🥣"],
  ["زبادي", "🥣"], ["ヨーグルト", "🥣"],
  ["tereyağı", "🧈"], ["mantequilla", "🧈"], ["beurre", "🧈"], ["burro", "🧈"],
  ["manteiga", "🧈"], ["زبدة", "🧈"], ["バター", "🧈"],
  ["krema", "🥣"], ["nata", "🥣"], ["crème", "🥣"],

  // -- grains / starches --------------------------------------------------
  ["pirinç", "🍚"], ["reis", "🍚"], ["arroz", "🍚"], ["riz", "🍚"], ["riso", "🍚"],
  ["أرز", "🍚"], ["米", "🍚"], ["ご飯", "🍚"],
  ["ekmek", "🥖"], ["brot", "🥖"], ["pan", "🥖"], ["pain", "🥖"], ["pane", "🥖"],
  ["pão", "🥖"], ["خبز", "🥖"], ["パン", "🥖"],
  ["makarna", "🍝"], ["nudeln", "🍝"], ["pâtes", "🍝"],
  ["erişte", "🍜"], ["nouilles", "🍜"], ["fideos", "🍜"],
  ["patates", "🥔"], ["kartoffel", "🥔"], ["patata", "🥔"], ["batata", "🥔"],
  ["mısır", "🌽"], ["mais", "🌽"], ["maíz", "🌽"], ["maïs", "🌽"], ["milho", "🌽"],
  ["yulaf", "🥣"], ["avena", "🥣"], ["avoine", "🥣"],
  ["buğday", "🌾"], ["trigo", "🌾"], ["harina", "🌾"], ["farine", "🌾"],

  // -- legumes ----------------------------------------------------------------
  ["mercimek", "🫘"], ["linsen", "🫘"], ["lentejas", "🫘"], ["lentilles", "🫘"],
  ["lenticchie", "🫘"], ["عدس", "🫘"], ["レンズ豆", "🫘"],
  ["nohut", "🫘"], ["kichererbsen", "🫘"], ["garbanzos", "🫘"], ["ceci", "🫘"],
  ["حمص", "🫘"], ["ひよこ豆", "🫘"],
  ["fasulye", "🫘"], ["bohnen", "🫘"], ["alubias", "🫘"], ["frijoles", "🫘"],
  ["judías", "🫘"], ["haricots", "🫘"], ["fagioli", "🫘"], ["feijão", "🫘"], ["فاصوليا", "🫘"],
  ["bezelye", "🫛"], ["erbsen", "🫛"], ["guisantes", "🫛"], ["pois", "🫛"],
  ["بازلاء", "🫛"], ["えんどう豆", "🫛"],

  // -- vegetables ---------------------------------------------------------
  ["domates", "🍅"], ["tomate", "🍅"], ["pomodoro", "🍅"], ["طماطم", "🍅"],
  ["soğan", "🧅"], ["zwiebel", "🧅"], ["cebolla", "🧅"], ["oignon", "🧅"],
  ["cipolla", "🧅"], ["بصل", "🧅"], ["玉ねぎ", "🧅"],
  ["sarımsak", "🧄"], ["knoblauch", "🧄"], ["aglio", "🧄"], ["ثوم", "🧄"], ["にんにく", "🧄"],
  ["havuç", "🥕"], ["karotte", "🥕"], ["zanahoria", "🥕"], ["carotte", "🥕"],
  ["جزر", "🥕"], ["にんじん", "🥕"],
  ["spinat", "🥬"], ["espinaca", "🥬"], ["épinards", "🥬"], ["spinaci", "🥬"],
  ["espinafre", "🥬"], ["سبانخ", "🥬"], ["ほうれん草", "🥬"],
  ["salata", "🥗"],
  ["biber", "🫑"], ["paprika", "🫑"], ["poivron", "🫑"], ["peperone", "🫑"],
  ["pimentão", "🫑"], ["فلفل", "🫑"], ["ピーマン", "🫑"],
  ["mantar", "🍄"], ["pilz", "🍄"], ["funghi", "🍄"], ["cogumelo", "🍄"],
  ["فطر", "🍄"], ["きのこ", "🍄"],
  ["bal kabağı", "🎃"], ["calabaza", "🎃"],
  ["brokoli", "🥦"], ["brokkoli", "🥦"],
  ["melanzana", "🍆"], ["berinjela", "🍆"],
  ["zucchina", "🥒"], ["courgette", "🥒"], ["abobrinha", "🥒"], ["pepino", "🥒"], ["gurke", "🥒"],

  // -- fruits -----------------------------------------------------------------
  ["elma", "🍏"], ["manzana", "🍏"], ["pomme", "🍏"], ["apfel", "🍏"], ["mela", "🍏"],
  ["تفاح", "🍏"], ["りんご", "🍏"],
  ["muz", "🍌"], ["plátano", "🍌"], ["banane", "🍌"], ["موز", "🍌"], ["バナナ", "🍌"],
  ["portakal", "🍊"], ["naranja", "🍊"], ["arancia", "🍊"], ["برتقال", "🍊"], ["オレンジ", "🍊"],
  ["ananas", "🍍"], ["أناناس", "🍍"], ["パイナップル", "🍍"], ["piña", "🍍"],
  ["üzüm", "🍇"], ["uva", "🍇"], ["عنب", "🍇"], ["ぶどう", "🍇"], ["incir", "🍇"],
  ["coco", "🥥"],
  ["çilek", "🍓"], ["fresa", "🍓"], ["fraise", "🍓"], ["fragola", "🍓"], ["morango", "🍓"],
  ["فراولة", "🍓"], ["いちご", "🍓"],
  ["şeftali", "🍑"], ["melocotón", "🍑"], ["pêche", "🍑"], ["pesca", "🍑"],
  ["pêssego", "🍑"], ["خوخ", "🍑"], ["もも", "🍑"],
  ["kayısı", "🍑"], ["albaricoque", "🍑"], ["abricot", "🍑"], ["مشمش", "🍑"], ["あんず", "🍑"],
  ["armut", "🍐"], ["pera", "🍐"], ["poire", "🍐"], ["كمثرى", "🍐"],
  ["limon", "🍋"], ["limón", "🍋"], ["citron", "🍋"], ["limone", "🍋"], ["limão", "🍋"],
  ["ليمون", "🍋"], ["レモン", "🍋"],
  ["cereja", "🍒"],
  ["badem", "🌰"], ["mandel", "🌰"], ["almendra", "🌰"], ["amande", "🌰"], ["mandorle", "🌰"],
  ["amêndoa", "🌰"], ["لوز", "🌰"], ["アーモンド", "🌰"],
  ["fındık", "🌰"], ["haselnuss", "🌰"], ["avellana", "🌰"], ["noisette", "🌰"],
  ["nocciole", "🌰"], ["avelã", "🌰"], ["くるみ", "🌰"],
  ["kestane", "🌰"], ["kastanie", "🌰"], ["châtaigne", "🌰"],

  // -- sweets -----------------------------------------------------------------
  ["çikolata", "🍫"], ["chocolat", "🍫"], ["schokolade", "🍫"], ["cioccolato", "🍫"],
  ["شوكولاتة", "🍫"], ["チョコレート", "🍫"],
  ["miel", "🍯"], ["honig", "🍯"], ["mel", "🍯"], ["عسل", "🍯"], ["はちみつ", "🍯"],
  ["kek", "🧁"], ["gâteau", "🧁"], ["pastel", "🧁"], ["torta", "🧁"], ["كعكة", "🧁"], ["ケーキ", "🧁"],
  ["bisküvi", "🍪"], ["galleta", "🍪"], ["بسكويت", "🍪"], ["クッキー", "🍪"],
  ["dondurma", "🍨"], ["helado", "🍨"], ["glace", "🍨"], ["آيس كريم", "🍨"], ["アイスクリーム", "🍨"],

  // -- beverages --------------------------------------------------------------
  ["çay", "🍵"], ["tee", "🍵"], ["thé", "🍵"], ["chá", "🍵"], ["شاي", "🍵"], ["お茶", "🍵"],
  ["kahve", "☕"], ["kaffee", "☕"], ["café", "☕"], ["قهوة", "☕"], ["コーヒー", "☕"],
  ["bira", "🍺"], ["bier", "🍺"], ["cerveza", "🍺"], ["cerveja", "🍺"], ["بيرة", "🍺"], ["ビール", "🍺"],
  ["şarap", "🍷"], ["vin", "🍷"], ["vino", "🍷"], ["vinho", "🍷"], ["نبيذ", "🍷"], ["ワイン", "🍷"],
  ["jus", "🧃"], ["saft", "🧃"], ["zumo", "🧃"], ["meyve suyu", "🧃"], ["عصير", "🧃"], ["ジュース", "🧃"],
  ["agua", "💧"], ["wasser", "💧"], ["água", "💧"], ["ماء", "💧"],

  // ── low-priority generic catch-alls (checked last on purpose) ──────────
  ["frozen", "🧊"],
];

/**
 * A specific illustration for a food, from an English-keyword table (checked
 * against `name_en`, the one column every row - seeded, scanned or typed -
 * always has). Falls back to the food's category plate (lib/db/categories
 * categoryEmoji, not redefined here) when nothing in the table matches, which
 * is the same emoji FoodPlate has always shown for that shelf.
 */
export function emojiFor(nameEn: string, category: string): string {
  const n = (nameEn || "").toLowerCase();
  if (n) {
    for (const [keyword, emoji] of EMOJI_RULES) {
      if (n.includes(keyword)) return emoji;
    }
  }
  return categoryEmoji(category);
}

/**
 * The ONE place that decides which plate a specific, already-stored food
 * draws: the user's own pick (`food.emoji`, schema v20 - see lib/db/v20Sql)
 * if there is one, else the same emojiFor(name_en, category) chain every
 * surface has always shown. Every screen that draws a per-dish plate for a
 * REAL row (FoodRow's browse list, FoodPlate's FoodIconTile) reads through
 * this instead of calling emojiFor directly, so a food's icon can never read
 * differently on one surface than another.
 *
 * Takes a structural slice rather than the full `Food` row so a synthetic
 * stand-in (a typed-name meal, a meal template - see app/calculator.tsx
 * foodFromMeal/foodFromTemplate) still works: those always carry `emoji:
 * null` today (nothing synthetic is ever user-edited through
 * app/add-food.tsx), which falls straight through to emojiFor, unchanged
 * from before this function existed.
 */
export function resolveFoodEmoji(food: {
  name_en: string;
  category: string;
  emoji?: string | null;
}): string {
  return food.emoji || emojiFor(food.name_en, food.category);
}

/**
 * The compact grid app/add-food.tsx offers for a food the user can edit
 * (custom, or a cached barcode result - see the isEditableFood rule in
 * app/(tabs)/food.tsx): about forty everyday food emoji, one or a few per
 * shelf so no single picture dominates the grid, for a quick specific pick
 * without asking the user to search a full system emoji keyboard. "Temizle"
 * in that screen clears the stored choice back to this file's own
 * emojiFor/category match - it does not remove a row from this list.
 */
export const FOOD_EMOJI_PICKER_OPTIONS: readonly string[] = [
  // fruits
  "🍏", "🍌", "🍊", "🍓",
  // vegetables
  "🍅", "🥦", "🥕", "🥬", "🫑",
  // grains / bakery
  "🍞", "🥐", "🍚", "🥯",
  // legumes
  "🫘", "🫛",
  // dairy
  "🧀", "🥛", "🧈", "🥣",
  // protein
  "🍗", "🥩", "🥓", "🐟", "🥚",
  // dishes / fastfood
  "🍕", "🌮", "🥪", "🍔", "🍜",
  // sweets
  "🍫", "🍪", "🧁", "🍨",
  // nuts
  "🥜", "🌰",
  // beverages
  "☕", "🍵", "🍺", "🧃",
  // other
  "💧",
];

/**
 * Per-language "everyday staple" keyword lists, matched against the English
 * name (the column every row carries). Words are the ENGLISH form of each
 * locale's staples - what the catalogue actually stores - not the native
 * spelling, since matching runs on name_en regardless of which language's
 * shelf is being ranked.
 */
const STAPLE_KEYWORDS: Record<Lang, readonly string[]> = {
  tr: [
    "bread", "rice pilaf", "rice", "bulgur", "yogurt", "ayran", "lentil soup",
    "soup", "kebab", "kebap", "meatballs", "borek", "gozleme", "simit",
    "pogaca", "pita", "lavash", "turkish coffee", "feta cheese", "olive",
    "tomato", "cucumber", "eggplant", "chickpea", "lentil", "white beans",
    "stuffed vine leaves", "cabbage rolls", "baklava", "kunefe",
    "turkish delight", "cig kofte", "doner", "lahmacun", "manti", "menemen",
    "cacik", "ezogelin", "tarhana", "sucuk", "pastrami", "boza", "salep",
  ],
  en: [
    "bread", "toast", "egg", "bacon", "sandwich", "burger", "french fries",
    "chicken", "roast chicken", "potato", "mashed potato", "cheddar cheese",
    "milk", "tea", "coffee", "apple pie", "biscuit", "potato chips",
    "pancakes", "oatmeal", "cornflakes", "pizza", "pasta", "steak",
    "fish and chips", "rice pudding", "scone", "muffin", "shepherd's pie",
    "english breakfast", "roast pork", "gravy", "cheeseburger", "hot dog",
    "bacon and eggs",
  ],
  de: [
    "bread", "rye bread", "pretzel", "bread roll", "sausage", "sauerkraut",
    "potato", "boiled potato", "schnitzel", "spätzle", "beer", "cheese",
    "quark", "rye", "goulash", "goulash soup", "currywurst", "bratwurst",
    "potato salad", "potato pancakes", "potato dumplings", "sauerbraten",
    "leberkäse", "maultaschen", "cheese spaetzle", "roast pork",
    "bread dumplings", "pork knuckle", "zwiebelrostbraten", "tafelspitz",
    "kaiserschmarrn", "flammkuchen", "muesli", "pea soup",
    "königsberger klopse", "pumpernickel", "black forest cake",
  ],
  fr: [
    "baguette", "croissant", "cheese", "wine", "butter", "crepe", "crêpe",
    "quiche", "ratatouille", "onion soup", "brie", "camembert", "pâté",
    "coq au vin", "bouillabaisse", "profiterole", "crème brûlée",
    "chocolate mousse", "soufflé", "salade niçoise", "duck confit",
    "moules marinières", "tartiflette", "cordon bleu",
    "escargots de bourgogne", "aligot", "gratin dauphinois", "cassoulet",
    "pot-au-feu", "bœuf bourguignon", "blanquette de veau", "croque monsieur",
    "macaron", "eclair", "tarte", "apple pie",
  ],
  es: [
    "paella", "spanish omelette", "patatas bravas", "croquettes", "gazpacho",
    "churros", "tortilla", "jamón", "chorizo", "olive oil", "tomato",
    "manchego", "fabada asturiana", "cocido madrileño", "pisto",
    "pulpo a la gallega", "gambas al ajillo", "salmorejo", "fideuà",
    "callos a la madrileña", "bacalao", "flan", "sangria", "rice",
    "lentil soup", "chickpea stew", "tapas", "milanesa a la napolitana",
    "empanada", "alfajor", "dulce de leche", "cocktail (gin and tonic)",
    "chorizo sausage", "octopus",
  ],
  it: [
    "pasta", "pizza", "risotto", "gnocchi", "parmesan", "mozzarella",
    "olive oil", "tomato", "basil", "tiramisu", "spaghetti", "carbonara",
    "lasagna", "focaccia", "ciabatta", "panini", "espresso", "cappuccino",
    "gelato", "panna cotta", "minestrone", "arancini", "prosciutto",
    "polenta", "biscotti", "ricotta", "burrata", "gorgonzola", "penne",
    "fusilli", "fettuccine", "linguine", "cannoli", "panettone",
  ],
  pt: [
    "rice", "beans", "black beans", "fish", "cod", "coconut", "coconut water",
    "feijoada", "churrasco", "brigadeiro", "papaya", "guava", "passion fruit",
    "pineapple", "mango", "shrimp", "octopus", "espresso", "custard",
    "sardine", "grilled fish", "chicken", "potato", "onion", "garlic",
    "orange", "lemon", "banana", "cheese", "milk", "coffee", "olive",
  ],
  ar: [
    "hummus", "falafel", "date", "flatbread", "pita", "tahini", "lamb",
    "rice", "yogurt", "olive", "lentil", "chickpea", "eggplant", "labneh",
    "shawarma", "kebab", "tabbouleh", "baklava", "manakish", "kibbeh",
    "fattoush", "baba ganoush", "couscous", "tagine", "dates", "harira",
    "maqluba", "mujadara", "ful medames", "dolma", "stuffed vine leaves",
    "cacik", "cinnamon",
  ],
  ja: [
    "rice", "sushi", "sashimi", "miso", "ramen", "tofu", "noodle", "udon",
    "soba", "tempura", "teriyaki", "matcha", "onigiri", "gyoza",
    "green tea", "dorayaki", "taiyaki", "okonomiyaki", "takoyaki",
    "yakitori", "katsu", "mochi", "edamame", "wasabi", "miso soup",
    "sticky rice", "sushi rice", "wonton soup", "seaweed", "nori",
    "green smoothie", "soy",
  ],
};

/** Fixed nudge a staple match gets in the JS shelf re-sort. 0 is neutral;
 *  everything else is either boosted (this) or unranked. */
const STAPLE_BOOST = 1;

/**
 * Whether `nameEn` reads as one of `lang`'s everyday staples, as a sort
 * weight: 1 to float it toward the top of its shelf, 0 for everything else.
 * A plain number rather than a score, because the lists are presence
 * keywords, not a ranked scale - there is nothing to compare two matches on.
 */
export function rankBoost(nameEn: string, lang: Lang): number {
  const list = STAPLE_KEYWORDS[lang];
  if (!list || list.length === 0) return 0;
  const n = (nameEn || "").toLowerCase();
  if (!n) return 0;
  return list.some((kw) => n.includes(kw)) ? STAPLE_BOOST : 0;
}

/**
 * Italian/Portuguese staple word -> the English catalogue term it should also
 * match. The catalogue has no it/pt name column (lib/db/types foodName falls
 * back to English for these two, same as ar/ja), so a query typed in the
 * user's own language matches nothing without this bridge.
 */
const QUERY_EXPANSION: Partial<Record<Lang, Readonly<Record<string, string>>>> = {
  it: {
    riso: "rice",
    pasta: "pasta",
    pane: "bread",
    pollo: "chicken",
    pesce: "fish",
    formaggio: "cheese",
    latte: "milk",
    uovo: "egg",
    uova: "egg",
    carne: "beef",
    manzo: "beef",
    maiale: "pork",
    agnello: "lamb",
    tacchino: "turkey",
    pizza: "pizza",
    insalata: "salad",
    patate: "potato",
    patata: "potato",
    pomodoro: "tomato",
    cipolla: "onion",
    aglio: "garlic",
    mela: "apple",
    arancia: "orange",
    uva: "grapes",
    fragola: "strawberry",
    pesca: "peach",
    pera: "pear",
    ciliegia: "cherry",
    limone: "lemon",
    fagioli: "beans",
    lenticchie: "lentils",
    ceci: "chickpeas",
    zuppa: "soup",
    minestra: "soup",
    torta: "cake",
    caffè: "coffee",
    caffe: "coffee",
    tè: "tea",
    te: "tea",
    vino: "wine",
    birra: "beer",
    burro: "butter",
    miele: "honey",
    noci: "walnut",
    mandorle: "almond",
    nocciole: "hazelnut",
    gamberi: "shrimp",
    tonno: "tuna",
    salmone: "salmon",
    funghi: "mushroom",
    melanzana: "eggplant",
    zucchina: "zucchini",
    peperone: "bell pepper",
    spinaci: "spinach",
    succo: "juice",
    acqua: "water",
    cioccolato: "chocolate",
    gelato: "ice cream",
    yogurt: "yogurt",
  },
  pt: {
    arroz: "rice",
    feijao: "beans",
    "feijão": "beans",
    frango: "chicken",
    peixe: "fish",
    queijo: "cheese",
    leite: "milk",
    ovo: "egg",
    ovos: "egg",
    "pão": "bread",
    pao: "bread",
    carne: "beef",
    porco: "pork",
    cordeiro: "lamb",
    peru: "turkey",
    batata: "potato",
    tomate: "tomato",
    cebola: "onion",
    alho: "garlic",
    "maçã": "apple",
    maca: "apple",
    banana: "banana",
    laranja: "orange",
    uva: "grapes",
    morango: "strawberry",
    "pêssego": "peach",
    pessego: "peach",
    pera: "pear",
    cereja: "cherry",
    "limão": "lemon",
    limao: "lemon",
    lentilha: "lentils",
    "grão de bico": "chickpeas",
    grao: "chickpeas",
    sopa: "soup",
    bolo: "cake",
    "café": "coffee",
    cafe: "coffee",
    "chá": "tea",
    cha: "tea",
    vinho: "wine",
    cerveja: "beer",
    manteiga: "butter",
    mel: "honey",
    noz: "walnut",
    "amêndoa": "almond",
    amendoa: "almond",
    "avelã": "hazelnut",
    avela: "hazelnut",
    "camarão": "shrimp",
    camarao: "shrimp",
    atum: "tuna",
    "salmão": "salmon",
    salmao: "salmon",
    cogumelo: "mushroom",
    berinjela: "eggplant",
    abobrinha: "zucchini",
    "pimentão": "bell pepper",
    pimentao: "bell pepper",
    espinafre: "spinach",
    suco: "juice",
    "água": "water",
    agua: "water",
    chocolate: "chocolate",
    coco: "coconut",
    bacalhau: "cod",
  },
};

/**
 * The extra English catalogue terms `query` implies for `lang`, to OR into
 * the existing search query. Empty for every language but it/pt (the other
 * five either have their own name column or - ar/ja - are out of this
 * feature's scope), so their search behaviour is untouched.
 *
 * Matching is prefix-based in both directions (a partial "ris" should still
 * surface "riso" -> rice while the user is mid-word, and a partial local
 * table entry should still catch a fully typed query), mirroring the prefix
 * semantics searchFoods already applies to the typed query itself.
 */
export function queryExpansion(query: string, lang: Lang): string[] {
  const table = QUERY_EXPANSION[lang];
  if (!table) return [];
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const terms = new Set<string>();
  for (const token of tokens) {
    for (const [local, en] of Object.entries(table)) {
      if (local.startsWith(token) || token.startsWith(local)) {
        terms.add(en);
      }
    }
  }
  return [...terms];
}
