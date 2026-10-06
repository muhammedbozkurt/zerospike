// Output gate: the last line of defence after the system prompt. A reply that
// matches any rule is replaced with a fixed, regulation-safe text in the
// user's language (filtered: true).
//
// Rules target dosing (a number of insulin units, directive, modal or
// permission forms of a dose or medication change, carb/correction ratios) and
// diagnosis (stated, inferred from the user's readings, or "your readings fall
// in the diabetes range"). Education ("insulin lowers glucose") and refusals
// ("I can't suggest a dose") must pass, so every rule needs a number, a
// directive or modal verb form, or a second-person conclusion, and negated
// forms are excluded. Every language's rules run on every reply, because a
// reply can drift from the requested locale.
//
// Text is normalised before matching (see normalizeWithMap): NFKC, invisible
// and combining characters removed, Cyrillic and Greek look-alikes folded to
// Latin, so "un\u200Bits" and fullwidth letters cannot slip past a rule. A
// third pass also strips accents and folds the look-alikes that have no
// decomposition (dotless i, small-cap u), so "\u00FAnits" and "un\u0131ts" read as
// "units" too: it is a second reading of the same text, never a replacement,
// because stripping accents changes what Turkish or French words mean.
import { parseMeta, visibleEnd, type ActionId, type Locale } from "./prompt.ts";
import type { SourceRef } from "./sources.ts";

// Western, Arabic-Indic, Persian and full-width digits.
const D = String.raw`[0-9٠-٩۰-۹０-９]`;
const NUM = String.raw`${D}+(?:[.,]${D}+)?`;
// "4", "4,5", "4-6", "4 to 6", "4 bis 6", "4〜6" (\u2013/\u2014: en and em dash)
const AMOUNT = String.raw`${NUM}(?:\s*(?:-|\u2013|\u2014|~|〜|to|bis|à|a|ila|ile)\s*${NUM})?`;
// JS \b is ASCII-only, useless next to ü, é, ş, Arabic or kana.
const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;
// Before a figure only another digit is in the way: "糖質比は1:10" has a particle right before the 1.
const NB = String.raw`(?<![\p{N}])`;
// One character that stays inside a sentence.
const SENTENCE_GAP = String.raw`[^.!?\n。؟]`;

interface Rule {
  id: string;
  re: RegExp;
}
// "g" only so the streaming check can list every match with matchAll.
const rule = (id: string, source: string): Rule => ({ id, re: new RegExp(source, "gimu") });

