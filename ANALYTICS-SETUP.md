# Openshore Analytics — Setup Guide

> Système d'analytics complet : 5 trackers + AI insights hebdo. Branch `feat/analytics-complete`.

---

## 1. Architecture en un coup d'œil

```
┌────────────────┐         ┌──────────────────────────────┐
│  Browser       │         │  Vercel Functions            │
│  ─────────     │         │  ──────────────              │
│  os-analytics  │────────►│  api/lead-magnet (PostHog)   │
│  - consent     │         │  api/checkout    (PostHog)   │
│  - PostHog     │         │  api/weekly-insights         │
│  - Clarity     │         │   ↳ Cron Mon 08:00 UTC       │
│  - GA4         │         │   ↳ pull PostHog             │
│  - Meta Pixel  │         │   ↳ Claude Sonnet 4.6        │
│  - Vercel WA   │         │   ↳ Resend email digest      │
└────────────────┘         └──────────────────────────────┘
        │
        ▼
   25+ events trackés
   (scroll, sections, CTAs,
    forms, rage clicks, errors)
```

---

## 2. Comptes à créer (15 minutes)

### A. PostHog Cloud EU (cœur du système)

1. Va sur https://eu.posthog.com/signup
2. Crée un compte avec `support@openshore.eu`
3. Crée un projet "openshore-eu"
4. Récupère :
   - **Project API Key** (publique, format `phc_xxxxxxxxxxxxxxxx`) → pour le client
   - **Project ID** (numérique, dans Settings → Project) → pour le serveur
5. Crée une **Personal API Key** (Settings → Personal API Keys) avec scope `query:read` + `project:read` → pour le serveur (cron AI)

### B. Microsoft Clarity (heatmaps gratuites illimitées)

1. https://clarity.microsoft.com → Sign in with Microsoft
2. New project → URL `openshore.eu`
3. Récupère le **Project ID** (10 caractères alphanumériques)

### C. Google Analytics 4

1. https://analytics.google.com → Admin → Create Property
2. Property name : "Openshore"
3. Choisis "Web" → URL `openshore.eu`
4. Récupère le **Measurement ID** (format `G-XXXXXXXXXX`)
5. (Optionnel) Lie à Search Console : Admin → Property Settings → Search Console Links

### D. Meta Pixel (Facebook/Instagram retargeting)

1. https://business.facebook.com → Events Manager → Connect Data Sources → Web → Pixel
2. Nom : "Openshore Pixel"
3. Récupère le **Pixel ID** (15-16 chiffres)
4. (Plus tard) Configure les Conversions API server-side via Stape sGTM déjà en place

### E. Anthropic API (pour l'AI weekly digest)

1. https://console.anthropic.com → API Keys → Create Key
2. Nom : "openshore-weekly-insights"
3. Récupère la clé (format Anthropic standard)

---

## 3. Variables d'environnement Vercel

Dans Vercel Dashboard → Project Settings → Environment Variables, ajoute :

