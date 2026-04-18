// api.js — Appels à l'API Groq (compatible OpenAI)

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile'; // Fallback auto vers llama-3.1-8b-instant si nécessaire
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_RETRIES = 3;

/**
 * Génère un batch de questions via Groq.
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.category
 * @param {string} params.difficulty
 * @param {string} params.language
 * @param {number} params.count
 * @param {string[]} params.previousQuestions — pour éviter les répétitions
 * @returns {Promise<Array<{question:string, options:string[], correctAnswer:number, explanation:string}>>}
 */
export async function generateQuestions({ apiKey, category, difficulty, language, count, previousQuestions = [] }) {
  if (!apiKey) throw new Error('Aucune clé API fournie.');

  const systemPrompt = buildSystemPrompt({ count, category, difficulty, language, previousQuestions });

  let lastError = null;
  let modelToUse = MODEL;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Génère exactement ${count} questions maintenant, chacune sur un sous-thème DIFFÉRENT. Réponds avec le JSON pur, sans markdown.` },
          ],
          temperature: 1.0,
          top_p: 0.95,
          presence_penalty: 0.6,
          frequency_penalty: 0.4,
          max_tokens: 2500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        // 401 → clé invalide
        if (res.status === 401) throw new ApiError('INVALID_KEY', 'Clé API invalide. Vérifiez-la sur console.groq.com/keys.');
        // 429 → quota dépassé
        if (res.status === 429) throw new ApiError('RATE_LIMIT', 'Quota atteint. Réessayez dans un instant.');
        // 404 / 400 sur le modèle → on fallback
        if ((res.status === 404 || res.status === 400) && modelToUse === MODEL) {
          modelToUse = FALLBACK_MODEL;
          continue;
        }
        throw new ApiError('HTTP_' + res.status, `Erreur serveur: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Réponse vide de l\'IA.');

      const parsed = safeParseJson(content);
      const questions = parsed?.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('Format JSON inattendu.');
      }

      const valid = questions.filter(isValidQuestion);
      if (valid.length === 0) throw new Error('Aucune question valide générée.');

      // Dédup interne au batch + contre les questions précédentes (normalisation simple)
      const seenSigs = new Set(previousQuestions.map(normalizeSig));
      const deduped = [];
      for (const q of valid) {
        const sig = normalizeSig(q.question);
        if (seenSigs.has(sig)) continue;
        seenSigs.add(sig);
        deduped.push(q);
      }
      if (deduped.length === 0) {
        // Tout le batch était un doublon — on retente
        throw new Error('Batch entièrement dupliqué.');
      }
      return deduped;
    } catch (err) {
      lastError = err;
      // Erreurs non-retryables : on ressort tout de suite
      if (err instanceof ApiError && (err.code === 'INVALID_KEY' || err.code === 'RATE_LIMIT')) {
        throw err;
      }
      // Petit backoff avant retry
      if (attempt < MAX_RETRIES) {
        await sleep(300 * attempt);
      }
    }
  }

  throw lastError || new Error('Impossible de générer les questions.');
}

// Angles de diversification pris au hasard à chaque appel pour forcer la variété
const DIVERSIFICATION_ANGLES = [
  'Privilégie des sujets peu connus ou surprenants, évite les classiques évidents.',
  'Concentre-toi sur des faits contemporains (après 2000).',
  'Concentre-toi sur des aspects historiques (avant 1950).',
  'Aborde l\'aspect technique, scientifique ou théorique du sujet.',
  'Aborde l\'aspect culturel, social ou humain du sujet.',
  'Mélange époques, régions du monde et sous-domaines : chaque question doit toucher un angle différent.',
  'Explore des détails, anecdotes ou chiffres précis plutôt que des généralités.',
  'Inclus des questions sur des personnalités, lieux et événements moins médiatisés.',
  'Varie entre définitions, dates, causes, conséquences, comparaisons et exemples.',
  'Couvre plusieurs continents / régions linguistiques si pertinent.',
];

