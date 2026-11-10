# GInI Innovation Implementation Impact Survey — plateforme ICESCO

Plateforme de collecte et d’analyse conforme aux deux documents de référence :
le **questionnaire** (*GInI Innovation Implementation Impact Survey*) et le **guide d’administration et de notation** (*Administration and Scoring Guide*).

**Stack :** React 18 + Vite (frontend) · Express.js 4 sur Node 20 (API) · MySQL 8 (base de données).

```
frontend/                React/Vite : parcours répondant + console administrateur (#/admin)
  e2e/smoke.cjs          20 vérifications navigateur (Playwright)
backend/                 API Express : consentement, sauvegarde/reprise, soumission, notation, agrégation, exports
  instrument.json        Source unique : 243 items verbatim, routage par rôle, indices, échelles, glossaire
  src/app.js             Routes HTTP
  src/scoring.js         Règles de calcul du guide (§7, §8, §10, §11, §12)
  src/db.js              Connexion MySQL et création des tables
  src/instrument.js      Lecture de instrument.json, routage, libellés
  test/api.test.js       Tests (node:test) : instrument, notation, parcours complet
  privacy_notice.md      Notice de confidentialité (modèle à compléter)
```

## Démarrage

**Production (Docker : Node + MySQL 8)**
```bash
cd backend
cp .env.example .env          # définir MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD et ADMIN_TOKEN
# compléter privacy_notice.md (obligatoire avant déploiement)
docker compose up -d --build  # http://serveur:8000  ·  console : http://serveur:8000/#/admin
```
Les tables sont créées automatiquement au premier démarrage.

**Sans Docker (MySQL existant)**
```sql
CREATE DATABASE gini CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gini'@'%' IDENTIFIED BY '<mot de passe>';
GRANT ALL ON gini.* TO 'gini'@'%';
```
```bash
cd frontend && npm install && npm run build
cd ../backend && npm install --omit=dev
DATABASE_URL=mysql://gini:<mot de passe>@localhost:3306/gini ADMIN_TOKEN=<jeton> \
  STATIC_DIR=../frontend/dist node src/server.js        # :8000 (API + frontend)
```

**Développement**
```bash
cd backend && npm install && DATABASE_URL=mysql://gini:gini@127.0.0.1:3306/gini ADMIN_TOKEN=dev npm run dev   # API :8000
cd frontend && npm install && npm run dev                                                                    # :5173 (proxy /api → :8000)
```

**Tests**
```bash
cd backend && DATABASE_URL=mysql://gini:gini@127.0.0.1:3306/gini_test npm test   # base de test vidée à chaque lancement
node frontend/e2e/smoke.cjs http://localhost:8000 ./shots                       # nécessite Playwright
```

## Variables d’environnement (backend)

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion MySQL `mysql://user:pass@host:3306/base` | obligatoire |
| `ADMIN_TOKEN` | Jeton de la console administrateur | vide = console désactivée |
| `REQUIRE_REGISTERED_ORG` | Refuser les codes organisation non créés par l’admin | `true` |
| `CONSENT_VERSION` | Version de notice enregistrée avec chaque consentement | `1` |
| `PRIVACY_NOTICE_FILE` | Notice affichée aux répondants | `backend/privacy_notice.md` |
| `STATIC_DIR` | Dossier du frontend compilé servi par Express | non servi |
| `PORT` | Port HTTP | `8000` |

## Modifier le questionnaire

Le texte des questions, le routage par rôle, les seuils et le glossaire sont dans `backend/instrument.json`, lu par l’API et envoyé au frontend. Toute modification doit incrémenter `version` ; cette version est enregistrée sur chaque réponse.

## Déroulement d’une étude

1. Console admin → enregistrer le **code organisation** avec unité, période, périmètre et bénéficiaires externes (Guide §4).
2. Transmettre le code aux répondants. Chacun choisit son rôle, lit la notice et donne son consentement, puis reçoit un **code de reprise** (sauvegarde automatique, reprise depuis n’importe quel appareil).
3. Suivre l’avancement dans la console (soumis / brouillons).
4. **Clôturer** l’organisation avant la réunion de réconciliation (§5 étape 12), puis **figer le jeu de données** (JSON daté + empreinte SHA-256, §5 étape 14).
5. Tableau de bord §13 : coter **CCS** par initiative et **GICS** au niveau programme après revue des preuves, puis exporter.

## Matrice de conformité

