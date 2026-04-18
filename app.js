// app.js — Logique principale du quiz

import { generateQuestions, verifyApiKey, getMoreInfo, ApiError } from './api.js';
import {
  saveApiKey, getApiKey, clearApiKey,
  savePrefs, getPrefs,
  saveBestScore, getBestScores,
  saveTheme, getTheme,
} from './storage.js';

// ===== État global =====
const state = {
  config: null,           // { category, difficulty, language, count }
  questions: [],          // toutes les questions rencontrées
  currentIdx: 0,
  score: 0,
  streak: 0,
  startTime: 0,
  answers: [],            // { question, correct, userChoice, correctAnswer, options, explanation }
  preloading: false,      // lock sur la génération en arrière-plan
  unlimited: false,
  stopped: false,
};

const BATCH_SIZE = 5;
const PRELOAD_THRESHOLD = 2; // on relance quand il reste ≤ 2 questions en buffer

// ===== Éléments DOM =====
const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  quiz: $('screen-quiz'),
  results: $('screen-results'),
};

// ===== Initialisation =====
function init() {
  applyInitialTheme();
  hydrateForm();
  hydrateApiKey();
  renderBestScores();
  bindEvents();
}

function applyInitialTheme() {
  const saved = getTheme();
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

// Bridge entre les pill-buttons segmentés et un <select hidden> que lit le form.
function wireSeg(segId, hiddenId) {
  const seg = document.getElementById(segId);
  const hidden = document.getElementById(hiddenId);
  if (!seg || !hidden) return;
  const initial = hidden.value;
  seg.querySelectorAll('button').forEach(b => {
    const on = b.getAttribute('data-val') === initial;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    const v = btn.getAttribute('data-val');
    seg.querySelectorAll('button').forEach(b => {
      const on = b === btn;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    hidden.value = v;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function hydrateForm() {
  const prefs = getPrefs();
  if (prefs.category) {
    const opt = [...$('category').options].find(o => o.value === prefs.category);
    if (opt) $('category').value = prefs.category;
    else {
      $('category').value = '__custom__';
      $('category-custom').style.display = 'block';
      $('category-custom').value = prefs.category;
    }
  }
  if (prefs.difficulty) $('difficulty').value = prefs.difficulty;
  if (prefs.language) $('language').value = prefs.language;
  if (prefs.count !== undefined) $('count').value = String(prefs.count);

  wireSeg('difficulty-seg', 'difficulty');
  wireSeg('count-seg', 'count');
}

function hydrateApiKey() {
  const key = getApiKey();
  if (key) {
    $('api-key').value = key;
    setKeyStatus('Clé enregistrée ✓', 'ok');
  }
}

function renderBestScores() {
  const container = $('best-scores');
  const scores = getBestScores();
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (entries.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <h3>Meilleurs scores</h3>
    <div class="best-scores-list">
      ${entries.map(([k, v]) => `
        <div class="best-score-item">
          <span>${escapeHtml(k)}</span>
          <strong>${v}%</strong>
        </div>
      `).join('')}
    </div>
  `;
}

// ===== Événements =====
function bindEvents() {
  $('theme-toggle').addEventListener('click', toggleTheme);

  $('save-key').addEventListener('click', onSaveKey);
  $('api-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onSaveKey(); }
  });

  $('category').addEventListener('change', (e) => {
    $('category-custom').style.display = e.target.value === '__custom__' ? 'block' : 'none';
  });

  $('quiz-form').addEventListener('submit', onStartQuiz);

  $('next-btn').addEventListener('click', nextQuestion);
  $('stop-btn').addEventListener('click', stopQuiz);
  $('retry-btn').addEventListener('click', retryCurrentBatch);
  $('more-info-btn').addEventListener('click', onMoreInfo);

  $('replay-btn').addEventListener('click', replay);
  $('home-btn').addEventListener('click', goHome);

  $('reset-key').addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Supprimer la clé API enregistrée ?')) {
      clearApiKey();
      $('api-key').value = '';
      setKeyStatus('Clé supprimée.', '');
    }
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let next;
  if (current === 'dark') next = 'light';
  else if (current === 'light') next = 'dark';
  else next = prefersDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  saveTheme(next);
}

async function onSaveKey() {
  const key = $('api-key').value.trim();
  if (!key) {
    setKeyStatus('Entrez votre clé.', 'err');
    return;
  }
  setKeyStatus('Vérification...', '');
  const result = await verifyApiKey(key);
  if (result.ok) {
    saveApiKey(key);
    setKeyStatus('Clé valide et enregistrée ✓', 'ok');
  } else {
    setKeyStatus(result.reason || 'Clé invalide.', 'err');
  }
}

function setKeyStatus(msg, kind) {
  const el = $('key-status');
  el.textContent = msg;
  el.className = 'key-status' + (kind ? ' ' + kind : '');
}

// ===== Démarrage d'un quiz =====
async function onStartQuiz(e) {
  e.preventDefault();

  const apiKey = getApiKey() || $('api-key').value.trim();
  if (!apiKey) {
    setKeyStatus('Veuillez entrer et enregistrer une clé API.', 'err');
    $('api-key').focus();
    return;
  }
  // Si l'utilisateur a tapé sans cliquer Sauver
  if (!getApiKey()) saveApiKey(apiKey);

  let category = $('category').value;
  if (category === '__custom__') {
    category = $('category-custom').value.trim();
    if (!category) {
      alert('Entrez une catégorie personnalisée.');
      return;
    }
  }
  const difficulty = $('difficulty').value;
  const language = $('language').value;
  const count = parseInt($('count').value, 10);

  savePrefs({ category, difficulty, language, count });

  state.config = { category, difficulty, language, count };
  state.unlimited = count === 0;
  state.questions = [];
  state.currentIdx = 0;
  state.score = 0;
  state.streak = 0;
  state.answers = [];
  state.stopped = false;
  state.startTime = Date.now();

  switchScreen('quiz');
  $('error-panel').style.display = 'none';
  showLoading(true);

  try {
    const firstBatch = await fetchBatch(Math.min(BATCH_SIZE, state.unlimited ? BATCH_SIZE : count));
    state.questions = firstBatch;
    showLoading(false);
    renderQuestion();
    maybePreload();
  } catch (err) {
    showError(err);
  }
}

// Normalisation simple pour détecter des doublons quasi-identiques côté client
function normalizeSig(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBatch(n) {
  const apiKey = getApiKey();
  // On envoie TOUTES les questions déjà vues comme liste noire (l'API tronque à 40)
  const previousQuestions = state.questions.map(q => q.question);
  const existingSigs = new Set(previousQuestions.map(normalizeSig));

  // Jusqu'à 2 tentatives pour obtenir un batch non-dupliqué
  for (let i = 0; i < 2; i++) {
    const batch = await generateQuestions({
      apiKey,
      category: state.config.category,
      difficulty: state.config.difficulty,
      language: state.config.language,
      count: n,
      previousQuestions,
    });
    // Filtre côté client contre les questions déjà posées
    const fresh = batch.filter(q => {
      const sig = normalizeSig(q.question);
      if (existingSigs.has(sig)) return false;
      existingSigs.add(sig);
      return true;
    });
    if (fresh.length > 0) return fresh;
    // Sinon tout était dupliqué → on retente
  }
  throw new Error('Trop de doublons — essayez une catégorie plus large.');
}

async function maybePreload() {
  if (state.preloading || state.stopped) return;
  const remaining = state.questions.length - state.currentIdx - 1;
  const target = state.unlimited ? Infinity : state.config.count;
  const alreadyGenerated = state.questions.length;

  // Si on a déjà assez de questions pour un quiz borné, stop
  if (!state.unlimited && alreadyGenerated >= target) return;

  if (remaining <= PRELOAD_THRESHOLD) {
    state.preloading = true;
    try {
      const needed = state.unlimited
        ? BATCH_SIZE
        : Math.min(BATCH_SIZE, target - alreadyGenerated);
      if (needed > 0) {
        const more = await fetchBatch(needed);
        state.questions.push(...more);
      }
    } catch (err) {
      console.warn('Preload failed:', err);
      // Ne bloque pas le quiz si c'est juste un préload ; on retentera
    } finally {
      state.preloading = false;
    }
  }
}

// ===== Rendu d'une question =====
function renderQuestion() {
  const q = state.questions[state.currentIdx];
  if (!q) {
    // Pas de question dispo : on attend
    showLoading(true);
    waitForQuestion();
    return;
  }

  showLoading(false);
  $('question-content').style.display = 'block';

  const totalLabel = state.unlimited ? '∞' : state.config.count;
  $('question-counter').textContent = `Question ${state.currentIdx + 1} / ${totalLabel}`;
  $('score-display').textContent = `Score: ${state.score}`;

  if (state.streak >= 3) {
    $('streak-display').textContent = `↗ ${state.streak} d'affilée`;
    $('streak-display').style.display = 'inline-block';
  } else {
    $('streak-display').style.display = 'none';
  }

  const progress = state.unlimited
    ? Math.min(100, (state.currentIdx / Math.max(10, state.currentIdx + 1)) * 100)
    : ((state.currentIdx) / state.config.count) * 100;
  $('progress-fill').style.width = progress + '%';

  $('question-text').textContent = q.question;

  const container = $('options-container');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn';
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
    btn.addEventListener('click', () => onAnswer(i, btn));
    container.appendChild(btn);
  });

  $('feedback').style.display = 'none';
  $('next-btn').style.display = 'none';

  // Reset de la zone "En savoir plus"
  const moreBtn = $('more-info-btn');
  const moreContent = $('more-info-content');
  moreBtn.disabled = false;
  moreBtn.textContent = 'En savoir plus sur la réponse';
  moreBtn.style.display = 'inline-block';
  moreContent.style.display = 'none';
  moreContent.classList.remove('error');
  moreContent.textContent = '';
}

async function onMoreInfo() {
  const q = state.questions[state.currentIdx];
  if (!q) return;

  const btn = $('more-info-btn');
  const content = $('more-info-content');

  btn.disabled = true;
  btn.textContent = '⏳ Chargement...';
  content.style.display = 'block';
  content.classList.remove('error');
  content.textContent = 'Recherche des détails...';

  try {
    const info = await getMoreInfo({
      apiKey: getApiKey(),
      question: q.question,
      answer: q.options[q.correctAnswer],
      language: state.config.language,
    });
    content.textContent = info;
    btn.style.display = 'none'; // on masque le bouton une fois chargé
  } catch (err) {
    content.classList.add('error');
    let msg = err.message || 'Erreur lors du chargement.';
    if (err instanceof ApiError && err.code === 'RATE_LIMIT') msg = '⏳ ' + err.message;
    content.textContent = msg;
    btn.disabled = false;
    btn.textContent = 'Réessayer';
  }
}

async function waitForQuestion() {
  // Attend que le préload livre quelque chose — avec timeout
  const start = Date.now();
  while (!state.questions[state.currentIdx] && Date.now() - start < 30000) {
    if (!state.preloading) {
      try { await fetchBatch(BATCH_SIZE).then(qs => state.questions.push(...qs)); }
      catch (err) { showError(err); return; }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (state.questions[state.currentIdx]) renderQuestion();
  else showError(new Error('Génération trop lente. Réessayez.'));
}

function onAnswer(choiceIdx, btn) {
  const q = state.questions[state.currentIdx];
  const correct = choiceIdx === q.correctAnswer;

  // Désactive tous les boutons et les colore
  const buttons = $('options-container').querySelectorAll('.option-btn');
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === q.correctAnswer) b.classList.add('correct');
    else if (i === choiceIdx) b.classList.add('wrong');
  });

  // Feedback
  const fb = $('feedback');
  fb.style.display = 'block';
  fb.className = 'feedback ' + (correct ? 'correct' : 'wrong');
  $('feedback-text').textContent = correct ? '✓ Bonne réponse !' : `✗ Mauvaise réponse. La bonne : ${q.options[q.correctAnswer]}`;
  $('explanation').textContent = q.explanation || '';

  // Score & streak
  if (correct) {
    state.score++;
    state.streak++;
  } else {
    state.streak = 0;
  }
  $('score-display').textContent = `Score: ${state.score}`;

  state.answers.push({
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    userChoice: choiceIdx,
    correct,
    explanation: q.explanation,
  });

  $('next-btn').style.display = 'inline-block';
  $('next-btn').focus();

  // Préload en arrière-plan
  maybePreload();
}

function nextQuestion() {
  state.currentIdx++;
  const done = !state.unlimited && state.currentIdx >= state.config.count;
  if (done) {
    showResults();
  } else {
    renderQuestion();
  }
}

function stopQuiz() {
  if (state.answers.length === 0) {
    if (confirm('Annuler ce quiz ? Aucun score ne sera sauvegardé.')) {
      state.stopped = true;
      goHome();
    }
    return;
  }
  if (confirm('Terminer le quiz maintenant ?')) {
    state.stopped = true;
    showResults();
  }
}

function retryCurrentBatch() {
  $('error-panel').style.display = 'none';
  showLoading(true);
  fetchBatch(BATCH_SIZE)
    .then(qs => {
      state.questions.push(...qs);
      renderQuestion();
    })
    .catch(err => showError(err));
}

// ===== Résultats =====
function showResults() {
  const total = state.answers.length;
  const percent = total > 0 ? Math.round((state.score / total) * 100) : 0;
  const elapsedSec = Math.round((Date.now() - state.startTime) / 1000);

  $('final-score').textContent = `${state.score} / ${total}`;
  $('final-percent').textContent = `${percent}%`;
  $('final-time').textContent = formatTime(elapsedSec);

  const reviewList = $('review-list');
  reviewList.innerHTML = state.answers.map((a, i) => `
    <div class="review-item ${a.correct ? 'ok' : 'ko'}">
      <span class="review-icon ${a.correct ? 'ok' : 'ko'}">${a.correct ? '✓' : '✗'}</span>
      <div>
        <strong>Q${i + 1}.</strong> ${escapeHtml(a.question)}
        ${!a.correct ? `<br><small>Réponse : ${escapeHtml(a.options[a.correctAnswer])}</small>` : ''}
      </div>
    </div>
  `).join('');

  // Sauvegarde du meilleur score (seulement si quiz complet ou >= 5 questions)
  if (total >= 5) {
    saveBestScore(state.config.category, state.config.difficulty, percent);
  }

  switchScreen('results');
}

function replay() {
  $('quiz-form').dispatchEvent(new Event('submit'));
}

function goHome() {
  state.stopped = true;
  renderBestScores();
  switchScreen('home');
}

// ===== Utilitaires =====
function switchScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  window.scrollTo(0, 0);
}

function showLoading(on) {
  $('loading-question').style.display = on ? 'flex' : 'none';
  $('question-content').style.display = on ? 'none' : 'block';
  $('error-panel').style.display = 'none';
}

function showError(err) {
  showLoading(false);
  $('question-content').style.display = 'none';
  const panel = $('error-panel');
  panel.style.display = 'block';
  let msg = err.message || 'Une erreur est survenue.';
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_KEY') msg = '⚠️ ' + err.message + ' Retournez à l\'accueil pour corriger.';
    else if (err.code === 'RATE_LIMIT') msg = '⏳ ' + err.message;
  }
  $('error-text').textContent = msg;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Boot
init();