function pickRandom(arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function buildSystemPrompt({ count, category, difficulty, language, previousQuestions }) {
  // Liste d'anti-répétition : on envoie les 40 dernières questions vues
  const avoidList = previousQuestions.slice(-40);
  const avoidBlock = avoidList.length
    ? `\n\n⚠️ INTERDICTION ABSOLUE de reformuler, paraphraser ou réutiliser le sujet précis de ces ${avoidList.length} questions déjà posées (même si tu changes les mots) :\n- ${avoidList.join('\n- ')}\n\nSi tu envisages une question similaire à l'une d'elles, change complètement de sous-thème.`
    : '';

  // 2 angles tirés au hasard pour orienter la génération vers de nouveaux territoires
  const angles = pickRandom(DIVERSIFICATION_ANGLES, 2);
  const anglesBlock = `\n\nPour CE lot spécifiquement :\n- ${angles.join('\n- ')}`;

  // Graine aléatoire textuelle pour casser les patterns déterministes du modèle
  const seed = Math.random().toString(36).slice(2, 8);

  return `Tu es un générateur expert de questions de quiz. Génère ${count} questions sur le thème "${category}" au niveau ${difficulty} en ${language}.

Réponds UNIQUEMENT avec un JSON valide de ce format exact, sans texte avant ou après, sans markdown :
{
  "questions": [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswer": 0,
      "explanation": "..."
    }
  ]
}

Règles strictes :
- Exactement 4 propositions par question
- correctAnswer est l'index (0-3) de la bonne réponse
- CHAQUE question doit porter sur un sous-thème DIFFÉRENT (pas deux questions sur le même personnage, la même date, le même concept)
- Propositions plausibles (pas de réponses évidemment fausses)
- Explications brèves (1 phrase, ~15 mots max)
- Informations factuellement correctes et vérifiables
- Adapte la difficulté : Facile = grand public, Expert = spécialistes
- Varie la position de la bonne réponse (pas toujours A)${anglesBlock}${avoidBlock}

(Graine de diversité : ${seed})`;
}

// Normalisation pour détecter les doublons : lowercase, sans ponctuation, sans espaces multiples
function normalizeSig(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidQuestion(q) {
  return (
    q &&
    typeof q.question === 'string' &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every(o => typeof o === 'string') &&
    Number.isInteger(q.correctAnswer) &&
    q.correctAnswer >= 0 &&
    q.correctAnswer <= 3 &&
    typeof q.explanation === 'string'
  );
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch {}
  // Tente d'extraire le premier bloc JSON s'il y a du markdown autour
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Demande à l'IA une explication approfondie d'une question/réponse.
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.question
 * @param {string} params.answer — la bonne réponse
 * @param {string} params.language — "Français" | "Anglais"
 * @returns {Promise<string>} texte explicatif (plain text, ~100 mots)
 */
export async function getMoreInfo({ apiKey, question, answer, language }) {
  if (!apiKey) throw new Error('Aucune clé API fournie.');

  const systemPrompt = `Tu es un expert pédagogue. En ${language}, explique en profondeur pourquoi la réponse à cette question est correcte : donne du contexte historique/scientifique/culturel pertinent, des faits marquants et, si utile, une anecdote. Réponds en texte brut (pas de markdown), 3-5 phrases, ~100 mots max. Sois captivant et précis.`;

  const userPrompt = `Question : "${question}"\nBonne réponse : "${answer}"\n\nDéveloppe.`;

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: FALLBACK_MODEL, // modèle rapide, suffit pour une explication
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 350,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) throw new ApiError('INVALID_KEY', 'Clé API invalide.');
    if (res.status === 429) throw new ApiError('RATE_LIMIT', 'Quota atteint. Réessayez dans un instant.');
    throw new Error(`Erreur HTTP ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Réponse vide.');
  return content;
}

/**
 * Vérifie rapidement qu'une clé fonctionne (petit ping avec maxTokens=1)
 */
export async function verifyApiKey(apiKey) {
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
      }),
    });
    if (res.status === 401) return { ok: false, reason: 'Clé invalide' };
    if (res.ok || res.status === 429) return { ok: true };
    return { ok: false, reason: `Erreur HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: 'Pas de connexion' };
  }
}
