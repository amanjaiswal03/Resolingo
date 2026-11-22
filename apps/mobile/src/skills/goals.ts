import type { ConversationSkill } from "@resolingo/shared";

export const grammarGoals = {
  sentences: "Build clear sentences",
  questions: "Ask questions",
  verbs: "Say what people do",
  negation: "Say what isn’t true",
  past: "Talk about the past",
  agreement: "Describe people and things",
  modals: "Talk about wants, needs, and possibilities",
  future: "Talk about plans and the future",
  connections: "Connect your ideas",
  hypotheticals: "Talk about what could happen",
} as const;
type GrammarGoal = keyof typeof grammarGoals;

export const grammarRules: Record<GrammarGoal, readonly string[]> = {
  sentences: [
    "de-v2", "de-separable", "de-nominal-style",
    "es-formal-register", "fr-formal-register",
    "g-formal", "g-register", "g-emphasis", "g-polite", "g-imperative", "g-hedging", "g-time-words",
  ],
  questions: ["de-questions", "es-questions", "fr-questions", "g-questions"],
  verbs: [
    "de-sein", "de-haben", "de-present", "de-sein-plural", "de-haben-plural", "de-present-plural", "de-passive", "de-passive-modal",
    "es-ar-verbs", "es-er-ir-verbs", "es-ser", "es-estar", "es-tener", "es-plural-verbs", "es-gustar", "es-passive-se", "es-periphrasis",
    "fr-etre", "fr-avoir", "fr-aller", "fr-faire", "fr-er-verbs", "fr-plural-verbs", "fr-passive", "fr-gerondif",
    "g-be-have", "g-present", "g-passive", "g-like",
  ],
  negation: ["de-negation", "es-negation", "fr-negation", "g-negation"],
  past: [
    "de-perfekt-haben", "de-perfekt-sein", "de-prateritum",
    "es-preterite-regular", "es-preterite-irregular", "es-imperfect", "es-preterite-imperfect", "es-present-perfect",
    "fr-passe-compose-avoir", "fr-passe-compose-etre", "fr-imparfait", "fr-pc-imparfait",
    "g-past", "g-past-contrast", "g-experience",
  ],
  agreement: [
    "de-gender", "de-accusative", "de-dative", "de-possessive", "de-comparative", "de-prepositions", "de-adjective", "de-reflexive", "de-endings", "de-infinitive-noun", "de-participle",
    "es-gender", "es-comparative", "es-object-pronouns", "es-indirect-pronouns", "es-por-para", "es-reflexive",
    "fr-gender", "fr-comparative", "fr-object-pronouns", "fr-indirect-pronouns", "fr-partitive", "fr-y-en", "fr-reflexive",
    "g-articles", "g-pronouns", "g-objects", "g-comparative", "g-prepositions", "g-possession", "g-location", "g-numbers-plural",
  ],
  modals: ["de-modals", "de-modal-subjective", "es-subjunctive-wishes", "fr-modals", "g-modals", "g-wishes"],
  future: ["es-ir-a", "es-future", "fr-futur-proche", "fr-futur-simple", "g-future-plans"],
  connections: [
    "de-weil", "de-verb-final", "de-relative", "de-da-compounds", "de-reported", "de-connectors", "de-concession",
    "es-connectors", "es-relative", "es-reported", "fr-connectors", "fr-relative", "fr-dont", "fr-reported",
    "g-subordinate", "g-relative", "g-reported", "g-connectors", "g-because",
  ],
  hypotheticals: [
    "de-wurde", "de-konjunktiv-ii", "de-hypothetical",
    "es-conditional", "es-si-clauses", "es-subjunctive-emotion", "es-imperfect-subjunctive", "es-pluperfect-subjunctive", "es-nuanced-subjunctive",
    "fr-conditionnel", "fr-past-conditional", "fr-si-clauses", "fr-subjonctif", "fr-subjonctif-emotion", "fr-nuanced-subjonctif",
    "g-conditional", "g-mood", "g-unreal", "g-past-unreal",
  ],
};

export function grammarGoal(ruleId: string): GrammarGoal {
  return (Object.keys(grammarRules) as GrammarGoal[]).find((goal) => grammarRules[goal].includes(ruleId)) ?? "sentences";
}

// Earlier lessons lack a goal tag. Use clear cues and keep uncertain material
// in one everyday group instead of guessing from every generated lesson title.
const topicClues: [ConversationSkill, RegExp][] = [
  ["order-food", /\b(cafes?|coffee|restaurants?|menus?|meals?|breakfast|lunch|dinner|waiter|bakery|pizza|pasta|ordering food|kaffee|speisekarte|fruhstuck|abendessen|comida|desayuno|desayunar|restaurante|cafeteria|boulangerie|dejeuner|pizzeria|ristorante|padaria)\b/u],
  ["get-around", /\b(directions|transport|train|bus|subway|airport|station|ticket|bus stop|bahnhof|haltestelle|zug|flughafen|weg|estacion|tren|autobus|aeropuerto|gare|metro|aeroport|aeroporto|stazione)\b/u],
  ["handle-appointments", /\b(appointments?|doctor|dentist|pharmacy|clinic|receptionist|post office|booking|check in|hotel|arzt|arzttermin|zahnarzt|apotheke|sprechstunde|medico|farmacia|consultorio|rendez vous|medecin|pharmacie|appuntamento)\b/u],
  ["shop-and-pay", /\b(shopping|shops?|buying|market|groceries|checkout|paying|cashier|clothes|einkaufen|markt|kasse|bezahlen|compras|comprar|supermercado|magasin|acheter|mercado|negozio)\b/u],
  ["meet-people", /\b(greetings|introductions?|introducing|meeting someone|small talk|new friends|begrussung|vorstellen|kennenlernen|saludos|presentarse|presentaciones|faire connaissance|begrusen)\b/u],
  ["make-plans", /\b(mak(?:e|ing) plans|invitations?|reschedul(?:e|ing)|meeting up|weekend plans|verabredung|einladung|verschieben|invitacion|quedar|invitation|organiser|rinviare)\b/u],
  ["ask-for-help", /\b(ask(?:ing)? for help|clarification|misunderstanding|hilfe|nachfragen|pedir ayuda|aclaracion|demander de l aide)\b/u],
];

function fold(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function inferConversationGoal(topic: string, summary: string): ConversationSkill | undefined {
  return topicClues.find(([, cue]) => cue.test(fold(topic)))?.[0]
    ?? topicClues.find(([, cue]) => cue.test(fold(summary)))?.[0];
}

export function phraseConversationGoal(target: string, meaning: string): ConversationSkill | undefined {
  const phrase = fold(`${meaning} ${target}`);
  if (/\b(could you repeat|please repeat|please speak more slowly|say that again|i don t understand|i do not understand|can you help me|ich verstehe nicht|konnen sie mir helfen|no entiendo|ne comprends pas)\b/u.test(phrase)) {
    return "ask-for-help";
  }
  const greeting = /^(hello|hi|good morning|hallo|guten morgen|hola|buenos dias|bonjour|ciao)$/u;
  if (greeting.test(fold(meaning)) || greeting.test(fold(target)) ||
      /\b(my name is|nice to meet you|pleased to meet you|mein name ist|ich heisse|mucho gusto|me llamo|enchante)\b/u.test(phrase)) {
    return "meet-people";
  }
  return undefined;
}
