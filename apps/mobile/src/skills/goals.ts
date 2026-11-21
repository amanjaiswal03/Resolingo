import type { ConversationSkill } from "@resolingo/shared";

export const grammarGoals = {
  sentences: "Build clear sentences",
  questions: "Ask questions",
  verbs: "Say what people do",
  negation: "Say what isn’t true",
  past: "Talk about the past",
  agreement: "Describe people and things",
  modals: "Talk about wants, needs, and possibilities",
  connections: "Connect your ideas",
  hypotheticals: "Talk about what could happen",
} as const;
type GrammarGoal = keyof typeof grammarGoals;

const grammarRules: Record<GrammarGoal, readonly string[]> = {
  sentences: ["de-v2", "de-separable", "de-nominal-style", "g-formal"],
  questions: ["de-questions", "g-questions"],
  verbs: ["de-sein", "de-haben", "de-present", "de-passive", "de-passive-modal", "g-be-have", "g-present", "g-passive"],
  negation: ["de-negation", "g-negation"],
  past: ["de-perfekt-haben", "de-perfekt-sein", "de-prateritum", "g-past", "g-past-contrast"],
  agreement: ["de-gender", "de-accusative", "de-dative", "de-possessive", "de-comparative", "de-prepositions", "de-adjective", "de-reflexive", "de-endings", "de-infinitive-noun", "de-participle", "g-articles", "g-pronouns", "g-objects", "g-comparative", "g-prepositions"],
  modals: ["de-modals", "de-modal-subjective", "g-modals"],
  connections: ["de-weil", "de-verb-final", "de-relative", "de-da-compounds", "de-reported", "de-connectors", "de-concession", "g-subordinate", "g-relative", "g-reported", "g-connectors"],
  hypotheticals: ["de-wurde", "de-konjunktiv-ii", "de-hypothetical", "g-conditional", "g-mood"],
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
