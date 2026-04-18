// storage.js — Gestion du localStorage avec un léger obfuscation pour la clé API

const KEYS = {
  API_KEY: 'quiz_ia_api_key',
  PREFS: 'quiz_ia_prefs',
  BEST_SCORES: 'quiz_ia_best_scores',
  CACHE: 'quiz_ia_cache',
};

// Obfuscation basique (Base64 + XOR léger). Ce n'est pas de la crypto forte —
// juste pour éviter que la clé soit en clair si quelqu'un jette un œil.
const XOR_KEY = 'quiz-ia-2025';

function xor(str, key) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

function encode(str) {
  try { return btoa(xor(str, XOR_KEY)); } catch { return ''; }
}

function decode(str) {
  try { return xor(atob(str), XOR_KEY); } catch { return ''; }
}

export function saveApiKey(key) {
  if (!key) return;
  localStorage.setItem(KEYS.API_KEY, encode(key));
}

export function getApiKey() {
  const raw = localStorage.getItem(KEYS.API_KEY);
  return raw ? decode(raw) : '';
}

export function clearApiKey() {
  localStorage.removeItem(KEYS.API_KEY);
}

export function savePrefs(prefs) {
  try { localStorage.setItem(KEYS.PREFS, JSON.stringify(prefs)); } catch {}
}

export function getPrefs() {
  try {
    const raw = localStorage.getItem(KEYS.PREFS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveBestScore(category, difficulty, percent) {
  const all = getBestScores();
  const key = `${category} · ${difficulty}`;
  const current = all[key] || 0;
  if (percent > current) {
    all[key] = percent;
    try { localStorage.setItem(KEYS.BEST_SCORES, JSON.stringify(all)); } catch {}
    return true;
  }
  return false;
}

export function getBestScores() {
  try {
    const raw = localStorage.getItem(KEYS.BEST_SCORES);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// Cache très léger des questions pour éviter de régénérer à chaud
export function saveCache(entry) {
  try {
    const cache = getCache();
    cache.unshift(entry);
    // Limite de 50 entrées max
    const trimmed = cache.slice(0, 50);
    localStorage.setItem(KEYS.CACHE, JSON.stringify(trimmed));
  } catch {}
}

export function getCache() {
  try {
    const raw = localStorage.getItem(KEYS.CACHE);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// Thème
export function saveTheme(theme) {
  try { localStorage.setItem('quiz_ia_theme', theme); } catch {}
}

export function getTheme() {
  return localStorage.getItem('quiz_ia_theme') || '';
}