| Exigence (source) | Mise en œuvre |
|---|---|
| Sections A–L complètes + déclaration (Questionnaire) | A1–A22, B1–B16, C1–C27, D1–D12, E1–E28, F1–F31, G1a–n + registre G.1, G.2, G3a–j, H1–H13, I1–I11 + action 90 jours, J1–J17, K1–K16, L0a/L0b + L1–L15, déclaration. Textes verbatim (test automatique). |
| Routage par rôle (Questionnaire « Role Routing ») | Modules par rôle. La partie prenante affectée ne voit que **F3–F12** et **K5–K6** (Guide §17). « Other » → A et I. |
| Section L conditionnelle (Guide §5.2) | L1–L15 affichés seulement si L0a = Oui/Partiellement ; sinon L0b. |
| Fiches d’initiatives (Guide §5 étape 07) | Section F répétable (jusqu’à 10 initiatives, y compris arrêtées ou mitigées). |
| DK / NA / Not Available distincts, jamais forcés (Guide §6, §17) | Proposés sur chaque item ; « Not assessable », « Not Undertaken » là où le questionnaire les prévoit. |
| Codes numériques + libellés, variables stables (Guide §17) | Export long : `value_code` + `value_label` ; variables `C07`, `E24`, `G3a`, `K11`. Dictionnaire de codes exportable. |
| Consentement, notice, codes anonymes (Survey ; Guide §5 étapes 04–05, §15) | Consentement obligatoire et versionné ; code répondant anonyme ; contacts dans une table séparée avec export séparé. |
| Plateforme sécurisée, sauvegarde et reprise, validation (Guide §17) | API Express + MySQL ; code de reprise haché (SHA-256) ; validation serveur (déclaration, période, Top 3 ≤ 3, règle d’impact externe). |
| Règle d’impact externe (Survey ; Guide §12.1, §16) | Soumission bloquée sans résultat externe (F27 / classification G.2) ou justification de non-applicabilité. |
| Indices GIF, IPM, IEQ, FSC, PSI (Guide §7–8) | Moyennes de domaines puis moyenne non pondérée × 25 ; seuils (≥5/6, ≥70 %, ≥9/12, ≥2 items/domaine) ; DK/NA exclus ; 1 décimale ; libellés neutres ; C25–C27 restitués item par item ; domaines FSC affichés avant la valeur globale. |
| Pas de score global ; E0–E5 non numériques (Guide §7.1) | Aucun total ; niveaux de preuve traités comme catégories. |
| Agrégation multi-répondants (Guide §11) | Médianes intra-rôle, puis poids égal par rôle ; médiane + écart interquartile ; signalement si écart de rôles ≥2 ou étendue ≥3. |
| Informateur unique ou limité (Guide §4.1) | Moins de 3 perspectives internes → libellé affiché et interprétation CCS plafonnée à « plausible ». |
| CCS et GICS (Guide §10) | Grilles d’analyste dans la console, score × 25 et interprétation par bandes. |
| Tableau de bord (Guide §13) | 14 panneaux : mise en œuvre, pratiques, prospective, durabilité, résultats G1 (non moyennés), G2/G3, CCS, L/GICS, contexte H, disponibilité des preuves J (cœur / avancé / externe), équité et effets négatifs, actions, maturité de la preuve A13–A22, impact externe. |
| Barrières de qualité (Guide §16) | Portes calculables affichées (périmètre, couverture, équilibre, impact externe, reproductibilité) ; les autres sont signalées pour revue humaine. |
| Clôture et gel des données (Guide §5 étapes 12, 14) | Organisation clôturée = plus de modifications ; instantané JSON daté + SHA-256 ; version de l’instrument enregistrée sur chaque réponse. |
| Glossaire et aide (Questionnaire Annexe A ; Guide §17.1) | 85 termes extraits du PDF ; aide au survol ou au focus à la première occurrence ; panneau de recherche. |
| Accessibilité (Guide §15) | Contrôles natifs (navigation clavier), libellés lisibles par lecteur d’écran, focus visible, repères non liés à la couleur, mise en page mobile, mode sombre. |

## Points restant à la charge de l’équipe d’étude

- **Notice de confidentialité** : `backend/privacy_notice.md` est un modèle à compléter (responsable du traitement, base légale, durée de conservation, droit de retrait).
- **Traductions FR/AR** : non incluses. Le guide (§15) exige une traduction directe, une revue d’experts et des tests cognitifs, pas une traduction littérale.
- **Pilote et validation psychométrique** (§15) : 5 à 10 personnes par rôle, puis analyse de fiabilité et de validité. Ce sont des activités d’étude, pas des fonctionnalités logicielles.
- **Divergence entre les deux PDF sur le module I** : le guide §17 l’affiche pour tous les rôles, le questionnaire non. Le routage suit le questionnaire ; pour changer, modifier `roles` dans `backend/instrument.json`.
- **Interprétation du seuil « ≥2 items/domaine »** : un domaine sous ce seuil suspend l’indice, sauf un domaine entièrement marqué NA (exclu comme non applicable).
- Déployer derrière HTTPS (reverse proxy) et utiliser un `ADMIN_TOKEN` long et aléatoire.