| Variable | Valeur | Environnement |
|----------|--------|---------------|
| `POSTHOG_API_KEY` | Project API Key (publique, format phc_xxx) | Production |
| `POSTHOG_PROJECT_ID` | Numérique (ex: 12345) | Production |
| `POSTHOG_PERSONAL_API_KEY` | Personal API Key (format phx_xxx) | Production |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` | Production |
| `ANTHROPIC_API_KEY` | Anthropic API key | Production |
| `CRON_SECRET` | Random 32-char string (génère avec `openssl rand -hex 16`) | Production |
| `INSIGHTS_RECIPIENT` | `pounganohlan@gmail.com` (optionnel, default) | Production |

Les autres env vars (`RESEND_API_KEY`, `GOOGLE_APPS_SCRIPT_URL`, `STRIPE_SECRET_KEY`, `EMAIL_FROM`) sont déjà configurées.

```bash
# Génère un CRON_SECRET solide :
openssl rand -hex 16
```

---

## 4. Remplir les IDs publics dans le HTML

Les **6 fichiers HTML** ont chacun un bloc `<script>window.__osConfig = {...}</script>`. Remplis les valeurs :

```js
window.__osConfig = {
  posthogKey: '<TON_PROJECT_API_KEY>',
  posthogHost: 'https://eu.i.posthog.com',
  clarityId: '<TON_CLARITY_ID>',
  ga4Id: 'G-<TON_MEASUREMENT_ID>',
  metaPixelId: '<TON_PIXEL_ID>',
  page: 'home' // ne pas changer (varie par fichier)
};
```

**Fichiers à updater** :
- `index.html` (page: 'home')
- `blog.html` (page: 'blog')
- `landing-page-qui-convertit.html` (page: 'landing-recrutement')
- `guide.html` (page: 'guide-optin')
- `guide-contenu.html` (page: 'guide-contenu')
- `404.html` (page: '404')

**Bonnes nouvelles** : si tu laisses les valeurs vides, le tracker correspondant ne charge pas → pas d'erreur. Tu peux donc activer un tracker à la fois.

---

## 5. Event taxonomy (référence)

Tous les events trackés automatiquement par `os-analytics.js` :

### Pages & navigation
- `page_view` — chargement de page
- `page_left` — départ de page (avec `duration_s`)
- `nav_click` — clic sur menu navigation
- `time_on_page` — buckets 10/30/60/120/300s

### Scroll & visibilité
- `scroll_depth` — atteint 25/50/75/100%
- `section_hero_viewed` / `section_pricing_viewed` / `section_faq_viewed` / etc.

### CTAs
- `cta_calendly_click` — bouton Calendly
- `cta_commande_click` — "Configurer ma commande"
- `cta_whatsapp_click` — lien WhatsApp
- `cta_recrutement_click` — bouton Recrutement
- `cta_email_click` / `cta_phone_click`
- `vsl_play_click` — play VSL

### Conversions
- `lead_magnet_submitted` (client + server)
- `checkout_initiated` (client + server)
- `form_started` / `form_submitted`

### Friction
- `rage_click` — 3+ clics rapprochés au même endroit
- `dead_click` — clic sur un élément non-cliquable
- `js_error` / `js_promise_rejection`
- `outbound_click` — clic vers domaine externe

### Consentement
- `consent_granted` (avec catégories)

### Custom — ajouter sur n'importe quel élément
```html
<button data-track="custom_event_name" data-track-prop-pack="premium">CTA</button>
```
→ envoie `custom_event_name` avec `{ pack: 'premium' }`

---

## 6. Tester le système

### A. Tester le tracking client (en local)

```bash
cd ~/Desktop/Openshore/CLAUDE/openshore-landing
python3 -m http.server 8765
# Ouvre http://localhost:8765 dans Chrome
# Ouvre DevTools → Network → filtre "posthog"
# Click partout, scroll, vois les events partir
```

### B. Tester la weekly insight en production

```bash
curl "https://openshore.eu/api/weekly-insights?secret=<TON_CRON_SECRET>"
# Devrait retourner { ok: true, ... } et déclencher l'email
```

### C. Vérifier la Cron Vercel

Vercel Dashboard → Project → Settings → Cron Jobs → tu devrais voir :
- `/api/weekly-insights` schedulé `0 8 * * 1` (every Monday 08:00 UTC = 09:00/10:00 Paris)

Pour forcer manuellement : Vercel Dashboard → Crons → Click "Trigger".

---

## 7. PostHog dashboards à configurer (10 min de clic-clic)

Une fois PostHog actif et events qui arrivent, configure 5 funnels dans PostHog UI :

### Funnel 1 : Landing → Conversion
1. `page_view` (where path = '/')
2. `section_pricing_viewed`
3. `cta_calendly_click` OR `cta_commande_click` OR `cta_whatsapp_click`

### Funnel 2 : Lead Magnet
1. `page_view` (where path contains 'guide')
2. `form_started`
3. `form_submitted`
4. `lead_magnet_submitted` (server-side)

### Funnel 3 : Checkout
1. `section_pricing_viewed`
2. `cta_commande_click`
3. `checkout_initiated`

### Funnel 4 : Engagement
1. `page_view`
2. `scroll_depth` (where depth_pct >= 50)
3. `section_pricing_viewed`

### Funnel 5 : Blog → Landing
1. `page_view` (where path = '/blog')
2. `outbound_click` OR `nav_click` (where target = 'pricing')

---

## 8. Coûts mensuels estimés

| Service | Plan | Coût/mois |
|---------|------|-----------|
| PostHog EU | Free (1M events) | 0 € |
| Microsoft Clarity | Free | 0 € |
| Google Analytics 4 | Free | 0 € |
| Meta Pixel | Free | 0 € |
| Vercel Web Analytics | Hobby (inclus) | 0 € |
| Vercel Cron | Hobby (inclus) | 0 € |
| Anthropic API (Claude Sonnet 4.6, weekly call) | Pay-as-you-go | ~1-2 €/mois |
| Resend (déjà en place) | Free (3k emails/mois) | 0 € |
| **Total** | | **~1-2 €/mois** |

---

## 9. Désinstallation / opt-out utilisateur

L'utilisateur peut :
- Cliquer "Essentiel uniquement" dans le banner → aucun tracker chargé
- Visiter `/politique-confidentialite` → bouton "Modifier mes préférences cookies"
- Supprimer le localStorage clé `os_consent_v1` dans DevTools → banner reapparaît

Le banner reapparaît tous les 12 mois (TTL implicite via `os_consent_v1.ts`).

---

## 10. Roadmap d'évolution

Quand le trafic dépassera 1k visiteurs/mois :
- Activer les **PostHog Feature Flags** pour vrais A/B tests
- Migrer Meta Pixel → **Conversions API server-side** via Stape sGTM (déjà en place sur `sst.openshore.eu`)
- Ajouter PostHog **Surveys** in-app (NPS, exit intent)
- Connecter PostHog → Slack pour alertes temps réel

---

**Dernière mise à jour** : 12 mai 2026 · branch `feat/analytics-complete`
