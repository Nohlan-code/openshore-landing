# Setup Lead Magnet — Le Site Qui Vend

Guide de mise en route en 4 étapes (~15 min total). À faire avant de promouvoir le lead magnet sur Insta.

---

## ARCHITECTURE

```
[Reel Insta] → commentaire mot-clé "GUIDE"
                       ↓
      [DM auto avec lien openshore.eu/guide]
                       ↓
       [guide.html → form opt-in]
                       ↓
        POST /api/lead-magnet
              ↓                    ↓
     [Google Sheet]         [Email Resend]
                                   ↓
                       [User reçoit le lien]
                                   ↓
              [openshore.eu/guide-contenu.html]
              [openshore.eu/le-site-qui-vend.pdf]
```

---

## ÉTAPE 1 — Préparer le Google Sheet (2 min)

1. Ouvrir le sheet : https://docs.google.com/spreadsheets/d/1KXlgSeIq8Q0o1HzLHtpoyEy17RBfSX3hV-EgNYGhhZY/edit
2. **Pas besoin d'ajouter les colonnes manuellement** — le code Apps Script les crée automatiquement à la première soumission.
3. Vérifier que le sheet est bien partagé en "Modification" pour ton compte (sinon Apps Script ne pourra pas écrire).

---

## ÉTAPE 2 — Déployer le Apps Script (5 min)

1. Dans le sheet, ouvrir **Extensions → Apps Script**
2. Supprimer le code par défaut (`function myFunction() {}`)
3. Ouvrir le fichier `apps-script.gs` (à la racine du repo openshore-landing) et **copier tout son contenu**
4. **Coller dans Apps Script** → Sauvegarder (icône disquette ou Cmd+S)
5. Cliquer sur **Déployer** (haut à droite) → **Nouveau déploiement**
6. Cliquer sur l'engrenage à côté de "Sélectionner le type" → choisir **Application Web**
7. Configurer :
   - Description : `OS Lead Magnet v1`
   - Exécuter en tant que : **Moi (ton.email@gmail.com)**
   - Qui a accès : **Tout le monde** (oui c'est nécessaire pour que Vercel puisse appeler)
8. Cliquer **Déployer**
9. Au premier déploiement, Google demande des autorisations → accepter (ignorer warning "non vérifié" → "Avancé" → "Accéder")
10. **Copier l'URL générée** (format : `https://script.google.com/macros/s/AKfycbx.../exec`)

⚠️ **Garde cette URL**, on en a besoin à l'étape 4.

---

## ÉTAPE 3 — Setup Resend pour les emails (3 min)

1. Aller sur https://resend.com → créer un compte (gratuit, 3000 emails/mois)
2. Aller dans **API Keys** → **Create API Key**
   - Nom : `Openshore Lead Magnet`
   - Permission : `Sending access`
   - Domain : laisser sur "All domains"
3. **Copier la clé** (format : `re_xxxxxxxx`)
4. **Optionnel mais recommandé** : aller dans **Domains** → ajouter `openshore.eu`
   - Resend te donne 3 enregistrements DNS (TXT, MX, CNAME) à ajouter dans le DNS de ton domaine
   - Une fois validé (24h max), tu pourras envoyer depuis `support@openshore.eu`
   - **Sans cette étape**, tes emails partent depuis `onboarding@resend.dev` (ça marche mais moins crédible)

---

## ÉTAPE 4 — Brancher Vercel (3 min)

1. Aller sur https://vercel.com → ton projet `openshore-landing`
2. **Settings → Environment Variables**
3. Ajouter ces 3 variables (toutes en "Production, Preview, Development") :

| Nom | Valeur |
|-----|--------|
| `GOOGLE_APPS_SCRIPT_URL` | L'URL copiée à l'étape 2 (https://script.google.com/macros/s/.../exec) |
| `RESEND_API_KEY` | La clé copiée à l'étape 3 (re_xxx) |
| `EMAIL_FROM` | `Openshore <support@openshore.eu>` (ou laisser vide si Resend pas vérifié) |

4. **Redéployer** : Deployments → ⋯ sur le dernier deploy → Redeploy

---

## ÉTAPE 5 — Tester de bout en bout (2 min)

1. Aller sur https://openshore.eu/guide
2. Renseigner ton email perso (gmail / autre que support@openshore.eu)
3. Vérifier que :
   - ✓ Le message de succès apparaît
   - ✓ La nouvelle ligne apparaît dans le Google Sheet
   - ✓ Tu reçois l'email avec le lien guide

Si l'email arrive pas en 2 min : vérifier les **logs Vercel** (Project → Functions → Logs) pour voir si Resend a renvoyé une erreur.

---

## INTÉGRATION INSTAGRAM (à faire dans ManyChat ou à la main)

### Option A : ManyChat (recommandé dès 5 commentaires/jour)

1. Compte ManyChat (~15$/mois pour Insta)
2. Créer un **Comment Trigger** sur ton compte Insta
3. Mot-clé déclencheur : `GUIDE` (case-insensitive)
4. Action : envoyer DM automatique avec le message :
   ```
   Salut ! Voilà le lien pour récupérer "Le Site Qui Vend" :
   👉 https://openshore.eu/guide
   
   Tu mets ton email, tu reçois tout en 30s.
   ```

### Option B : Manuel (au début, OK jusqu'à 30 commentaires/jour)

1. Activer les notifs Insta sur ton tel
2. Quand quelqu'un commente "GUIDE" : DM-le manuellement avec le lien
3. Garde un copier-coller du message dans tes notes

---

## FICHIERS LIVRÉS

| Fichier | Rôle |
|---------|------|
| `guide.html` | Page d'opt-in (où Insta envoie les visiteurs) |
| `guide-contenu.html` | Page web avec les 7 chapitres (accessible après opt-in) |
| `le-site-qui-vend.pdf` | Version PDF du guide (téléchargeable) |
| `api/lead-magnet.js` | Endpoint Vercel qui orchestre Sheet + Email |
| `apps-script.gs` | Code à coller dans Google Apps Script |
| `SETUP-LEAD-MAGNET.md` | Ce fichier |

---

## TROUBLESHOOTING

**Le form ne soumet pas / erreur 500**
→ Vérifier les env vars dans Vercel. Voir logs Functions.

**Google Sheet ne se remplit pas**
→ Re-déployer le Apps Script (même URL si tu choisis "Gérer les déploiements"). L'URL est valide tant que tu mets à jour le déploiement existant.

**Email pas reçu**
→ Vérifier dossier Spam. Si tu utilises pas un domaine Resend-vérifié, certains providers (Gmail Business, Outlook) peuvent bloquer.

**Le bouton dit "Lien en bio" sur Insta mais le lien ne marche pas**
→ Vercel peut prendre 30s à déployer après push. Attends + hard-refresh (Cmd+Shift+R).

---

## METRICS À TRACKER (sur 30 jours après lancement)

| Métrique | Bon | Excellent |
|----------|-----|-----------|
| Taux d'opt-in (visiteurs guide.html → soumissions) | >25% | >40% |
| Taux d'ouverture email | >55% | >70% |
| Taux de clic sur lien guide | >35% | >50% |
| Taux de réponse au mail (DM "veux qu'on fasse pour toi") | >2% | >5% |

Si l'opt-in est <25%, le hook du reel ou la promesse de la landing est faible.
Si l'ouverture est <55%, ton sender est en spam ou ton subject est nul.

---

✦ Openshore — Mai 2026
