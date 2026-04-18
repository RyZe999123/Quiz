# 🧠 Quiz IA — Questions illimitées

Un site de quiz **ultra léger** (HTML + CSS + JS vanilla, zéro dépendance) qui génère des questions à la volée via l'API gratuite de **Groq**.

- ⚡ **Rapide** : Groq renvoie les questions en quelques centaines de ms
- 🔒 **Privé** : votre clé API ne quitte jamais votre navigateur
- 📦 **Léger** : ~30 KB total, pas de framework, pas de build
- ♾️ **Illimité** : préchargement en arrière-plan pour un flux continu
- 🌓 **Dark mode** auto + toggle manuel

## 🚀 Démarrage rapide (30 secondes)

### 1. Obtenez une clé API Groq gratuite

1. Allez sur [console.groq.com/keys](https://console.groq.com/keys)
2. Connectez-vous (Google / GitHub, aucune carte bancaire)
3. Cliquez sur **Create API Key**
4. Copiez la clé (commence par `gsk_...`)

Le plan gratuit est **largement suffisant** pour des milliers de questions.

### 2. Lancez le site localement

```bash
# Option 1 : juste ouvrir le fichier
# Ouvrez index.html dans votre navigateur

# Option 2 : serveur local (recommandé — les modules ES nécessitent http://)
python3 -m http.server 8000
# puis ouvrez http://localhost:8000

# Ou avec Node :
npx serve .
```

> ⚠️ Les modules ES (`import`) imposent un contexte HTTP — ouvrir directement `file://index.html` peut ne pas fonctionner selon le navigateur. Utilisez un serveur local ou déployez.

### 3. Jouez

Collez votre clé API, choisissez une catégorie, un niveau, et c'est parti !

## 📦 Structure

```
/
├── index.html       # Structure HTML (3 écrans : accueil, quiz, résultats)
├── style.css        # Style minimaliste, ~5 KB
├── app.js           # Logique principale du quiz
├── api.js           # Appels Groq (avec retry + fallback modèle)
├── storage.js       # localStorage (clé API légèrement obfusquée + prefs + scores)
├── vercel.json      # Config de déploiement
└── README.md
```

## 🌐 Déploiement

### Vercel (recommandé)

```bash
npm i -g vercel
vercel --prod
```

Le fichier `vercel.json` est déjà configuré pour servir les fichiers statiques.

### GitHub Pages

```bash
git init && git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/<user>/quiz-ia.git
git push -u origin main
```

Puis dans **Settings → Pages**, sélectionnez la branche `main` et `/ (root)`.

### Netlify

Drag & drop du dossier sur [app.netlify.com/drop](https://app.netlify.com/drop) — c'est tout.

## 🔑 Sécurité de la clé API

La clé est stockée en localStorage **après un XOR + Base64** — ce n'est pas du chiffrement fort (quelqu'un avec un accès à votre machine et un peu de JS pourrait la lire), juste un rideau pour éviter de l'afficher en clair. Pour un usage publique avec beaucoup d'utilisateurs, préférez une fonction serverless qui proxifie les appels côté serveur.

## 🤖 Modèle utilisé

- **Principal** : `llama-3.3-70b-versatile` (précis, un peu plus lent)
- **Fallback auto** : `llama-3.1-8b-instant` (ultra rapide)

Changez-les dans [api.js](api.js) si besoin.

## 📝 Licence

MIT — faites-en ce que vous voulez.