// ── en ──────────────────────────────────────────────────────────────────────
// A directive context right before the verb: sentence start, "you should",
// "I'd recommend (that) you", "I would lower", "consider", "maybe", "try (to)".
// "Don't stop..." / "never skip..." / "talk to your doctor before you
// change..." have none of these, so they pass.
const EN_LEAD = String.raw`(?:^\s*|[.!?:;]\s+|${B}you\s+(?:should|must|need\s+to|have\s+to|ought\s+to|may\s+want\s+to|might\s+want\s+to|'d\s+better|had\s+better)\s+|${B}I(?:'d|\s+would)?\s+(?:recommend|suggest|advise)\s+(?:that\s+)?(?:you\s+)?|${B}I(?:'d|'ll|\s+would|\s+will)\s+(?:(?:probably|personally|simply|just|maybe|also|gently|definitely|certainly)\s+)*|${B}(?:(?:you\s+)?(?:might|may|could|should)\s+(?:also\s+)?)?consider\s+|${B}(?:maybe|perhaps|possibly)\s+(?:you\s+(?:could|should|might)\s+)?|${B}try\s+(?:to\s+)?|${B}go\s+ahead\s+and\s+|${B}feel\s+free\s+to\s+)(?:please\s+)?`;
const EN_ORAL = String.raw`metformin|glucophage|glipizide|glimepiride|gliclazide|glibenclamide|glyburide|sitagliptin|januvia|linagliptin|saxagliptin|vildagliptin|empagliflozin|jardiance|dapagliflozin|farxiga|canagliflozin|pioglitazone|acarbose|repaglinide|nateglinide|semaglutide|ozempic|liraglutide|victoza|dulaglutide|trulicity|tirzepatide|mounjaro`;
const EN_MED = String.raw`(?:insulin|medications?|medicines?|pills|tablets|lantus|levemir|tresiba|toujeo|basaglar|novorapid|novolog|humalog|fiasp|apidra|lyumjev|${EN_ORAL})`;
const EN_DOSE = String.raw`(?:doses?|dosage|basal(?:\s+rate)?|bolus|units)`;
// For permission forms "units" is left out: "you can change the units" is the glucose unit setting.
const EN_DOSE_M = String.raw`(?:doses?|dosage|basal(?:\s+rate)?|bolus)`;
// "change your insulin pen needle", "start the insulin reminder", "skip the insulin type setting" are app help, not dosing.
const EN_NOT_ITEM = String.raw`(?!(?:\s+(?:insulin|basal|bolus|doses?))?\s+(?:type|product|brand|settings?|pens?|needles?|log\p{L}*|track\p{L}*|schedul\p{L}*|notif\p{L}*|alarm\p{L}*|records?|entr(?:y|ies)|history|reminders?|timer|sites?|cartridges?|vials?|storage|data|chart|card|calculators?|maps?|guide|section|tab|screen|page|feature|field|input|button|list|catalog|presets?|profile|summary|tracker|diary|journal|widget|label|name|setup|notes?|you\s+(?:logged|entered|recorded|saved|wrote|added|typed)))`;
const EN_UNITS_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine)`;
const EN_NUMWORD = String.raw`(?:(?:twenty|thirty|forty|fifty)(?:[-\s]${EN_UNITS_WORD})?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${EN_UNITS_WORD}|a\s+few|a\s+couple(?:\s+of)?|several)`;
const EN_COND = String.raw`(?:(?:(?:type\s*[12]|gestational)\s+)?(?:pre-?)?diabet(?:es|ic)|insulin\s+resistan(?:ce|t)|(?:diabetic\s+)?ketoacidosis|DKA)`;
// "does not (necessarily) mean ...": negated, so what follows is no verdict.
const EN_NEG = String.raw`(?:not|n't|never|cannot)\s+(?:(?:necessarily|automatically|always|really|directly|yet|by\s+itself)\s+)?`;
// "diabetes-friendly recipes", "diabetes-related questions", "diabetes data" are compounds, not a verdict.
const EN_COND_END = String.raw`${E}(?![\u2010-\u2013-]\p{L})(?!\s+(?:data|information|info|education|management|care|apps?|tracking|logs?|logging|journal|tools?|resources?|support|supplies|settings?|profile|reminders?|recipes?|charts?|reports?|stats|statistics|numbers|readings|entries|records?)${E})`;
// "If you have diabetes, ..." is a conditional, not a verdict.
const EN_NOT_IF = String.raw`(?<!(?:if|when|whether|unless)\s)`;
const EN_DOSE_VERB = String.raw`(?:increase|increasing|decrease|decreasing|reduce|reducing|lower|lowering|raise|raising|double|doubling|halve|halving|skip|skipping|stop|stopping|start|starting|pause|pausing|discontinue|discontinuing|quit|quitting|cut\s+(?:back|down)\s+on|come\s+off|go\s+off|titrate|titrating|adjust|adjusting|change|changing|modify|modifying|tweak|tweaking|bump\s+up|bring\s+down|drop|dropping|up)`;
const EN_ADV = String.raw`(?:(?:also|safely|probably|simply|just|easily|usually|likely|possibly|even|certainly|definitely|generally|typically|still|always|gradually|slowly|slightly)\s+)*`;
const EN_DOSE_OBJ = String.raw`(?:taking\s+|using\s+|injecting\s+)?(?:(?:your|the|a|an|some|any)\s+)?(?:(?:rapid|fast|short|long|quick|slow)[-\s]acting\s+|(?:night(?:time)?|evening|morning|mealtime|meal|correction|daily)\s+)?(?:${EN_DOSE_M}|${EN_MED})${E}${EN_NOT_ITEM}`;
// Readings, results or levels, optionally with their value: "Your fasting readings of 119".
const EN_DATA = String.raw`(?:your|these|those|the)\s+(?:\p{L}+\s+){0,3}(?:readings?|values?|numbers?|results?|levels?|tests?|measurements?|a1c|hba1c)(?:\s+of\s+${NUM}(?:\s*(?:mg\s*/\s*dl|mmol\s*/\s*l|%))?)?`;

const EN: Rule[] = [
  // "take 4 units", "4-6 units", "4-unit bolus", "2 extra units", "10 IU", "10 U", "10u". The prompt bans any
  // number of units; "100 units/mL" (U-100 concentration) is not a dose.
  rule("dose_units_en", String.raw`${B}${AMOUNT}[\s\u2010-\u2013-]*(?:(?:extra|more|additional|fewer|less)\s+)?(?:units?|IU|U(?!\.?\p{L})(?![\u2010-\u2013-]\p{L}))${E}(?!\s*(?:per|/)\s*ml${E})(?!\s+(?:of\s+measure|used\s+(?:for|to)))`),
  // Spelled-out amounts only with a dosing verb, "units of ... insulin" or a mealtime ("twenty units before
  // dinner"): "two units: mg/dL and mmol/L" is about measurement units and must pass.
  rule("dose_words_en", String.raw`${B}(?:(?:take|inject|give|bolus|dose|add|use|need|go\s+with|stick\s+(?:with|to)|aim\s+for|settle\s+on)\s+(?:yourself\s+)?(?:about\s+|around\s+|roughly\s+|another\s+)?${EN_NUMWORD}\s+(?:(?:extra|more|additional)\s+)?units?|${EN_NUMWORD}\s+(?:(?:extra|more|additional)\s+)?units?\s+(?:of\s+(?:\p{L}+[-\s]){0,2}insulin|(?:before|after|with|at|for|prior\s+to|to\s+cover|per|each|every)\s+(?:(?:the|your|each|every|a|an)\s+)?(?:meals?|dinner|lunch|breakfast|bed(?:time)?|night|snacks?|food|eating|morning|evening|supper)))${E}`),
  // "Inject 4 of your NovoRapid before dinner": the amount is a number of units without saying so.
  rule("dose_of_en", String.raw`${B}(?:take|inject|give|bolus|dose|add|use)\s+(?:yourself\s+)?(?:about\s+|around\s+|roughly\s+|another\s+)?(?:${NUM}|${EN_NUMWORD})\s+of\s+(?:your|the|that)\s+(?:(?:rapid|fast|short|long|quick|slow)[-\s]acting\s+)?${EN_MED}${E}`),
  // "Stop taking your metformin", "you should increase your basal", "I'd suggest skipping your evening dose".
  rule("dose_change_en", String.raw`${EN_LEAD}(?:increase|increasing|decrease|decreasing|reduce|reducing|lower|lowering|raise|raising|double|doubling|halve|halving|skip|skipping|stop|stopping|start|starting|pause|pausing|discontinue|discontinuing|quit|quitting|cut\s+(?:back|down)\s+on|come\s+off|go\s+off)\s+(?:taking\s+|using\s+|injecting\s+)?(?:(?:your|the|a|an|some|any)\s+)?(?:(?:rapid|fast|short|long|quick|slow)[-\s]acting\s+|(?:night(?:time)?|evening|morning|mealtime|meal|correction|daily)\s+)?(?:${EN_DOSE}|${EN_MED})${E}${EN_NOT_ITEM}`),
  // "Adjust your dose" / "change your basal rate"; with bare "insulin" it could be the app's insulin-type setting.
  rule("dose_adjust_en", String.raw`${EN_LEAD}(?:adjust|adjusting|change|changing|modify|modifying|tweak|tweaking|titrate|titrating)\s+(?:(?:your|the)\s+)?(?:(?:insulin|basal|bolus)\s+)?(?:doses?|dosage|basal\s+rate)${E}${EN_NOT_ITEM}`),
  // Permission: "Yes, you can stop taking your metformin", "you could lower your basal insulin a little",
  // "you're welcome to stop your metformin".
  // A "whether / if / how" in front is a question the reply is not answering.
  rule("dose_modal_en", String.raw`(?<!(?:if|whether|when|unless|before|after|what|how|why|which|that|than|as)\s)${B}you(?:\s+(?:can|could|may|might)|(?:\s+are|'re)\s+(?:free|able|allowed|welcome|permitted|encouraged|fine|okay|ok|safe)\s+to)\s+${EN_ADV}${EN_DOSE_VERB}\s+${EN_DOSE_OBJ}`),
  // "It's fine to stop metformin", "it is safe to skip a dose".
  rule("dose_fine_to_en", String.raw`${B}(?:it(?:'s|\s+is)|that(?:'s|\s+is)|this\s+is)\s+(?:perfectly\s+|usually\s+|generally\s+|probably\s+|totally\s+|completely\s+)?(?:fine|ok(?:ay)?|safe|alright|acceptable|reasonable|possible|wise|best|better|advisable|a\s+good\s+idea)\s+(?:for\s+you\s+)?to\s+${EN_ADV}${EN_DOSE_VERB}\s+${EN_DOSE_OBJ}`),
  // "It's okay if you skip your evening dose."
  rule("dose_fine_if_en", String.raw`${B}(?:it(?:'s|\s+is)|that(?:'s|\s+is)|this\s+is)\s+(?:perfectly\s+|usually\s+|generally\s+|probably\s+|totally\s+|completely\s+|absolutely\s+)?(?:fine|ok(?:ay)?|safe|alright|acceptable|no\s+problem)\s+(?:if|when)\s+you\s+${EN_ADV}${EN_DOSE_VERB}\s+${EN_DOSE_OBJ}`),
  // "There's no harm in skipping your evening dose", "no problem with stopping your metformin".
  rule("dose_no_harm_en", String.raw`${B}(?:(?:there(?:'s|\s+is)|it(?:'s|\s+is)|that(?:'s|\s+is))\s+(?:really\s+|absolutely\s+|generally\s+|usually\s+|typically\s+)?)?(?:no\s+(?:harm|problem|issue|risk|danger|reason\s+not)|nothing\s+wrong)\s+(?:(?:in|with|to|for\s+you\s+to)\s+)?${EN_ADV}${EN_DOSE_VERB}\s+${EN_DOSE_OBJ}`),
  // "It might help to lower your dose", "it could be wise to reduce your insulin".
  rule("dose_might_help_en", String.raw`${B}(?:it|that)\s+(?:might|may|could|would|can)\s+(?:also\s+)?(?:be\s+)?(?:help(?:ful)?|worth|a\s+good\s+idea|better|wiser?|sensible|best|ok(?:ay)?|fine)\s+(?:to\s+|if\s+you\s+|trying\s+to\s+)?${EN_ADV}${EN_DOSE_VERB}\s+${EN_DOSE_OBJ}`),
  // "No need to take your evening dose tonight", "you don't need to take your insulin".
  rule("dose_no_need_en", String.raw`${B}(?:no\s+need\s+(?:for\s+you\s+)?to|you\s+(?:don't|do\s+not)\s+(?:need|have)\s+to|you\s+(?:needn't|need\s+not)|you\s+no\s+longer\s+(?:need|have)\s+to)\s+(?:take|inject|use|give|bolus)\s+(?:(?:your|the|a|an|any|some)\s+)?(?:(?:rapid|fast|short|long|quick|slow)[-\s]acting\s+|(?:night(?:time)?|evening|morning|mealtime|meal|correction|daily)\s+)?(?:${EN_DOSE_M}|${EN_MED})${E}${EN_NOT_ITEM}`),
  // "You don't need your metformin anymore", "you no longer need your basal insulin".
  rule("dose_no_longer_en", String.raw`${B}you\s+(?:(?:don't|do\s+not)\s+(?:need|require)|no\s+longer\s+(?:need|require))\s+(?:(?:your|the)\s+(?:${EN_DOSE_M}|${EN_MED})(?:\s+(?:any\s*more|any\s+longer))?|(?:${EN_DOSE_M}|${EN_MED})\s+(?:any\s*more|any\s+longer))${E}${EN_NOT_ITEM}`),
  // "you probably have type 2 diabetes", "you're likely prediabetic".
  rule("diagnosis_en", String.raw`${EN_NOT_IF}${B}you(?:\s+|\s+are\s+|'re\s+|'ve\s+)(?:most\s+likely|likely|probably|definitely|clearly|certainly)\s+(?:(?:have|are|got|developed)\s+)?(?:an?\s+)?${EN_COND}${E}`),
  // "Your A1C of 6.8% means you have diabetes", "which confirms you have prediabetes". "Doesn't (necessarily) mean you
  // have" and "a doctor can confirm you have" are education and pass.
  rule("diagnosis_means_en", String.raw`${EN_NOT_IF}${B}(?:(?<!${EN_NEG})(?:means?|shows?|indicates?|suggests?|implies|imply|points?\s+to)|(?<!(?:${EN_NEG}|(?:can|could|may|might|will|would|should|must|to)\s+))(?:confirms?|proves?))\s+(?:that\s+)?you\s+(?:(?:most\s+likely|likely|probably|definitely|clearly)\s+)?(?:have|are|might\s+have|may\s+have|could\s+have|might\s+be|may\s+be|could\s+be)\s+(?:an?\s+)?${EN_COND}${EN_COND_END}`),
  // "your readings suggest that you have prediabetes", "it sounds like you have DKA".
  rule("diagnosis_inferred_en", String.raw`(?:(?:it\s+)?(?:sounds|looks|seems)\s+like|this\s+(?:means|shows|indicates|suggests|confirms)|(?:these|your)\s+(?:numbers|readings|values|results|levels)\s+(?:mean|show|indicate|suggest|confirm|point\s+to))\s+(?:that\s+)?you\s+(?:have|are|might\s+have|may\s+have|could\s+have|might\s+be|may\s+be|could\s+be)\s+(?:an?\s+)?${EN_COND}${E}`),
  // "Your readings suggest prediabetes", "your fasting values point to diabetes".
  rule("diagnosis_suggest_en", String.raw`${B}${EN_DATA}\s+(?:\p{L}+\s+){0,2}(?:suggests?|indicates?|points?\s+to|(?:is|are)\s+consistent\s+with|reflects?|shows?|confirms?)\s+(?:that\s+you\s+(?:have|are|may\s+have|might\s+have|could\s+have|might\s+be|may\s+be|could\s+be)\s+(?:an?\s+)?|(?:the\s+)?(?:presence\s+of\s+|signs?\s+of\s+|early\s+|possible\s+)?(?:an?\s+)?)${EN_COND}${E}`),
  // "Your fasting readings of 119 fall in the prediabetes range", "you're in the diabetic range". The gap is long
  // enough for a subject with a time span ("Your average fasting value across these last fourteen days ... falls").
  rule("diagnosis_range_en", String.raw`${B}(?:your|you(?:'re|'ve)?)${E}(?:(?!(?:which|what|that|whether|if|how)${E})${SENTENCE_GAP}){0,130}?${B}(?:fall|falls|fell|lie|lies|sit|sits|land|lands|are|is|put\s+you|places?\s+you)\s+(?:(?:squarely|firmly|well|right|clearly|currently|just|solidly)\s+)?(?:in|into|within|inside)\s+the\s+(?:(?:pre-?)?diabet(?:es|ic)|diabetic)\s+(?:range|zone|category|territory|bracket|band)${E}`),
  // "You have type 2 diabetes." as a sentence of its own, or after a comma ("With these values, you have diabetes");
  // "If you have..." and "Do you have...?" pass.
  rule("diagnosis_bare_en", String.raw`(?:^\s*|[.!?]\s+|[,;:]\s*)(?:so\s+|yes,\s+|well,\s+|unfortunately,\s+|actually,\s+)?you(?:\s+do)?(?:\s+have(?:\s+got)?|\s+are|'ve\s+got|'re)\s+(?:an?\s+)?(?:(?:borderline|slightly|mildly|very|clearly|technically|officially)\s+)?${EN_COND}${EN_COND_END}`),
  // "I think you have diabetes", "I suspect you may have prediabetes", "you seem to have diabetes".
  rule("diagnosis_opinion_en", String.raw`${EN_NOT_IF}${B}(?:I(?:\s+(?:really|honestly|do))?\s+(?:think|believe|suspect|guess|feel|would\s+say|bet)|I'd\s+say)\s+(?:that\s+)?you(?:'ve|'re)?\s+(?:probably\s+|likely\s+|may\s+|might\s+|could\s+)?(?:(?:have|are|got)\s+)?(?:an?\s+)?${EN_COND}${EN_COND_END}|${EN_NOT_IF}${B}you\s+(?:seem|appear)\s+to\s+(?:have|be)\s+(?:an?\s+)?${EN_COND}${EN_COND_END}`),
  // "You might have prediabetes." as a sentence of its own.
  rule("diagnosis_possible_en", String.raw`(?:^\s*|[.!?]\s+|[,;:]\s*)(?:so\s+|well,\s+)?you\s+(?:may|might|could)\s+(?:well\s+|possibly\s+|indeed\s+)?(?:have|be)\s+(?:an?\s+)?${EN_COND}${EN_COND_END}`),
  // "Based on your numbers, this looks like type 2 diabetes."
  // The condition ends the clause ("... like diabetes.", "... diabetes, but"), so "looks like diabetes education" passes.
  rule("diagnosis_looks_en", String.raw`${EN_NOT_IF}${B}(?:this|that|it)\s+(?:looks|sounds|seems|appears)\s+(?:to\s+be\s+|like\s+(?:it(?:'s|\s+is)\s+)?)(?:an?\s+)?(?:(?:classic|typical|early|possible|textbook)\s+)?${EN_COND}${EN_COND_END}(?=\s*(?:[.,;:!?)]|$|(?:to|and|or|but|so|because|though|right|already|based|given|with)${E}))`),
  // "You meet the criteria for diabetes", "you qualify as diabetic".
  rule("diagnosis_criteria_en", String.raw`${EN_NOT_IF}${B}you\s+(?:(?:clearly|likely|probably|currently|already|now|would|might|may|could)\s+)*(?:(?:meet|fulfil{1,2}|fit|satisfy|match)\s+(?:the\s+|these\s+|those\s+)?(?:(?:diagnostic|ADA|WHO|clinical)\s+)?(?:criteria|definition|threshold|cut-?offs?)s?\s+(?:for|of)\s+|qualify\s+as\s+)(?:an?\s+)?${EN_COND}${EN_COND_END}`),
  // "You'd be classified as prediabetic", "you would be considered diabetic", "you'd be diagnosed with diabetes".
  rule("diagnosis_classified_en", String.raw`${EN_NOT_IF}${B}you(?:'d|\s+would|\s+will|\s+are|'re)\s+(?:(?:likely|probably|generally|usually)\s+)?(?:be\s+)?(?:(?:classified|categori[sz]ed|labell?ed|regarded|considered|counted|diagnosed)\s+(?:as\s+(?:being\s+)?|with\s+|to\s+be\s+)?|(?:seen|treated)\s+as\s+)(?:an?\s+)?${EN_COND}${EN_COND_END}`),
  // Ruling it out is a diagnosis too: "you don't have diabetes".
  rule("diagnosis_negative_en", String.raw`${EN_NOT_IF}${B}you\s+(?:most\s+likely\s+|probably\s+|definitely\s+|clearly\s+)?(?:do\s+not|don't|are\s+not|aren't)\s+(?:have\s+)?(?:an?\s+)?${EN_COND}${E}`),
];

// ── tr ──────────────────────────────────────────────────────────────────────
// Object + verb order; the object must carry a case suffix ("dozunuzu",
// "insülini", "metformine") so "insülin kesin bir..." (adjective "kesin") passes.
// Negative imperatives ("bırakmayın", "atlamayın") use other suffixes and pass.
const TR_OBJ = String.raw`(?:insülin|doz|bazal|bolus|ilaç|ilac|metformin|hap|tablet)\p{L}+`;
const TR_STEM = String.raw`(?:artır|arttır|azalt|düşür|yükselt|kes|bırak|atla|başla|durdur|ikiye\s+katla|yarıya\s+indir|ayarla|değiştir)`;
const TR_VERB = String.raw`${TR_STEM}(?:ın|in|un|ün|yın|yin|abilirsiniz|ebilirsiniz|yabilirsiniz|yebilirsiniz|malısınız|melisiniz|manız\s+gerek\p{L}*|meniz\s+gerek\p{L}*|manızı\s+öneri\p{L}*|menizi\s+öneri\p{L}*)`;
// Endings that cannot be mistaken for an adjective ("kesin"), so a word or two may sit between object and verb.
const TR_MODAL_END = String.raw`(?:abilirsiniz|ebilirsiniz|yabilirsiniz|yebilirsiniz|malısınız|melisiniz|(?:manız|meniz)(?:da|de)?\s+(?:iyi|uygun|doğru|faydalı|yararlı|mantıklı|mümkün|yeterli)(?:\s+olur|\s+olabilir)?|(?:manız|meniz)(?:da|de)?\s+(?:sorun|sakınca|mahzur)\s+(?:değil|yok|olmaz|teşkil\s+etmez)|(?:mak|mek)\s+(?:sakınca|sorun|mahzur)\s+(?:yok|değil)|(?:mak|mek)\s+(?:iyi|uygun|doğru|faydalı|yararlı|mantıklı)\s+olur|(?:mayı|meyi)\s+(?:deneyebilir|düşünebilir|tercih\s+edebilir)siniz|(?:sanız|seniz)\s+(?:daha\s+)?iyi\s+olur)`;
// The dose someone already logged ("kaydettiğiniz dozu", "günlükten") is app help, not a dose change.
const TR_LOGGED_BEFORE = String.raw`(?<!(?:kaydet|girdi|ekledi|yazd[ıi]|kay[ıi]tl[ıi]|saklan)\p{L}*\s)`;
const TR_LOGGED_WORD = String.raw`(?:g[üu]nl[üu]k|kay[ıi]t|girdi|giri[şs])\p{L}*`;
// The user's own figures: "değerleriniz", "ölçümleriniz", "HbA1c'niz".
const TR_DATA = String.raw`(?:ölçümleriniz|değerleriniz|sonuçlarınız|kan\s+şekeriniz|şekeriniz|kayıtlarınız|okumalarınız|seviyeleriniz|(?:HbA1c|A1C)(?:'?\p{L}+)?)`;
const TR_NUMWORD = String.raw`(?:on\s+(?:bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz)|yirmi(?:\s+(?:bir|iki|üç|dört|beş))?|otuz|kırk|elli|birkaç|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on)`;

const TR: Rule[] = [
  // "4 ünite yapın", "4-6 ünite insülin", "iki ünite daha".
  rule("dose_units_tr", String.raw`${B}(?:${AMOUNT}|${TR_NUMWORD})\s*(?:ünite\p{L}*|IU)${E}`),
  // "4 birim insülin"; bare "birim" is too generic (measurement units).
  rule("dose_units_birim_tr", String.raw`${B}${AMOUNT}\s*birim\s+(?:\p{L}+\s+)?insülin`),
  // "dozunuzu artırın", "insülininizi bırakın", "metformine başlayın", "bazalı azaltmalısınız".
  rule("dose_change_tr", String.raw`${TR_LOGGED_BEFORE}${B}${TR_OBJ}\s+${TR_VERB}${E}(?!\s+olarak)`),
  // "Bazal insülininizi biraz düşürmeniz iyi olur", "metforminizi artık bırakabilirsiniz", "bırakmanızda sakınca yok".
  rule("dose_modal_tr", String.raw`${TR_LOGGED_BEFORE}${B}${TR_OBJ}\s+(?:(?!${TR_LOGGED_WORD})\p{L}+\s+){0,2}${TR_STEM}${TR_MODAL_END}${E}`),
  // Second person only: "diyabetiniz olabilir", "prediyabet olabilirsiniz",
  // "muhtemelen diyabetsiniz", "diyabetiniz var", "ölçümleriniz diyabet olduğunuzu
  // gösteriyor". "Gebelikte diyabet olabilir" (education) and the question
  // "diyabet olabilir miyim?" / "diyabetiniz var mı?" pass.
  rule("diagnosis_tr", String.raw`(?:(?:büyük\s+(?:ihtimalle|olasılıkla)|muhtemelen|kesinlikle|açıkça|görünüşe\s+göre)\s+(?:tip\s*[12]\s+|gebelik\s+)?(?:pre)?diyabet(?:siniz|iniz|lisiniz|li\s+olabilirsiniz)|(?:pre)?diyabet(?:iniz\s+(?:olabilir|var)|(?:li)?\s*olabilirsiniz|(?:li)?\s*olduğunuz\s+(?:anlaşılıyor|görülüyor|görünüyor|gösteriyor)|(?:li)?siniz)|(?:gizli\s+şeker|insülin\s+direnc)iniz\s+(?:olabilir|var)|(?:şeker|(?:pre)?diyabet)\s+hastası(?:\s+olabilirsiniz|sınız)|(?:ölçümleriniz|değerleriniz|sonuçlarınız|kan\s+şekeriniz|şekeriniz|kayıtlarınız|okumalarınız)[^.!?\n]{0,40}?(?:pre)?diyabet(?:li)?\s*olduğunuz(?:u|dan)?\s+(?:gösteriyor|işaret\s+ediyor|düşündürüyor|belirtiyor|ortaya\s+koyuyor|doğruluyor))(?!\s*m[iıuü]${E})${E}`),
  // "Açlık değerleriniz prediyabet aralığında", "Diyabet aralığındasınız": the user's own figures placed in a range.
  rule("diagnosis_range_tr", String.raw`(?:${B}${TR_DATA}\s+(?:\p{L}+\s+){0,3}?(?:pre)?diyabet\s+(?:aralığında|aralığına|aralığının\s+içinde|düzeyinde|seviyesinde|bölgesinde|sınırında|sınırına)|${B}(?:pre)?diyabet\s+(?:aralığında|düzeyinde|seviyesinde|bölgesinde|sınırında)(?:sınız|siniz))(?!\s*m[iıuü]${E})`),
];

// ── de (Sie) ────────────────────────────────────────────────────────────────
const DE_OBJ = String.raw`(?:Insulin(?:dosis|menge|gabe)?|Dosis|Basalrate|Basaldosis|Basalinsulin|Bolus(?:insulin|menge)?|Korrekturdosis|Medikament\p{L}*|Medikation|Metformin|Tabletten)`;
const DE_DET = String.raw`(?:(?:Ihr\p{L}*|die|das|den|der|dem)\s+)?(?:\p{L}+\s+)?`;
const DE_NOT = String.raw`(?!\s+(?:nicht|nie|niemals|keinesfalls|auf\s+keinen\s+Fall))`;
const DE_COND = String.raw`(?:(?:Typ-?\s*[12]-?\s*|Schwangerschafts-?)?(?:Pr[äa]-?)?diabet(?:es|iker\p{L}*)|Insulinresistenz|Ketoazidose)`;
const DE_MODAL = String.raw`(?:sollten|sollen|müssen|können|könnten|dürfen|dürften|brauchen)`;
const DE_NUMWORD = String.raw`(?:zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|dreizehn|vierzehn|fünfzehn|sechzehn|siebzehn|achtzehn|neunzehn|zwanzig|(?:ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)undzwanzig|dreißig|dreissig|ein\s+paar|einige)`;
// A filler between "Sie können" and the object ("Sie können ruhig Ihr Metformin absetzen").
const DE_FILLER = String.raw`(?:(?:ruhig|ruhigen\s+Gewissens|gern|gerne|getrost|problemlos|bedenkenlos|auch|einfach|jederzeit|ohne\s+Weiteres|ohne\s+Bedenken)\s+)*`;
// The dose someone already logged ("Ihre gespeicherte Dosis", "Dosis im Tagebuch") is app help, not a dose change.
const DE_LOGGED_BEFORE = String.raw`(?<!(?:gespeichert|eingetragen|erfasst|protokolliert|dokumentiert|notiert|eingegeben)\p{L}*\s)`;
const DE_LOGGED_AFTER = String.raw`(?!\s+(?:(?:im|in\s+(?:dem|der|einem|Ihrem|Ihrer)|aus\s+(?:dem|Ihrem))\s+(?:Tagebuch|Journal|Eintrag|Protokoll|Logbuch)|nachtr[äa]glich|eingetragen|gespeichert|erfasst))`;
// Only the editing verb takes the exclusion above plus the relative clause: "Ändern Sie die Dosis, die Sie eingetragen haben" is
// app help, while "Passen Sie Ihre Dosis nachträglich an" and "Reduzieren Sie die Dosis, die Sie eingetragen haben" stay dose
// instructions. There is no space before the comma, so the clause is a lookahead of its own.
const DE_EDIT_LOGGED = String.raw`${DE_LOGGED_AFTER}(?!,\s+die\s+Sie\s+(?:eingetragen|gespeichert|erfasst|protokolliert|notiert|eingegeben))`;
const DE_ADJ_OBJ = String.raw`\s+Sie\s+(?:Ihr\p{L}*|die)\s+(?:Insulin)?(?:dosis|Basalrate|Bolusmenge)${E}`;
// A journal word right before the modal ("Im Tagebuch können Sie ..."); one further back, or past a comma, does not count.
const DE_LOG_CONTEXT = String.raw`(?<!(?:Tagebuch|Eintrag|Journal|Protokoll|Logbuch)\p{L}*[^.!?\n,;:]{0,12})`;
// Words that end the gap between object and verb: a negation, the journal, or the care team in charge ("nur
// gemeinsam mit Ihrem Arzt anpassen").
const DE_GAP_STOP = String.raw`nicht|nie|kein|Eintrag|Tagebuch|Journal|Protokoll|Logbuch|nur\s+(?:gemeinsam|zusammen|nach|in|mit|von|durch|Ihr)|(?:gemeinsam|zusammen)\s+mit|in\s+Absprache|nach\s+(?:R[üu]cksprache|Absprache)|mit\s+Ihrer?\s+(?:[ÄA]rztin|Arzt|Diabetes|Behandlungs|Hausarzt)`;
const DE_INF = String.raw`(?:abzusetzen|auszulassen|wegzulassen|aufzuhören|abzubrechen|zu\s+(?:erhöhen|reduzieren|verringern|senken|steigern|verdoppeln|halbieren|pausieren|stoppen|beenden|überspringen|ändern|anpassen|beginnen|starten))`;

const DE: Rule[] = [
  // "4 Einheiten", "2-3 IE", "4 Einh.", "4 E Insulin"; "Kohlenhydrateinheiten" is one word and has no number
  // right before "Einheiten".
  rule("dose_units_de", String.raw`${B}${AMOUNT}\s*(?:Einheiten|Einheit|Einh\.?|IE|I\.\s?E\.|E(?=\s+(?:\p{L}+\s+){0,2}Insulin))${E}`),
  // "zwanzig Einheiten Insulin", "zwanzig Einheiten schnell wirkendes Insulin", "zwanzig Einheiten vor dem Essen".
  rule("dose_words_de", String.raw`${B}(?:${DE_NUMWORD}\s+(?:(?:zusätzliche|weitere|mehr)\s+)?Einheiten|eine\s+Einheit)\s+(?:(?:\p{L}+\s+){0,3}Insulin|(?:vor|nach|zu|zum|zur|bei|am|pro|je)\s+(?:dem\s+|den\s+|der\s+|jeder\s+|jedem\s+|jede\s+)?(?:Essen|Mahlzeiten?|Frühstück|Mittagessen|Abendessen|Schlafengehen|Nacht|Abend|Morgen|Snacks?|Zwischenmahlzeit))`),
  // "Erhöhen Sie Ihre Insulindosis", unless followed by "nicht".
  rule("dose_change_de", String.raw`${B}(?:Erhöhen|Reduzieren|Verringern|Senken|Steigern|Verdoppeln|Halbieren|Stoppen|Beenden|Pausieren|Überspringen)\s+Sie\s+${DE_DET}${DE_OBJ}${E}${DE_NOT}`),
  // Separable verbs: "Setzen Sie Ihr Metformin ab" ("... nicht ab" passes), "Lassen Sie die Dosis weg", "Beginnen Sie mit Metformin".
  rule("dose_stop_de", String.raw`${B}(?:Setzen\s+Sie\s+${DE_DET}${DE_OBJ}\s+ab|Lassen\s+Sie\s+${DE_DET}${DE_OBJ}\s+(?:weg|aus)|(?:Hören|Fangen)\s+Sie\s+mit\s+${DE_DET}${DE_OBJ}\s+(?:auf|an)|Beginnen\s+Sie\s+mit\s+${DE_DET}${DE_OBJ})${E}`),
  rule("dose_adjust_de", String.raw`${B}(?:Passen${DE_ADJ_OBJ}|Ändern${DE_ADJ_OBJ}${DE_EDIT_LOGGED})`),
  // "Sie sollten Ihre Dosis erhöhen", "Ja, Sie können Ihr Metformin absetzen", "Sie könnten Ihre Insulindosis etwas reduzieren";
  // a "nicht/nie/kein" in between excludes it. "Wenn Sie möchten, können Sie ..." is the inverted order.
  rule("dose_modal_de", String.raw`${B}(?:${DE_MODAL}\s+Sie|Sie\s+${DE_MODAL})${DE_LOG_CONTEXT}\s+${DE_FILLER}${DE_DET}${DE_LOGGED_BEFORE}${DE_OBJ}${DE_LOGGED_AFTER}\s+(?:(?!${DE_GAP_STOP})[^.!?\n]){0,60}?(?:erhöhen|reduzieren|verringern|senken|steigern|absetzen|weglassen|auslassen|verdoppeln|halbieren|anpassen|ändern|pausieren|stoppen|beenden|aufhören|abbrechen|beginnen|anfangen|starten|überspringen)${E}`),
  // "Es ist in Ordnung, Ihr Metformin abzusetzen", "Es spricht nichts dagegen, die Dosis zu reduzieren".
  rule("dose_fine_to_de", String.raw`${B}(?:(?:es|das)\s+(?:ist|wäre)\s+(?:völlig\s+|durchaus\s+|ganz\s+|vollkommen\s+|grundsätzlich\s+)?(?:in\s+Ordnung|okay|ok|unbedenklich|kein\s+Problem|möglich|erlaubt|vertretbar|sinnvoll|ratsam|empfehlenswert|gut|besser|akzeptabel|sicher)|(?:es\s+)?spricht\s+(?:nichts|wenig)\s+dagegen)\s*,?\s+(?:mit\s+)?${DE_DET}${DE_LOGGED_BEFORE}${DE_OBJ}${DE_LOGGED_AFTER}\s+(?:\p{L}+\s+){0,2}${DE_INF}${E}`),
  // "Sie haben wahrscheinlich Diabetes", "Ihre Werte zeigen, dass Sie Prädiabetes haben". "Das bedeutet nicht, dass Sie..." passes.
  rule("diagnosis_de", String.raw`(?:Sie\s+(?:haben|sind)\s+(?:wahrscheinlich|vermutlich|sicher(?:lich)?|eindeutig|offenbar|offensichtlich|wohl)\s+(?:einen\s+|eine\s+)?|(?:deutet|weist)\s+darauf\s+hin,?\s+dass\s+Sie\s+(?:\p{L}+\s+){0,2}|(?:bedeutet|bedeuten|zeigt|zeigen|heißt),?\s+dass\s+Sie\s+(?:\p{L}+\s+){0,2}|(?:spricht|sprechen)\s+für\s+(?:einen\s+|eine\s+)?)${DE_COND}`),
  // "Das deutet auf einen Prädiabetes hin", "Ihre Werte deuten auf Diabetes hin". A symptom as subject
  // ("Starker Durst deutet auf Diabetes hin") is education and passes.
  rule("diagnosis_hint_de", String.raw`${B}(?:das|dies|dieses|es|ihre\s+\p{L}+|diese\s+\p{L}+|solche\s+werte)\s+(?:\p{L}+\s+){0,2}(?:deutet|deuten|weist|weisen)\s+(?:\p{L}+\s+){0,3}auf\s+(?:einen\s+|eine\s+)?${DE_COND}`),
  // "Sie haben Diabetes." / "Sie sind Diabetiker." as a sentence of its own or after a comma, and the inverted
  // "Mit diesen Werten haben Sie Diabetes."; "Wenn Sie Diabetes haben" and the question "Haben Sie Diabetes?" pass.
  rule("diagnosis_bare_de", String.raw`(?:(?:^\s*|[.!?]\s+|[,;:]\s*)Sie\s+(?:haben|leiden\s+an|leiden\s+unter|sind)\s+|(?<=[\p{L}\p{N}],?\s+)(?:haben|sind)\s+Sie\s+(?:\p{L}+\s+){0,2})(?:einen\s+|eine\s+)?${DE_COND}(?![\p{L}\p{N}_-])(?![^.!?\n]{0,25}\?)`),
  // "Ihre Werte liegen im Diabetesbereich", "Ihre Messwerte befinden sich im Bereich von Prädiabetes".
  rule("diagnosis_range_de", String.raw`${B}Ihre\s+(?:\p{L}+\s+){0,3}?\p{L}*(?:Werte?|Ergebnisse?|Zahlen|Messungen)\s+(?:\p{L}+\s+){0,3}?(?:liegen|liegt|befinden\s+sich|befindet\s+sich|sind|ist|fallen|fällt|bewegen\s+sich)\s+(?:\p{L}+\s+){0,3}?(?:im|in\s+den|in\s+dem|innerhalb\s+des)\s+(?:(?:Pr[äa]-?)?diabetes[-\s]?(?:bereich|zone|grenzbereich)|diabetischen\s+(?:Bereich|Zone)|Bereich\s+(?:des|von|eines)\s+(?:Pr[äa]-?)?diabetes)`),
];

// ── fr (vous) ───────────────────────────────────────────────────────────────
const FR_OBJ = String.raw`(?:insuline|doses?|posologie|basale|bolus|médicaments?|traitement|metformine|comprimés)`;
const FR_DET = String.raw`(?:votre|vos|la|le|les|l'|du|de\s+la)\s*(?:\p{L}+\s+)?`;
// "N'arrêtez pas votre insuline", "Ne diminuez pas..." are the opposite advice.
const FR_NOT = String.raw`(?<!n')(?<!ne\s)`;
const FR_VERB = String.raw`(?:augmenter|diminuer|réduire|baisser|doubler|arrêter|stopper|sauter|interrompre|suspendre|commencer|ajuster|modifier|changer|adapter|cesser|abandonner|supprimer|omettre)`;
const FR_NUMWORD = String.raw`(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix-sept|dix-huit|dix-neuf|vingt(?:[-\s](?:et[-\s])?(?:un|deux|trois|quatre|cinq|six|sept|huit|neuf))?|trente)`;
// The dose someone already logged ("votre dose d'insuline enregistrée", "dans le journal") is app help, not a dose change.
const FR_NOT_LOGGED = String.raw`(?!(?:\s+d'insuline|\s+de\s+l'insuline)?\s+(?:enregistr|saisi|not[ée]|consign|sauvegard)\p{L}*|\s+(?:dans|du)\s+(?:le\s+)?(?:journal|carnet|historique))`;
// Only the editing verbs take the relative clause: "Modifiez la dose que vous avez enregistrée" is app help, while "Réduisez la
// dose que vous avez enregistrée" and "Ajustez ..." stay dose instructions.
const FR_EDIT_LOGGED = String.raw`(?!\s+que\s+vous\s+avez\s+(?:enregistr|saisi|not|consign)\p{L}*)`;
const FR_ADJ_OBJ = String.raw`\s+(?:votre|vos|la|le|les)\s+(?:doses?|posologie|débit\s+basal)${E}${FR_NOT_LOGGED}`;

const FR: Rule[] = [
  rule("dose_units_fr", String.raw`${B}(?:${AMOUNT}|${FR_NUMWORD})\s*(?:unités?|UI)${E}(?!\s*:)(?!\s+(?:de\s+mesure|glucidiques?|de\s+glucides|de\s+pain))`),
  // "une unité d'insuline" only: bare "une unité" is too generic.
  rule("dose_units_one_fr", String.raw`${B}(?:un|une)\s+unité\s+(?:d'|de\s+)insuline`),
  rule("dose_change_fr", String.raw`${FR_NOT}${B}(?:Augmentez|Diminuez|Réduisez|Baissez|Doublez|Arrêtez|Stoppez|Sautez|Interrompez|Suspendez|Commencez|Débutez|Cessez)\s+(?:(?:de|à)\s+prendre\s+)?${FR_DET}${FR_OBJ}${E}${FR_NOT_LOGGED}`),
  rule("dose_adjust_fr", String.raw`${FR_NOT}${B}(?:(?:Ajustez|Adaptez)${FR_ADJ_OBJ}|(?:Modifiez|Changez)${FR_ADJ_OBJ}${FR_EDIT_LOGGED})`),
  // "vous devriez arrêter votre metformine", "oui, vous pouvez arrêter votre metformine", "vous êtes libre
  // d'arrêter votre metformine", "n'hésitez pas à diminuer votre dose"; "vous ne devriez pas..." has "ne" in
  // between and passes.
  rule("dose_modal_fr", String.raw`${B}(?:vous\s+(?:(?:devriez|devez|devrez|pourriez|pouvez|pourrez)\s+(?:(?:aussi|simplement|sans\s+problème|tout\s+à\s+fait|éventuellement|très\s+bien)\s+)*|(?:êtes|serez)\s+(?:tout\s+à\s+fait\s+|parfaitement\s+)?libres?\s+(?:de\s+|d'))|n'hésitez\s+pas\s+à\s+|rien\s+ne\s+vous\s+empêche\s+de\s+)${FR_VERB}\s+(?:(?:de|à)\s+prendre\s+)?${FR_DET}${FR_OBJ}${E}${FR_NOT_LOGGED}`),
  rule("dose_fine_to_fr", String.raw`${B}(?:il|c')\s*(?:est|serait)\s+(?:tout\s+à\s+fait\s+|parfaitement\s+)?(?:possible|préférable|conseillé|recommandé|permis|acceptable|raisonnable|sûr|bon|normal)\s+(?:de\s+|d')${FR_VERB}\s+(?:(?:de|à)\s+prendre\s+)?${FR_DET}${FR_OBJ}${E}${FR_NOT_LOGGED}`),
  rule("diagnosis_fr", String.raw`(?:${B}vous\s+(?:avez|êtes)\s+(?:probablement|sûrement|certainement|clairement|vraisemblablement)\s+|(?:cela|ceci|vos\s+(?:valeurs|résultats|glycémies|mesures))\s+(?:signifie|signifient|montre|montrent|indique|indiquent|confirme|confirment|suggère|suggèrent)\s+que\s+vous\s+(?:avez|êtes|pourriez\s+avoir|pourriez\s+être)\s+|(?:^\s*|[.!?]\s+|[,;:]\s*)vous\s+(?:avez|êtes|souffrez\s+d')\s*|${B}il\s+semble\s+que\s+vous\s+(?:ayez|avez|soyez)\s+)(?:un\s+|une\s+|du\s+|de\s+l')?(?:pr[eé]-?)?diab[eèé]t\p{L}*`),
  // "Vos valeurs se situent dans la plage du diabète", "vos résultats sont dans la zone de prédiabète".
  rule("diagnosis_range_fr", String.raw`${B}vos\s+(?:\p{L}+\s+){0,3}?(?:valeurs|résultats|mesures|glycémies|chiffres|taux)\s+(?:\p{L}+\s+){0,4}?(?:dans|entrent\s+dans|tombent\s+dans|relèvent\s+de)\s+(?:(?:la|le|l')\s*)?(?:plage|zone|fourchette|catégorie|intervalle|domaine|territoire)\s+(?:du\s+|de\s+|d'|des\s+)?(?:pr[eé]-?)?diab[eèé]t\p{L}*`),
];

// ── es (usted) ──────────────────────────────────────────────────────────────
const ES_OBJ = String.raw`(?:insulina|dosis|basal|bolo|medicamentos?|medicación|metformina|pastillas|tratamiento)`;
const ES_DET = String.raw`(?:su|sus|la|el|los|las)\s+(?:\p{L}+\s+)?`;
// "puede", "podría" are also third person ("su médico puede ajustar la dosis"), so the verb
// has to start a sentence or follow "sí,", "usted" or "que" to be read as addressed to the user.
const ES_LEAD = String.raw`(?:^\s*|[.!?¿¡:;]\s*|${B}(?:sí|si|claro|bueno|entonces|además|también|usted|que|y|pero|así),?\s+)`;
const ES_VERB = String.raw`(?:aumentar|disminuir|reducir|bajar|subir|duplicar|dejar\s+de\s+(?:tomar|usar|ponerse|inyectarse)|suspender|omitir|saltarse|interrumpir|(?:empezar|comenzar)\s+a\s+(?:tomar|usar)|ajustar|modificar|cambiar|parar|retirar)`;
const ES_NUMWORD = String.raw`(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veinti(?:uno|dós|dos|trés|tres|cuatro|cinco|seis|siete|ocho|nueve)|treinta)`;
// The dose someone already logged ("su dosis registrada", "en el diario") is app help, not a dose change.
const ES_NOT_LOGGED = String.raw`(?!\s+(?:registrad|guardad|anotad|introducid|ingresad|apuntad)\p{L}*|\s+(?:en|del?)\s+(?:el\s+)?(?:diario|registro|historial)|\s+que\s+(?:registr[óo]|guard[óo]|anot[óo]|introdujo|ingres[óo]))`;

const ES: Rule[] = [
  // "unidades" also counts food items ("2 unidades de pan"): "de X" must be insulina.
  rule("dose_units_es", String.raw`${B}(?:${AMOUNT}|${ES_NUMWORD})\s*(?:unidades?|UI)${E}(?!\s*:)(?!\s+de\s+(?!insulina))`),
  rule("dose_units_one_es", String.raw`${B}(?:una|un|uno)\s+unidad\s+de\s+insulina`),
  // "No deje de tomar su insulina" is the opposite advice.
  rule("dose_change_es", String.raw`(?<!no\s)${B}(?:Aumente|Disminuya|Reduzca|Baje|Suba|Duplique|Deje\s+de\s+(?:tomar|usar|ponerse|inyectarse)|Suspenda|Omita|Sáltese|Interrumpa|(?:Empiece|Comience)\s+a\s+(?:tomar|usar))\s+${ES_DET}${ES_OBJ}${E}${ES_NOT_LOGGED}`),
  rule("dose_adjust_es", String.raw`(?<!no\s)${B}(?:Ajuste|Modifique|Cambie)\s+(?:su|sus|la|el)\s+(?:dosis|bolo|basal)${E}${ES_NOT_LOGGED}`),
  rule("dose_modal_es", String.raw`(?<!no\s)${B}(?:debería|debe|tiene\s+que)\s+(?:aumentar|disminuir|reducir|bajar|subir|duplicar|dejar\s+de\s+(?:tomar|usar|ponerse|inyectarse)|suspender|omitir|saltarse|interrumpir|(?:empezar|comenzar)\s+a\s+(?:tomar|usar)|ajustar|modificar|cambiar)\s+${ES_DET}${ES_OBJ}${E}${ES_NOT_LOGGED}`),
  // "Sí, puede dejar de tomar su metformina", "Usted podría reducir su dosis".
  rule("dose_permit_es", String.raw`${ES_LEAD}(?:puede|podría|podrá|le\s+conviene|conviene|es\s+posible|se\s+puede)\s+(?:(?:también|simplemente|sin\s+problema|tranquilamente|incluso)\s+)*${ES_VERB}\s+${ES_DET}${ES_OBJ}${E}${ES_NOT_LOGGED}`),
  // "Está bien suspender su insulina", "No hay problema en dejar de tomar su metformina".
  rule("dose_fine_to_es", String.raw`${B}(?:(?:está|esta|es)\s+(?:perfectamente\s+|totalmente\s+|completamente\s+)?(?:bien|correcto|seguro|aceptable|razonable|recomendable|conveniente|posible|normal)|no\s+hay\s+(?:ningún\s+)?(?:problema|inconveniente|riesgo)|no\s+pasa\s+nada)\s+(?:(?:en|con|por)\s+)?(?:(?:también|simplemente|incluso|tranquilamente)\s+)?${ES_VERB}\s+${ES_DET}${ES_OBJ}${E}${ES_NOT_LOGGED}`),
  rule("diagnosis_es", String.raw`(?:(?:probablemente|seguramente|claramente|ciertamente|sin\s+duda)\s+(?:usted\s+)?(?:tiene|es|padece)\s+|(?:esto|sus\s+(?:valores|resultados|lecturas|cifras|mediciones|niveles))\s+(?:significa|significan|muestra|muestran|indica|indican|confirma|confirman|sugiere|sugieren)\s+que\s+(?:usted\s+)?(?:tiene|es|podría\s+tener|padece)\s+|parece\s+que\s+(?:usted\s+)?(?:tiene|padece|sufre\s+de|podría\s+tener)\s+|(?:^\s*|[.!?]\s+|[,;:]\s*)(?:usted\s+)?(?:tiene|padece|sufre\s+de)\s+)(?:una\s+|un\s+)?(?:pre)?diab[eé]t\p{L}*`),
  // "Sus valores están en el rango diabético", "sus resultados entran en la zona de prediabetes".
  rule("diagnosis_range_es", String.raw`${B}(?:sus\s+(?:\p{L}+\s+){0,3}?(?:valores|resultados|lecturas|cifras|mediciones|niveles|números)|usted)\s+(?:\p{L}+\s+){0,4}?(?:en|dentro\s+de|entran\s+en|caen\s+en)\s+(?:(?:el|la|un|una)\s+)?(?:rango|zona|intervalo|categoría|franja|territorio)\s+(?:de\s+|del\s+)?(?:pre)?diab[eé]t\p{L}*`),
];

// ── it (Lei) ────────────────────────────────────────────────────────────────
const IT_OBJ = String.raw`(?:insulina|dosi|dose|basale|bolo|farmac[oi]|terapia|metformina|compresse)`;
const IT_DET = String.raw`(?:(?:la|il|lo|le|i|gli|l')\s*)?(?:(?:Sua|Suo|Sue|Suoi)\s+)?(?:\p{L}+\s+)?`;
// "può", "potrebbe" are also third person ("il medico può modificare la dose"): see ES_LEAD.
const IT_LEAD = String.raw`(?:^\s*|[.!?:;]\s*|${B}(?:sì|si|certo|certamente|allora|inoltre|anche|lei|che|e|ma|quindi),?\s+)`;
const IT_VERB = String.raw`(?:aumentare|diminuire|ridurre|abbassare|raddoppiare|dimezzare|sospendere|interrompere|saltare|smettere\s+di\s+(?:prendere|usare)|(?:iniziare|cominciare)\s+a\s+(?:prendere|usare)|modificare|regolare|cambiare|ritoccare)`;
const IT_NUMWORD = String.raw`(?:due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|trenta)`;
// The dose someone already logged ("la dose registrata", "nel diario") is app help, not a dose change.
const IT_NOT_LOGGED = String.raw`(?!\s+(?:registrat|salvat|annotat|inserit|immess)\p{L}*|\s+(?:nel|del|dal|sul)\s+(?:diario|registro|storico)|\s+che\s+(?:ha\s+|Lei\s+ha\s+)?(?:registrato|salvato|annotato|inserito))`;

const IT: Rule[] = [
  rule("dose_units_it", String.raw`${B}(?:${AMOUNT}|${IT_NUMWORD})\s*(?:unità|UI)${E}(?!\s*:)(?!\s+di\s+(?!insulina))`),
  rule("dose_units_one_it", String.raw`${B}(?:una|un)\s+unità\s+di\s+insulina`),
  rule("dose_change_it", String.raw`(?<!non\s)${B}(?:Aumenti|Diminuisca|Riduca|Abbassi|Raddoppi|Dimezzi|Sospenda|Interrompa|Salti|Smetta\s+di\s+(?:prendere|usare)|(?:Inizi|Cominci)\s+a\s+(?:prendere|usare))\s+${IT_DET}${IT_OBJ}${E}${IT_NOT_LOGGED}`),
  rule("dose_adjust_it", String.raw`(?<!non\s)${B}(?:Modifichi|Cambi|Regoli|Adegui)\s+(?:la|il|le|i)\s+(?:(?:Sua|Suo|Sue|Suoi)\s+)?(?:dose|dosi|basale|bolo)${E}${IT_NOT_LOGGED}`),
  rule("dose_modal_it", String.raw`(?<!non\s)${B}(?:dovrebbe|deve)\s+(?:aumentare|diminuire|ridurre|abbassare|raddoppiare|dimezzare|sospendere|interrompere|saltare|smettere\s+di\s+(?:prendere|usare)|(?:iniziare|cominciare)\s+a\s+(?:prendere|usare)|modificare|regolare)\s+${IT_DET}${IT_OBJ}${E}${IT_NOT_LOGGED}`),
  // "Sì, può smettere di prendere la metformina", "Lei potrebbe ridurre la dose".
  rule("dose_permit_it", String.raw`${IT_LEAD}(?:può|puo'?|potrebbe|potrà|conviene|le\s+conviene|è\s+possibile)\s+(?:(?:anche|semplicemente|tranquillamente|senza\s+problemi)\s+)*${IT_VERB}\s+${IT_DET}${IT_OBJ}${E}${IT_NOT_LOGGED}`),
  // "Va bene sospendere la metformina", "Non c'è problema a ridurre la dose", "Lei è libero di sospendere la terapia".
  rule("dose_fine_to_it", String.raw`${B}(?:va\s+bene|(?:è|e')\s+(?:perfettamente\s+|assolutamente\s+)?(?:ok|giusto|sicuro|accettabile|ragionevole|possibile|opportuno|consigliabile|normale)|non\s+c'è\s+(?:alcun\s+|nessun\s+)?(?:problema|rischio)|nessun\s+problema|(?:Lei\s+)?è\s+libero)\s+(?:(?:anche|pure|tranquillamente|semplicemente)\s+)?(?:(?:a|di|nel|nell')\s*)?${IT_VERB}\s+${IT_DET}${IT_OBJ}${E}${IT_NOT_LOGGED}`),
  rule("diagnosis_it", String.raw`(?:(?:probabilmente|sicuramente|certamente|chiaramente)\s+(?:Lei\s+)?(?:ha|è)\s+|(?:questo|ciò|i\s+Suoi\s+valori)\s+(?:significa|significano|indica|indicano|conferma|confermano|mostra|mostrano|suggerisce|suggeriscono)\s+che\s+(?:Lei\s+)?(?:ha|è|potrebbe\s+avere|potrebbe\s+essere)\s+|sembra\s+che\s+(?:Lei\s+)?(?:abbia|ha|soffra\s+di|possa\s+avere)\s+|(?:^\s*|[.!?]\s+|[,;:]\s*)(?:Lei\s+)?(?:ha|soffre\s+di)\s+)(?:il\s+|un\s+|una\s+|del\s+)?(?:pre)?diabet\p{L}*`),
  // "I Suoi valori rientrano nell'intervallo del diabete", "i Suoi valori sono nella fascia prediabetica".
  rule("diagnosis_range_it", String.raw`${B}Suoi\s+(?:\p{L}+\s+){0,3}?(?:valori|risultati|misurazioni|letture|numeri|livelli)\s+(?:\p{L}+\s+){0,4}?(?:nell'|nel\s+|nella\s+|nello\s+|in\s+(?:un\s+|una\s+)?)(?:\p{L}+\s+)?(?:intervallo|range|fascia|zona|categoria)\s+(?:del\s+|di\s+|d')?(?:pre)?diabet\p{L}*`),
];

// ── pt (você, pt-BR) ────────────────────────────────────────────────────────
const PT_OBJ = String.raw`(?:insulina|doses?|basal|bolus|medicamentos?|medicação|remédios?|metformina|comprimidos)`;
const PT_DET = String.raw`(?:(?:sua|seu|suas|seus|a|o|as|os)\s+){1,2}(?:\p{L}+\s+)?`;
// "pode", "poderia" are also third person ("o médico pode ajustar a dose"): see ES_LEAD.
const PT_LEAD = String.raw`(?:^\s*|[.!?:;]\s*|${B}(?:sim|claro|então|também|você|que|e|mas|assim),?\s+)`;
const PT_VERB = String.raw`(?:aumentar|diminuir|reduzir|abaixar|dobrar|suspender|pular|interromper|parar\s+de\s+(?:tomar|usar|aplicar)|começar\s+a\s+(?:tomar|usar|aplicar)|ajustar|alterar|mudar|retirar)`;
const PT_NUMWORD = String.raw`(?:duas|dois|três|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)`;
// The dose someone already logged ("a dose registrada", "no diário") is app help, not a dose change.
const PT_NOT_LOGGED = String.raw`(?!\s+(?:registrad|salv|anotad|inserid)\p{L}*|\s+(?:no|do|em)\s+(?:di[áa]rio|registro|hist[óo]rico)|\s+que\s+(?:voc[êe]\s+)?(?:registrou|salvou|anotou|inseriu))`;

const PT: Rule[] = [
  rule("dose_units_pt", String.raw`${B}(?:${AMOUNT}|${PT_NUMWORD})\s*(?:unidades?|UI)${E}(?!\s*:)(?!\s+de\s+(?!insulina))`),
  rule("dose_units_one_pt", String.raw`${B}(?:uma|um)\s+unidade\s+de\s+insulina`),
  rule("dose_change_pt", String.raw`(?<!não\s)${B}(?:Aumente|Diminua|Reduza|Abaixe|Dobre|Suspenda|Pule|Interrompa|Pare\s+de\s+(?:tomar|usar|aplicar)|Comece\s+a\s+(?:tomar|usar|aplicar))\s+${PT_DET}${PT_OBJ}${E}${PT_NOT_LOGGED}`),
  rule("dose_adjust_pt", String.raw`(?<!não\s)${B}(?:Ajuste|Mude|Altere)\s+(?:(?:sua|seu|a|o)\s+){1,2}(?:doses?|basal|bolus)${E}${PT_NOT_LOGGED}`),
  rule("dose_modal_pt", String.raw`(?<!não\s)${B}(?:deveria|deve|precisa)\s+(?:aumentar|diminuir|reduzir|abaixar|dobrar|suspender|pular|interromper|parar\s+de\s+(?:tomar|usar|aplicar)|começar\s+a\s+(?:tomar|usar|aplicar)|ajustar|alterar|mudar)\s+${PT_DET}${PT_OBJ}${E}${PT_NOT_LOGGED}`),
  // "Sim, você pode parar de tomar a metformina", "Você poderia reduzir a dose".
  rule("dose_permit_pt", String.raw`${PT_LEAD}(?:pode|poderia|poderá|convém)\s+(?:(?:também|simplesmente|tranquilamente|sem\s+problema)\s+)*${PT_VERB}\s+${PT_DET}${PT_OBJ}${E}${PT_NOT_LOGGED}`),
  // "Tudo bem parar de tomar a metformina", "Não há problema em reduzir a dose", "Você está livre para suspender a insulina".
  rule("dose_fine_to_pt", String.raw`${B}(?:tudo\s+bem|está\s+(?:tudo\s+)?bem|não\s+há\s+(?:nenhum\s+)?(?:problema|risco)|sem\s+problema|é\s+(?:perfeitamente\s+)?(?:seguro|ok|aceitável|razoável|possível|normal|recomendável)|você\s+(?:está|fica)\s+livre)\s+(?:(?:em|de|para)\s+)?(?:(?:também|simplesmente|tranquilamente)\s+)?${PT_VERB}\s+${PT_DET}${PT_OBJ}${E}${PT_NOT_LOGGED}`),
  rule("diagnosis_pt", String.raw`(?:(?:provavelmente|certamente|claramente|com\s+certeza)\s+(?:você\s+)?(?:tem|é|está\s+com)\s+|(?:isso|isto|seus\s+(?:valores|resultados|números))\s+(?:significa|significam|mostra|mostram|indica|indicam|confirma|confirmam|sugere|sugerem)\s+que\s+(?:você\s+)?(?:tem|é|pode\s+ter|está\s+com)\s+|parece\s+que\s+(?:você\s+)?(?:tem|está\s+com|pode\s+ter)\s+|(?:^\s*|[.!?]\s+|[,;:]\s*)(?:você\s+)?(?:tem|sofre\s+de)\s+)(?:pr[eé]-?)?diab[eé]t\p{L}*`),
  // "Seus valores estão na faixa de diabetes", "seus resultados estão na zona diabética".
  rule("diagnosis_range_pt", String.raw`${B}(?:seus|suas)\s+(?:\p{L}+\s+){0,3}?(?:valores|resultados|medições|leituras|números|níveis)\s+(?:\p{L}+\s+){0,4}?(?:na|numa|em|dentro\s+da|dentro\s+do)\s+(?:(?:a|uma)\s+)?(?:faixa|zona|categoria|região|área)\s+(?:de\s+|do\s+|da\s+)?(?:pr[eé]-?)?diab[eé]t\p{L}*`),
];

// ── ar (formal MSA) ─────────────────────────────────────────────────────────
// Diacritics are stripped before matching, so the plain spelling is enough.
const AR_OBJ = String.raw`(?:ال)?(?:جرع|[أإا]نسولين|دواء|أدوي|ميتفورمين|حبوب|أقراص)\p{L}*`;
const AR_NUMWORD = String.raw`(?:واحد(?:ة)?|اثنين|اثنتين|اثنان|اثنتان|ثلاث(?:ة)?|[أا]ربع(?:ة)?|خمس(?:ة)?|ست(?:ة)?|سبع(?:ة)?|ثمان(?:ي|ية|يه)?|تسع(?:ة)?|عشر(?:ة)?|(?:إحدى|احدى|اثنتا|اثنا)\s+عشر(?:ة)?|عشرين|عشرون|ثلاثين|ثلاثون)`;
const AR_VERB = String.raw`(?:تزيد|تقلل|تخفض|ترفع|تضاعف|توقف|تتوقف\s+عن|تترك|تبدأ|تغير|تعدل|تتخطى|زيادة|تقليل|خفض|رفع|مضاعفة|إيقاف|ايقاف|التوقف\s+عن|تغيير|تعديل)`;
// The dose someone already logged ("الجرعة المسجلة", "في السجل") is app help, not a dose change.
const AR_NOT_LOGGED = String.raw`(?!\s+(?:ال)?(?:مسجل|محفوظ|مدخل|مكتوب)\p{L}*|\s+(?:التي|الذي)\s+(?:سجلت|[أا]دخلت|حفظت|كتبت)|\s+(?:في|من)\s+(?:ال)?(?:سجل|يوميات|مفكرة))`;

const AR: Rule[] = [
  // "4 وحدات", "وحدتين"; "وحدتان لقياس السكر" (two measurement units) passes.
  rule("dose_units_ar", String.raw`(?:${B}${AMOUNT}\s*(?:وحدات|وحدة|وحده)|${B}(?:وحدتين|وحدتان))${E}(?!\s*(?::|لقياس|قياس|من\s+الكربوهيدرات|كربوهيدرات))`),
  // "ثلاث وحدات من الأنسولين": a spelled-out number needs the insulin to count.
  // Also with a dosing verb in front ("خذ عشر وحدات") or a mealtime behind ("عشر وحدات قبل العشاء").
  rule("dose_words_ar", String.raw`${B}(?:(?:خذ|خذي|احقن|احقني|تناول|استخدم|[أا]عط|[أا]ضف)\s+(?:نحو\s+|حوالي\s+)?${AR_NUMWORD}\s+(?:وحدات|وحدة)|${AR_NUMWORD}\s+(?:وحدات|وحدة)\s+(?:(?:إضافية|اضافية|زائدة)\s+)?(?:(?:من\s+)?(?:ال)?[أإا]نسولين|(?:قبل|بعد|مع|عند|في|لكل)\s+(?:ال)?(?:وجبة|عشاء|غداء|فطور|[إا]فطار|نوم|طعام|[أا]كل|ليل|مساء|صباح)))`),
  // Imperatives: "زد جرعتك", "أوقف الدواء", "قم بتقليل الأنسولين". The negative
  // "لا تتوقف" uses another verb form and passes.
  rule("dose_change_ar", String.raw`${B}(?:زد|قلل|خفض|ارفع|ضاعف|أوقف|اوقف|توقف\s+عن|اترك|ابدأ|تخط|تجاوز|قم\s+ب(?:زيادة|تقليل|خفض|رفع|مضاعفة|إيقاف|ايقاف|تغيير|تعديل))\s+(?:(?:ب|في\s+)?(?:تناول|أخذ)\s+)?${AR_OBJ}${E}${AR_NOT_LOGGED}`),
  rule("dose_adjust_ar", String.raw`${B}(?:عدل|غير)\s+(?:ال)?جرع\p{L}*${E}${AR_NOT_LOGGED}`),
  // "يجب أن تقلل جرعتك", "يمكنك إيقاف الميتفورمين", "ينبغي لك أن تخفض الجرعة"; "لا يجب أن..." and "لا يمكنك" pass.
  rule("dose_modal_ar", String.raw`(?<!لا\s)${B}(?:يجب\s+(?:عليك\s+)?أن|ينبغي\s+(?:عليك\s+|لك\s+)?أن|عليك\s+أن|عليك|يمكنك(?:\s+أن)?|بإمكانك(?:\s+أن)?|بوسعك(?:\s+أن)?|يمكن\s+لك(?:\s+أن)?|يجوز\s+لك(?:\s+أن)?|من\s+الممكن(?:\s+أن)?|لا\s+(?:بأس|مانع|حرج|ضرر)\s+(?:أن|في|ب|من))\s+${AR_VERB}\s+(?:(?:ب|في\s+)?(?:تناول|أخذ)\s+)?${AR_OBJ}${E}${AR_NOT_LOGGED}`),
  // "يبدو أنك مصاب بالسكري", "يبدو أن لديك السكري", "على الأرجح لديك مقدمات السكري".
  rule("diagnosis_ar", String.raw`(?:على\s+الأرجح|في\s+الغالب|غالبا|من\s+المرجح\s+أن(?:ك)?|يبدو\s+أن(?:ك)?|بالتأكيد|(?:تشير|تدل)\s+(?:قراءاتك|نتائجك|القراءات|النتائج)?\s*(?:إلى|على)\s+أن(?:ك)?|هذا\s+يعني\s+أن(?:ك)?)\s*(?:لديك|مصاب|تعاني\s+من)\s*(?:ب)?(?:مرض\s+)?(?:ال)?(?:سكري|سكر|مقدمات\s+(?:ال)?سكري)`),
  // "أنت مصاب بالسكري." / "لديك مرض السكري." as a sentence of its own.
  rule("diagnosis_bare_ar", String.raw`(?:^\s*|[.!?؟]\s+|[,،;؛:]\s*)(?:أنت\s+)?(?:مصاب|مصابة|لديك|عندك|تعاني\s+من)\s*(?:ب)?(?:مرض\s+)?(?:ال)?(?:سكري|مقدمات\s+(?:ال)?سكري)`),
  // "قيمك ضمن نطاق السكري", "قراءاتك تقع في نطاق مقدمات السكري".
  rule("diagnosis_range_ar", String.raw`(?:قيمك|قراءاتك|نتائجك|أرقامك|مستوياتك|قياساتك|مستوى\s+سكرك|سكرك)\s+(?:\p{L}+\s+){0,3}?(?:ضمن|في|داخل)\s+(?:ال)?(?:نطاق|مدى|فئة)\s+(?:مرض\s+)?(?:ال)?(?:سكري|مقدمات\s+(?:ال)?سكري)`),
];

// ── ja (teineigo) ───────────────────────────────────────────────────────────
// 単位 is also the food-exchange unit in Japanese diet education ("ご飯1膳は約3単位"),
// so a number of 単位 counts only next to insulin or an injecting verb.
const JA_NUM = String.raw`(?:${AMOUNT}|[一二三四五六七八九十]+)`;
const JA_OBJ = String.raw`(?:インスリン|お?薬|メトホルミン|用量|投与量|単位数)(?:の量)?(?:を|は)?\s*`;
const JA_DO = String.raw`(?:増やし|減らし|中止し|やめ|止め|変更し|調整し|始め|開始し|飛ばし|抜い|倍にし|半分にし)`;
// The dose someone already logged ("記録したインスリンの用量", "登録済みの用量") is app help, not a dose change.
const JA_LOGGED = String.raw`(?<!(?:記録|登録|保存|入力|メモ)(?:した|され?た|済み(?:の)?|ずみの)(?:インスリン|お?薬)?(?:の)?\s*)`;
// What sits between the object and the verb must not be an app item ("インスリンの通知設定を変更しても").
const JA_GAP = String.raw`(?:(?!通知|リマインダー|設定|記録|履歴|種類|ペン|針|部位|アラーム|タイマー)[^。\n]){0,8}?`;

const JA: Rule[] = [
  rule("dose_units_ja", String.raw`(?:インスリン|ｲﾝｽﾘﾝ)[^。\n]{0,20}?${JA_NUM}\s*(?:単位|ユニット)|${JA_NUM}\s*(?:単位|ユニット)(?:を|の|分の)?\s*(?:インスリン|追加|注射|打|増や|減ら)`),
  // "インスリンを減らしてください", "薬をやめましょう", "用量を増やすべきです"; "やめないでください" passes.
  rule("dose_change_ja", String.raw`${JA_LOGGED}${JA_OBJ}(?:(?:増やして|減らして|中止して|やめて|止めて|変更して|調整して|倍にして|半分にして|始めて|開始して|飛ばして|抜いて)(?:ください|みてください|みましょう)|(?:増やし|減らし|中止し|やめ|止め|変更し|調整し|始め|開始し|抜き)ましょう|(?:増やす|減らす|中止する|やめる|止める|変更する|調整する|始める|開始する|抜く)べき)`),
  // "メトホルミンをやめても大丈夫です", "インスリンを少し減らしてもいいでしょう"; "やめてはいけません" passes.
  rule("dose_modal_ja", String.raw`${JA_LOGGED}${JA_OBJ}${JA_GAP}${JA_DO}て(?:も)?(?:大丈夫|いい|よい|OK|オーケー|問題(?:は)?ありません|構いません|かまいません|差し支えありません|結構です|よろしい)`),
  // Only with the user's numbers or "あなた" in the same sentence: "妊娠中は妊娠糖尿病の可能性があります" is education.
  rule("diagnosis_ja", String.raw`(?:あなた|数値|結果|記録|測定値|血糖値)[^。\n]{0,24}?(?:糖尿病|境界型|予備群|インスリン抵抗性)(?:の可能性が(?:高い|あります)|である可能性が高い|と考えられます|だと思われます|と言えます|に該当します|のようです|の疑いがあります|かもしれません|ではありません)(?!か)`),
  // "あなたは糖尿病です。" stated outright; the question "あなたは糖尿病ですか？" passes.
  rule("diagnosis_ja_bare", String.raw`あなた(?:は|が)[^。\n]{0,10}?(?:糖尿病|境界型|予備群)(?:です|でしょう)(?!か)`),
  // "あなたの数値は糖尿病の範囲です", "血糖値は境界型の範囲に入ります".
  rule("diagnosis_range_ja", String.raw`(?:あなたの|ご自身の)?(?:数値|測定値|血糖値|検査値|結果|HbA1c|空腹時血糖)[^。\n]{0,20}?(?:糖尿病|境界型|予備群)(?:の)?(?:範囲|域|レベル|ゾーン|領域)(?:内)?(?:に(?:入|あ|該当|含ま)|です|にあります)(?!か)`),
];

// ── all languages ───────────────────────────────────────────────────────────
// Named carb ratios and correction factors, in every language the app has.
// Two families, because their figures differ: a carb ratio is 1:10 or grams per unit, a correction factor is
// 1:50 or mg/dL (mmol/L) per unit. "Insulin sensitivity ... after a meal with 30 g of fiber" is education.
const RATIO_CARB = String.raw`(?:ICR|CIR|I\s*:\s*C|IC[-\s]?ratio|insulin[-\s]to[-\s]carb(?:ohydrate)?s?(?:\s+ratio)?|carb(?:ohydrate)?s?\s+(?:ratio|factor)s?|(?:KE|BE)[-\s]?Faktor|Kohlenhydratfaktor|Insulin-Kohlenhydrat-Verhältnis|(?:ratio|rapport)\s+insuline|(?:ratio|relación)\s+insulina|rapporto\s+insulina|(?:razão|relação)\s+insulina|karbonhidrat\s+oran\p{L}*|insülin\p{L}*\s+oran\p{L}*)`;
const RATIO_SENS = String.raw`(?:ISF|correction\s+(?:factor|ratio)s?|sensitivity\s+(?:factor|ratio)s?|insulin\s+sensitivity|Korrekturfaktor|Insulinempfindlichkeit|facteur\s+de\s+(?:sensibilité|correction)|sensibilité\s+à\s+l'insuline|factor\s+de\s+(?:sensibilidad|corrección)|sensibilidad\s+a\s+la\s+insulina|fattore\s+di\s+(?:sensibilità|correzione)|sensibilità\s+insulinica|fator\s+de\s+(?:sensibilidade|correção)|sensibilidade\s+à\s+insulina|(?:duyarlılık|düzeltme)\s+(?:faktör|katsayı)\p{L}*|insülin\s+duyarlılığ\p{L}*)`;
const RATIO_LATIN = String.raw`(?:${RATIO_CARB}|${RATIO_SENS})`;
const RATIO_CJKAR_CARB = String.raw`(?:نسبة\s+(?:ال)?[أإا]نسولين|نسبة\s+(?:ال)?كربوهيدرات|糖質比|インスリン/糖質比)`;
const RATIO_CJKAR_SENS = String.raw`(?:معامل\s+(?:ال)?حساسية|عامل\s+التصحيح|معامل\s+التصحيح|حساسية\s+(?:ال)?[أإا]نسولين|インスリン感受性|補正係数|インスリン効果値)`;
const RATIO_CJKAR = String.raw`(?:${RATIO_CJKAR_CARB}|${RATIO_CJKAR_SENS})`;
const GRAMS = String.raw`(?:g|gr|grams?|grammes?|gramm|gramos|grammi|gramas|غ|غرام|جرام|グラム|ｇ)`;
const RATIO_ONE_TO_N = String.raw`${NB}1\s*[:/]\s*${NUM}`;
const CARB_FIG = String.raw`(?:${RATIO_ONE_TO_N}|${NB}${NUM}\s*${GRAMS}${E}(?!\s*/))`;
const SENS_FIG = String.raw`(?:${RATIO_ONE_TO_N}|${NB}${NUM}\s*(?:mg\s*/\s*dl|mmol\s*/\s*l)${E}(?!\s*/))`;
// What can sit between a ratio term and its bare figure: "ICR: 10", "correction factor is 50", "ISF 50",
// "Korrekturfaktor beträgt 50", "補正係数は50". A figure that is really a duration or a share is no ratio.
const RATIO_COPULA = String.raw`(?:\s*[:=：]\s*|\s*[はが]\s*|\s+(?:(?:is|are|was|of|at|to|down\s+to|up\s+to|should\s+be|about|around|roughly|approximately|currently|likely|probably|typically|usually|set\s+(?:to|at)|beträgt|ist|liegt\s+bei|sollte\s+(?:bei|auf)|auf|bei|est(?:\s+de)?|devrait\s+être(?:\s+de)?|es(?:\s+de)?|debería\s+ser(?:\s+de)?|è|dovrebbe\s+essere|é(?:\s+de)?|deveria\s+ser|هو|هي|يبلغ|تبلغ|لديك|عندك)\s+){0,3})`;
const NOT_DURATION = String.raw`(?![\d%％]|\s*(?:%|％|times|x${E}|percent|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|Tage|Wochen|Stunden|Minuten|jours|semaines|heures|días|semanas|horas|giorni|settimane|ore|dias|gün|hafta|saat|dakika|ساعة|ساعات|يوم|أيام|日|時間|分))`;
const UNIT_WORD = String.raw`(?:units?|U|Einheiten?|IE|unités?|UI|unidad(?:es)?|unidades?|unità|ünite|birim|وحدة|単位)`;
const PILL = String.raw`(?:tablets?|pills?|capsules?|caps|Tabletten?|Kapseln?|comprimés?|gélules?|comprimidos?|cápsulas?|compresse|capsule|tablet(?:ler)?|hap(?:lar)?|kapsül(?:ler)?|أقراص|قرص|كبسولات)`;
const MG_UNIT = String.raw`(?:mg|mcg|μg|µg|milligrams?|micrograms?|milligrammes?|miligramos?|miligramas?|milligrammi|miligram(?:lar)?|ملغ|ملغم|ميلي\s*غرام|ミリグラム)`;
const ORAL = String.raw`(?:metformin\p{L}*|glucophage|glipizid\p{L}*|glimepirid\p{L}*|gliclazid\p{L}*|glibenclamid\p{L}*|glyburid\p{L}*|sitagliptin\p{L}*|linagliptin\p{L}*|saxagliptin\p{L}*|vildagliptin\p{L}*|empagliflozin\p{L}*|dapagliflozin\p{L}*|canagliflozin\p{L}*|pioglitazon\p{L}*|acarbos\p{L}*|repaglinid\p{L}*|nateglinid\p{L}*|semaglutid\p{L}*|liraglutid\p{L}*|dulaglutid\p{L}*|tirzepatid\p{L}*|ozempic|mounjaro|januvia|jardiance|farxiga|victoza|trulicity|メトホルミン|(?:ال)?ميتفورمين|جلوكوفاج)`;

const ALL: Rule[] = [
  // A personal carb or correction ratio: "your insulin-to-carb ratio is 1:10", "KE-Faktor 1:12".
  rule("dose_ratio", String.raw`(?:ratio|factor|oran\p{L}*|katsayı\p{L}*|Verhältnis|Faktor|rapport|facteur|razón|relación|rapporto|fattore|razão|relação|fator|نسبة|معامل|比|係数)[^.\n。]{0,30}?${NB}1\s*[:/]\s*${NUM}`),
  // "Your ICR is 1:10", "your correction factor is about 50 mg/dL", "carb ratio of 15 g".
  rule("dose_ratio_value", String.raw`(?:${B}${RATIO_CARB}${E}|${RATIO_CJKAR_CARB})${SENTENCE_GAP}{0,40}?${CARB_FIG}`),
  rule("dose_ratio_value_sens", String.raw`(?:${B}${RATIO_SENS}${E}|${RATIO_CJKAR_SENS})${SENTENCE_GAP}{0,40}?${SENS_FIG}`),
  // "Your ICR is 10", "your correction factor is 50", "ISF 50": the figure without a unit or a colon.
  rule("dose_ratio_bare", String.raw`(?:${B}${RATIO_LATIN}${E}|${RATIO_CJKAR})${RATIO_COPULA}${NB}${NUM}${NOT_DURATION}`),
  // "Your ratio is 1 to 10", "your insulin-to-carb ratio is one to ten".
  rule("dose_ratio_to", String.raw`${B}ratio${E}[^.\n]{0,30}?(?:${NB}1|${B}one)\s+to\s+(?:${NUM}|${EN_NUMWORD})(?!\s*(?:hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|times?|servings?|portions?|readings?|meals?|%))`),
  // "one unit for every 15 grams of carbs", "1 Einheit pro 10 g", "1 unité pour 12 g".
  rule("dose_ratio_words", String.raw`${B}(?:one|1|a|eine?|une?|uno|una|um|uma|bir)\s+(?:insulin\s+)?${UNIT_WORD}\s+(?:of\s+(?:\p{L}+[-\s]){0,2}insulin\s+|(?:\p{L}+\s+){0,2})?(?:for|per|to\s+cover|covers?|every|pro|je|pour|por|per|ogni|para|başına|her)\s+(?:every\s+|each\s+|jeweils\s+|cada\s+|ogni\s+)?${NUM}\s*${GRAMS}${E}`),
  // "15 grams of carbs per unit".
  rule("dose_ratio_words_rev", String.raw`${B}${NUM}\s*${GRAMS}\s+(?:of\s+|de\s+|di\s+|d')?(?:carbs?|carbohydrates?|Kohlenhydrate\p{L}*|glucides|carbohidratos|carboidrati|carboidratos|karbonhidrat\p{L}*)\s+(?:per|for\s+(?:each|every)|pro|je|pour|por|ogni|başına|her)\s+(?:1\s+|one\s+|eine?\s+|une?\s+)?(?:insulin\s+)?${UNIT_WORD}${E}`),
  rule("dose_ratio_words_ar", String.raw`وحدة(?:\s+واحدة)?\s+(?:من\s+(?:ال)?[أإا]نسولين\s+)?لكل\s+${NUM}\s*${GRAMS}`),
  rule("dose_ratio_words_ja", String.raw`(?:炭水化物|糖質)\s*${NUM}\s*${GRAMS}\s*(?:につき|あたり|ごとに|に対して)[^。\n]{0,10}?(?:インスリン)?\s*${JA_NUM}\s*(?:単位|ユニット)`),
  // "1000 mg of metformin", "Nehmen Sie täglich 1000 mg Metformin ein": a number of mg next to a named drug.
  // "mg/dL" is glucose, never a drug amount.
  rule("dose_mg", String.raw`${B}${AMOUNT}\s*${MG_UNIT}(?!\s*/)${E}\s*(?:(?:per\s+day|daily|täglich|par\s+jour|al\s+día|al\s+giorno|por\s+dia|günde)\s+)?(?:${PILL}\s+)?(?:(?:of|de|del|di|von|من)\s+|d')?(?:ال)?${ORAL}`),
  // "Take two 500 mg tablets": an amount of mg on a pill is a dose whether or not the drug is named.
  rule("dose_mg_pills", String.raw`${B}${AMOUNT}\s*${MG_UNIT}(?!\s*/)${E}\s*${PILL}${E}`),
  rule("dose_mg_after", String.raw`${B}${ORAL}\s*[,:(]?\s*(?:[^.!?\n。]{0,12}?)${B}${AMOUNT}\s*${MG_UNIT}(?!\s*/)${E}`),
  rule("dose_mg_ja", String.raw`(?:メトホルミン|お?薬)[^。\n]{0,10}?${NUM}\s*(?:mg|ミリグラム)|${NUM}\s*(?:mg|ミリグラム)の?(?:メトホルミン)`),
];

const RULES: readonly Rule[] = [...EN, ...TR, ...DE, ...FR, ...ES, ...IT, ...PT, ...AR, ...JA, ...ALL];

// Cyrillic and Greek letters that read as Latin ones, folded so "unіts" (Cyrillic і) cannot dodge a rule.
const LOOKALIKES: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ["А", "A"], ["В", "B"], ["С", "C"], ["Е", "E"], ["Н", "H"], ["І", "I"], ["Ј", "J"], ["К", "K"],
    ["М", "M"], ["О", "O"], ["Р", "P"], ["Ѕ", "S"], ["Т", "T"], ["Х", "X"], ["У", "Y"],
    ["а", "a"], ["с", "c"], ["е", "e"], ["і", "i"], ["ј", "j"], ["о", "o"], ["р", "p"], ["ѕ", "s"],
    ["х", "x"], ["у", "y"], ["ԁ", "d"], ["һ", "h"], ["ӏ", "l"], ["ԛ", "q"], ["ԝ", "w"],
    ["Α", "A"], ["Β", "B"], ["Ε", "E"], ["Ζ", "Z"], ["Η", "H"], ["Ι", "I"], ["Κ", "K"], ["Μ", "M"],
    ["Ν", "N"], ["Ο", "O"], ["Ρ", "P"], ["Τ", "T"], ["Υ", "Y"], ["Χ", "X"],
    ["α", "a"], ["ε", "e"], ["ι", "i"], ["κ", "k"], ["ν", "v"], ["ο", "o"], ["ρ", "p"], ["υ", "u"], ["χ", "x"],
  ],
);
// Default-ignorable characters render as nothing but are not all \p{Cf} or marks (Hangul fillers, Mongolian
// variation selectors); U+2800 is a blank braille cell.
const MARK_OR_FORMAT = /[\p{M}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/u;
const IS_MARK = /\p{M}/u;
const CONTROL = /\p{Cc}/u;
// The accent-stripping pass removes only the Latin-style combining accents. Arabic hamza and kana voicing marks
// stay, so NFKC puts "أ" and "ガ" back together and the rules' own exclusions still read the text as written.
const ACCENT_MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/gu;
// Letters that read as Latin ones but have no decomposition: only the accent-stripping pass folds them, because
// the plain pass must keep Turkish dotless i.
const FOLD_EXTRA: Readonly<Record<string, string>> = { "\u0131": "i", "\u1d1c": "u", "\u057d": "u", "\ua4f4": "U", "\u0585": "o" };

interface Normalized {
  norm: string;
  /** For each character of `norm`, the index in the input it came from. */
  at: number[];
  /** Whether an invisible character was dropped. */
  dropped: boolean;
}

/**
 * Text as the rules expect it, plus each output character's index in the
 * input (dropped characters make the two differ). NFKC folds fullwidth,
 * circled and mathematical letters; zero-width, soft-hyphen, word-joiner and
 * BOM characters (\p{Cf}), controls and combining marks are removed; Turkish
 * dotted capital I has no simple case folding, so /i would not match it to i;
 * Arabic diacritics and tatweel would split the words the Arabic rules look
 * for. `gap` is what a dropped invisible character leaves behind: nothing
 * ("un\u200Bits" -> "units") or a space ("4\u200Bunits" -> "4 units"); the
 * caller scans both when the text had any. `fold` also strips accents (NFKD,
 * marks removed, NFKC) and folds FOLD_EXTRA, so "\u00FAnits" and "un\u0131ts" read as
 * "units"; it is a third reading of the same text, scanned next to the plain one.
 */
function normalizeWithMap(text: string, gap: "" | " ", fold = false): Normalized {
  let norm = "";
  const at: number[] = [];
  let dropped = false;
  let i = 0;
  while (i < text.length) {
    const start = i;
    const first = text.codePointAt(i) as number;
    i += first > 0xffff ? 2 : 1;
    // Cheap path: printable ASCII with no combining mark after it.
    if (first >= 0x20 && first < 0x7f && (i >= text.length || text.charCodeAt(i) < 0x300)) {
      norm += text[start];
      at.push(start);
      continue;
    }
    if (first < 0x20 || first === 0x7f) {
      if (first === 0x09 || first === 0x0a || first === 0x0d) {
        norm += text[start];
        at.push(start);
      } else {
        dropped = true;
        if (gap) {
          norm += gap;
          at.push(start);
        }
      }
      continue;
    }
    // Take the combining marks that follow, so NFKC can compose them with their base.
    while (i < text.length && text.charCodeAt(i) >= 0x300) {
      const next = text.codePointAt(i) as number;
      if (!IS_MARK.test(String.fromCodePoint(next))) break;
      i += next > 0xffff ? 2 : 1;
    }
    const cluster = text.slice(start, i);
    const shaped = fold ? cluster.normalize("NFKD").replace(ACCENT_MARKS, "").normalize("NFKC") : cluster.normalize("NFKC");
    for (const ch of shaped) {
      const code = ch.codePointAt(0) as number;
      if (code === 0x0640 || MARK_OR_FORMAT.test(ch) || CONTROL.test(ch)) {
        dropped = true;
        if (gap) {
          norm += gap;
          at.push(start);
        }
        continue;
      }
      let out = ch;
      if (code === 0x0130) out = "i";
      else if (code === 0x2019 || code === 0x02bc) out = "'";
      else if (code === 0x00a0 || code === 0x202f) out = " ";
      else if (LOOKALIKES[ch] !== undefined) out = LOOKALIKES[ch];
      else if (fold && FOLD_EXTRA[ch] !== undefined) out = FOLD_EXTRA[ch];
      norm += out;
      for (let k = 0; k < out.length; k++) at.push(start);
    }
  }
  return { norm, at, dropped };
}

// The only characters whose reading as a letter the accent-stripping pass can change: Latin, Greek and Cyrillic
// letters (accented ones are precomposed by NFKC), the combining accents themselves, phonetic and letterlike
// forms and FOLD_EXTRA. Anything else, plain ASCII and the Arabic and Japanese the app also writes included,
// reads the same in both passes, so the second one is skipped (math operators with a slash do change, to other
// operators, which no rule reads).
const MAY_FOLD = /[\u00c0-\u04ff\u057d\u0585\u1ab0-\u1aff\u1d00-\u1dff\u1e00-\u1fff\u20d0-\u20ff\u212b\ua4f4\ufe20-\ufe2f\u{1d6a4}\u{1d6a5}]/u;

/** The normalised text to scan: with invisible characters dropped, when there
 *  were any also with each turned into a space, and, when stripping accents
 *  changes the text, that reading too. */
function variantsOf(text: string): Normalized[] {
  const plain = normalizeWithMap(text, "");
  const out = plain.dropped ? [plain, normalizeWithMap(text, " ")] : [plain];
  if (MAY_FOLD.test(text)) {
    const folded = normalizeWithMap(text, "", true);
    if (folded.norm !== plain.norm) out.push(folded);
  }
  return out;
}

/** Id of the first rule the complete text breaks, or null when it may be shown. */
export function checkReply(text: string): string | null {
  for (const variant of variantsOf(text)) {
    for (const r of RULES) {
      if (variant.norm.search(r.re) >= 0) return r.id;
    }
  }
  return null;
}

interface StreamScan {
  /** A rule that matches text which ends before the settle margin: final. */
  hit: string | null;
  /** Where the earliest match that is not settled yet starts, in the input. */
  hold: number | null;
}

/**
 * Mid-stream check. Several rules end in an exclusion that reads the next
 * words ("... nicht", "... reminder", "... olarak"); judged at the very end of
 * a partial text, those would block replies that turn out fine, so only a
 * match followed by at least `settle` more input characters counts as a hit.
 * A match that is not settled yet is not a hit but is reported in `hold`:
 * nothing from its start on may leave the server until it is settled, so a
 * phrase like "4 units" never goes out half way.
 */
function scanStream(text: string, settle: number): StreamScan {
  const limit = text.length - settle;
  let hold: number | null = null;
  for (const variant of variantsOf(text)) {
    for (const r of RULES) {
      for (const m of variant.norm.matchAll(r.re)) {
        const end = m.index + m[0].length;
        if (end === m.index) continue;
        if (variant.at[end - 1] < limit) return { hit: r.id, hold };
        const start = variant.at[m.index];
        hold = hold === null ? start : Math.min(hold, start);
      }
    }
  }
  return { hit: null, hold };
}

// ── Fixed replacement texts ─────────────────────────────────────────────────
// Server-side copy shown in the app: one formal address per language, and no
// regulated wording (warn/alarm, diagnosis, treatment, recommended dose).

const SAFE_FILTERED: Record<Locale, string> = {
  en: "I can't answer that here. Decisions about insulin, medication or what your readings mean are made with your doctor or diabetes care team. I can help you keep a clear log to bring to your next visit.",
  tr: "Bu soruyu burada yanıtlayamıyorum. İnsülin, ilaçlar ya da ölçümlerinizin ne anlama geldiğiyle ilgili kararlar doktorunuzla veya diyabet ekibinizle birlikte verilir. Bir sonraki randevunuza götürmek için düzenli bir günlük tutmanıza yardımcı olabilirim.",
  de: "Darauf kann ich hier nicht antworten. Entscheidungen über Insulin, Medikamente oder die Bedeutung Ihrer Werte treffen Sie gemeinsam mit Ihrem Arzt oder Ihrem Diabetesteam. Gern helfe ich Ihnen, ein übersichtliches Tagebuch für Ihren nächsten Termin zu führen.",
  fr: "Je ne peux pas répondre à cette question ici. Les décisions concernant l'insuline, les médicaments ou la signification de vos valeurs se prennent avec votre médecin ou votre équipe diabète. Je peux vous aider à tenir un journal clair pour votre prochain rendez-vous.",
  es: "No puedo responder a esa pregunta aquí. Las decisiones sobre la insulina, los medicamentos o lo que significan sus valores se toman con su médico o su equipo de diabetes. Puedo ayudarle a llevar un registro claro para su próxima consulta.",
  it: "Non posso rispondere a questa domanda qui. Le decisioni su insulina, farmaci o sul significato dei Suoi valori vanno prese con il Suo medico o il Suo team diabetologico. Posso aiutarLa a tenere un diario chiaro per la prossima visita.",
  pt: "Não posso responder a essa pergunta aqui. Decisões sobre insulina, medicamentos ou o significado dos seus valores são tomadas com seu médico ou sua equipe de diabetes. Posso ajudar você a manter um registro claro para a próxima consulta.",
  ar: "لا يمكنني الإجابة عن هذا السؤال هنا. القرارات المتعلقة بالإنسولين أو الأدوية أو بمعنى قراءاتك تتخذ مع طبيبك أو فريق السكري الذي يتابعك. يمكنني مساعدتك في الاحتفاظ بسجل واضح لزيارتك القادمة.",
  ja: "このご質問にはここではお答えできません。インスリンや薬、測定値の意味に関する判断は、主治医や糖尿病の医療チームと一緒に行ってください。次回の受診に向けて、わかりやすい記録をつけるお手伝いができます。",
};

const SAFE_REFUSAL: Record<Locale, string> = {
  en: "I can't help with that one. I can help you use zerospike and answer general diabetes questions.",
  tr: "Bu konuda yardımcı olamıyorum. zerospike'ı kullanmanız ve genel diyabet sorularınız konusunda yardımcı olabilirim.",
  de: "Dabei kann ich Ihnen leider nicht helfen. Gern helfe ich Ihnen bei der Nutzung von zerospike und bei allgemeinen Fragen zu Diabetes.",
  fr: "Je ne peux pas vous aider sur ce point. Je peux vous aider à utiliser zerospike et répondre à vos questions générales sur le diabète.",
  es: "No puedo ayudarle con eso. Puedo ayudarle a usar zerospike y responder a sus preguntas generales sobre la diabetes.",
  it: "Non posso aiutarLa su questo. Posso aiutarLa a usare zerospike e rispondere alle Sue domande generali sul diabete.",
  pt: "Não posso ajudar com isso. Posso ajudar você a usar o zerospike e responder às suas perguntas gerais sobre diabetes.",
  ar: "لا يمكنني المساعدة في هذا الأمر. يمكنني مساعدتك في استخدام zerospike والإجابة عن أسئلتك العامة حول السكري.",
  ja: "この件についてはお手伝いできません。zerospikeの使い方や、糖尿病に関する一般的なご質問にはお答えできます。",
};

export function safeText(locale: Locale, kind: "filtered" | "refusal"): string {
  return (kind === "refusal" ? SAFE_REFUSAL : SAFE_FILTERED)[locale];
}

// ── Final verdict on a complete reply ───────────────────────────────────────

export interface ReplyOutcome {
  reply: string;
  actions: ActionId[];
  sources: SourceRef[];
  filtered: boolean;
  /** The model ran into the token ceiling: the reply ends mid-thought and its meta line is not trusted. */
  truncated: boolean;
  /** Rule id, "refusal" or "empty"; monitoring only, never shown. */
  rule: string | null;
}

/** A refusal and a reply with nothing visible both get the neutral "can't help" text: the second says nothing about insulin or readings. */
export function blockedOutcome(locale: Locale, rule: string): ReplyOutcome {
  return {
    reply: safeText(locale, rule === "refusal" || rule === "empty" ? "refusal" : "filtered"),
    actions: [],
    sources: [],
    filtered: true,
    truncated: false,
    rule,
  };
}

/** Raw model text + stop reason -> what the user may see. */
export function finalizeReply(raw: string, stopReason: string | null, locale: Locale): ReplyOutcome {
  // A refusal can stop mid-sentence; its partial text is never shown.
  if (stopReason === "refusal") return blockedOutcome(locale, "refusal");
  const parsed = parseMeta(raw, locale);
  // Billed but nothing to show (only the meta line, only a code fence, or the token ceiling before any text): a
  // 200 with the neutral text and a spent slot. An error here would send the app on to a second paid call.
  if (!parsed.reply) return blockedOutcome(locale, "empty");
  const rule = checkReply(parsed.reply);
  if (rule) return blockedOutcome(locale, rule);
  // Cut off at the token ceiling: the visible text may be a fragment and the
  // meta line is missing or incomplete, so no buttons and no sources.
  if (stopReason === "max_tokens") {
    return { reply: parsed.reply, actions: [], sources: [], filtered: false, truncated: true, rule: null };
  }
  return { ...parsed, filtered: false, truncated: false, rule: null };
}

// ── Streaming ───────────────────────────────────────────────────────────────

/** Nothing is sent before this many visible characters exist. */
export const HOLD_CHARS = 40;
/** Kept back at the tail so a match's exclusions see real text before it is
 *  judged. The longest look-ahead (the German question-mark check) reads 26
 *  characters; a new exclusion must stay under this margin. */
export const SETTLE_CHARS = 32;

/**
 * Decides what part of a streaming reply may be sent yet. Nothing goes out
 * until 40 visible characters exist; after that deltas flow, trailing 32
 * characters behind the model, and before every send the filter runs on the
 * full text. A match that ends inside the 32-character margin is not final
 * (an exclusion may still cancel it), but nothing from its first character on
 * is sent until it is, so a forbidden phrase of up to 32 characters never
 * leaves the server in part. A rule with a gap in it can match a longer
 * stretch, so its first words may go out before it completes; the client
 * discards everything streamed on done.filtered and shows the safe text. The
 * spec asked for a check every 200 characters; a check costs well under a
 * millisecond on a reply this size, so checking before every send is free.
 * The <<meta>> line never leaks (see visibleEnd).
 */
export class StreamGuard {
  #full = "";
  #start = -1;
  #sentEnd = -1;

  get text(): string {
    return this.#full;
  }

  push(delta: string): { emit: string; blocked: string | null } {
    this.#full += delta;
    if (this.#start < 0) {
      const first = this.#full.search(/\S/);
      if (first < 0) return { emit: "", blocked: null };
      this.#start = first;
      this.#sentEnd = first;
    }
    let end = Math.min(visibleEnd(this.#full), this.#full.length - SETTLE_CHARS);
    while (end > this.#sentEnd && /\s/.test(this.#full[end - 1])) end--;
    if (end - this.#start < HOLD_CHARS || end <= this.#sentEnd) return { emit: "", blocked: null };
    const found = scanStream(this.#full, SETTLE_CHARS);
    if (found.hit) return { emit: "", blocked: found.hit };
    if (found.hold !== null) {
      end = Math.min(end, found.hold);
      while (end > this.#sentEnd && /\s/.test(this.#full[end - 1])) end--;
      if (end - this.#start < HOLD_CHARS || end <= this.#sentEnd) return { emit: "", blocked: null };
    }
    const emit = this.#full.slice(this.#sentEnd, end);
    this.#sentEnd = end;
    return { emit, blocked: null };
  }

  /** The part of the final reply not sent yet (all of it for replies under 40 characters). */
  rest(reply: string): string {
    const sent = this.#start < 0 ? 0 : this.#sentEnd - this.#start;
    return reply.length > sent ? reply.slice(sent) : "";
  }
}
