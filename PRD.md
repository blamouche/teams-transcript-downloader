# PRD — Teams Transcript Downloader (V3)

> **Product Requirements Document**
> Produit : extension Chrome (Manifest V3) de téléchargement automatique des transcripts de réunions Microsoft Teams.
> Version de référence : **V3** (`v3/`, manifest `3.0.22`) — version recommandée et activement maintenue.
> Statut du document : vivant. Dernière mise à jour : 2026-06-23.

---

## 1. Résumé exécutif

La version web de Microsoft Teams affiche les transcripts de réunions (vue *Recap*) mais
n'offre **aucun bouton de téléchargement natif**. Récupérer manuellement chaque transcript
est fastidieux : ouvrir chaque réunion, dérouler le récapitulatif, l'onglet transcription,
faire défiler toute la liste virtualisée, copier le contenu.

**Teams Transcript Downloader V3** automatise entièrement ce processus. L'utilisateur active
l'automatisation depuis un **panneau latéral attaché à l'onglet Teams** (comportement type
extension Claude) ; un **service worker** scanne en arrière-plan les N premières discussions
de réunion, extrait chaque transcript et le télécharge en `.txt`, **même panneau fermé et sans
que l'onglet Teams soit au premier plan**. Une **déduplication robuste** (basée sur l'identité
de la réunion : thread Teams + date/heure d'occurrence) garantit qu'un transcript n'est jamais
téléchargé deux fois.

---

## 2. Contexte & problème

- **Pas de téléchargement natif** : Teams web n'expose pas d'export du transcript.
- **DOM complexe et instable** : le transcript vit dans une **iframe Recap** (origine
  Microsoft/SharePoint variable), la liste est **virtualisée** (seules les lignes visibles
  sont dans le DOM), et les `class`/`data-tid` de Teams évoluent.
- **Réunions récurrentes** : une même réunion porte plusieurs occurrences ; sans ciblage de
  l'occurrence, on extrait le mauvais transcript ou rien.
- **Volume** : un utilisateur peut avoir des dizaines de réunions à archiver régulièrement →
  besoin d'automatisation en lot, répétée, sans intervention.

### Historique des versions (contexte produit)

| Version | Statut | Apport |
|---|---|---|
| **V1** | Déprécié | Extraction **manuelle** : l'utilisateur ouvre le panneau Transcript, clique *Extraire*. |
| **V2** | Déprécié | V1 + **automatisation en arrière-plan** (service worker), pilotée depuis une **popup**. |
| **V3** | **Actif** | V2 + **panneau latéral par onglet** (`chrome.sidePanel`) + **voile de protection** + **déduplication par identité de réunion** + **journal des scans**. |

V3 est un sur-ensemble fonctionnel de V2, lui-même sur-ensemble de V1.

---

## 3. Objectifs & critères de succès

### Objectifs produit
1. **Zéro friction** : l'utilisateur active une fois l'automatisation ; tout se fait en fond.
2. **Exhaustivité** : extraire l'intégralité de chaque transcript malgré la virtualisation.
3. **Idempotence** : ne jamais re-télécharger un transcript déjà récupéré.
4. **Non-intrusif** : ne pas perturber l'usage normal de Teams par l'utilisateur.
5. **Robustesse** : survivre aux variations de DOM, aux échecs de chargement, à la mise en
   veille du service worker.

### Critères de succès (mesurables)
- **Taux d'extraction complète** : ≥ 95 % des réunions disposant d'un transcript produisent un
  fichier ≥ 10 Ko (seuil `MIN_TRANSCRIPT_BYTES`).
- **Taux de doublon** : 0 transcript téléchargé deux fois sur des scans répétés.
- **Continuité** : un scan en cours se termine même panneau fermé / onglet non actif.
- **Réactivité de l'arrêt** : un *Stop* interrompt le scan en cours en < 1 s perçue.

### Indicateurs non-objectifs
- Pas de précision « parfaite » sur l'horodatage par ligne (best-effort par regex).
- Pas de support garanti hors Chrome / Chromium (Manifest V3, `chrome.sidePanel` ≥ Chrome 114).

---

## 4. Personas & cas d'usage

- **L'archiveur** : veut conserver localement tous les transcripts de ses réunions de la
  semaine, sans y penser. → Active l'automatisation avec restriction horaire (jours ouvrés
  8h–18h), laisse tourner.
- **Le ponctuel** : a une réunion précise à exporter maintenant. → Ouvre la réunion, utilise
  *Extraire manuellement* sur l'onglet actif.
- **Le mainteneur / power-user** : l'extraction casse après une mise à jour Teams. → Utilise
  *Debug DOM* / *Debug réunion* pour capturer l'état du DOM et ajuster les sélecteurs.

---

## 5. Périmètre

### Dans le périmètre (V3)
- Scan automatique en arrière-plan des **discussions de réunion** uniquement (les chats 1:1 et
  de groupe n'ont pas de transcript).
- Panneau latéral de configuration et de pilotage, **attaché à l'onglet Teams**.
- Téléchargement `.txt` (format lisible avec fusion des messages consécutifs d'un même orateur).
- Déduplication persistante par identité de réunion.
- Restriction horaire (jours + plage) du scan automatique.
- Journal des scans + export des logs de debug d'un run.
- Extraction manuelle de secours sur l'onglet actif.

### Hors périmètre (V3)
- Publication Chrome Web Store (à venir ; aujourd'hui chargement non empaqueté / release GitHub).
- Export JSON depuis le flux automatique (le flux auto produit du `.txt` ; le JSON existe dans
  le flux manuel V1 historique).
- Stockage cloud / synchronisation des transcripts (tout est local, dossier Téléchargements).
- Navigateurs non-Chromium ; Teams desktop natif (extension web uniquement).
- Traduction / résumé / analyse du contenu des transcripts.

---

## 6. Exigences fonctionnelles

### EF-1 — Panneau latéral par onglet (`chrome.sidePanel`)
- Le clic sur l'icône de l'extension **ouvre ou cible un onglet Teams dédié** et y attache le
  panneau latéral.
- Le panneau est **activé sur les onglets Teams** et **désactivé/masqué ailleurs** : il
  disparaît dès qu'on bascule sur un onglet non-Teams (pattern « side panel par site »).
- Aucune fenêtre dédiée n'est créée ; l'onglet Teams piloté est **réutilisé** s'il existe,
  sinon **créé en arrière-plan** (non actif) sur `https://teams.microsoft.com/v2/`.
- Au premier clic (onglet pas encore connu), un **guide non bloquant** « cliquez à nouveau sur
  l'icône » s'affiche sur la page Teams ; il disparaît à l'ouverture effective du panneau.

### EF-2 — Automatisation en arrière-plan (service worker)
- Toute l'orchestration tourne dans `background.js` : le traitement **continue panneau fermé**
  et **onglet non actif** (`chrome.scripting.executeScript` cible un `tabId` précis).
- **OFF par défaut.** À l'activation : scan **immédiat**, puis **boucle** avec une **pause
  paramétrable** (`intervalMin`, défaut **5 min**, min 1, max 240) via `chrome.alarms`.
- Reprise automatique au **démarrage du navigateur** (`onStartup`) et à l'**installation**.
- **Compte à rebours** affiché dans le panneau avant le prochain scan.
- **Arrêt manuel** (*Stop*) : invalide le scan en cours, annule la relance, **désactive
  l'automatisation** et retire le voile.

### EF-3 — Sélection des discussions à scanner
- Scan limité aux **N premières discussions** (`maxChats`, défaut **50**, `0` = toutes, max 500).
- **« Réunions uniquement » toujours actif** : sélection des `treeitem` feuilles **avec `id` +
  avatar générique de réunion** (`span.fui-Avatar__icon` sans `[data-tid="PersonaAvatar"]`),
  excluant la navigation, les canaux d'équipe, les chats 1:1 (PersonaAvatar) et de groupe
  (photo `<img>`).
- Dépliage automatique de **« Voir plus »** pour charger les discussions masquées (jusqu'à 20 itérations).

### EF-4 — Extraction d'un transcript
Pour chaque réunion ouverte (par son `id` DOM) :
1. **Réunion récurrente** : positionner la **dropdown d'instance** sur l'occurrence **passée la
   plus récente** avant extraction (`intelligent-recap-instance-select-dropdown`).
2. **Tentative directe** (sans cliquer) : à l'ouverture, le récap charge déjà le transcript dans
   une iframe SharePoint. On scanne toutes les frames, on score
   (`timeCount + 5×listCells + 5×listItems`), on extrait depuis la meilleure frame (seuil ≥ 30).
3. **Repli / escalade** : ouvrir l'onglet **Récapitulatif** (en dépliant le menu de débordement
   `+N` si le titre est long), puis le sous-onglet **Transcript** (`data-tid` stables), et
   ré-extraire (seuil ≥ 8).
4. **Défilement de la liste virtualisée** : ancrage sur la **dernière cellule rendue**
   (`scrollIntoView`), auto-correctif face aux décrochages de hauteur ; arrêt après 8 paliers
   sans nouvelle entrée (max 400 paliers).
5. **Sécurité de complétude** : si le `.txt` produit fait **< 10 Ko**, l'extraction est jugée
   incomplète → **jusqu'à 3 tentatives**, en conservant le **meilleur (plus gros)** résultat.

### EF-5 — Format de sortie
- Fichier `.txt` lisible : en-tête (titre, date, URL), séparateur, lignes `[HH:MM] Orateur: message`
  avec **fusion des messages consécutifs** d'un même orateur sans nouvel horodatage.
- Nom de fichier : `transcript-<slug-du-titre>-YYYYMMDD.txt`.
- Téléchargement via **`data:` URL** (le service worker n'a pas de DOM, donc pas de
  `URL.createObjectURL`), dans le dossier Téléchargements, sans boîte de dialogue (`saveAs: false`).

### EF-6 — Déduplication persistante
- Clé d'identité = **thread Teams** (`19:meeting_…@thread.v2`, stable entre sessions) **+
  date/heure canonisée de la réunion** lue dans l'en-tête du récap
  (`intelligent-recap-header`), au format `YYYY-MM-DD-HHMM`.
- Replis si indisponible : thread seul → date seule → **empreinte des 20 premières entrées**
  (hash du début, reproductible car l'extraction part toujours du haut).
- Stockée dans `chrome.storage.local` (`processedKeys`), persiste entre cycles et sessions.
- **Réinitialiser l'historique** : vide `processedKeys` (tout sera re-téléchargé au prochain scan).

### EF-7 — Voile de protection sur l'onglet piloté
- Quand l'**automatisation est ON**, l'onglet Teams piloté est recouvert d'un **voile gris
  semi-transparent bloquant** (clic/clavier/scroll utilisateur interceptés ; les actions
  programmatiques de l'extension ne le sont pas). Un badge « 🔒 Automatisation en cours » s'affiche.
- Un **MutationObserver** réinsère le voile si la SPA Teams le retire lors d'un re-render.
- Quand l'**automatisation est OFF**, le voile est retiré → navigation Teams manuelle libre.

### EF-8 — Restriction horaire du scan automatique (paramètres avancés)
- Optionnel (`scheduleEnabled`, OFF par défaut). Réglage de **jours** (Lun→Dim) et d'une
  **plage horaire** (début/fin, gère les plages traversant minuit).
- Hors plage : l'automatisation reste active mais ne scanne pas ; le **prochain scan est
  planifié à l'ouverture de la prochaine fenêtre** autorisée.
- Le scan **manuel** (et l'activation immédiate) reste toujours disponible.

### EF-9 — Journal des scans & observabilité
- **Journal persistant** (30 derniers runs) affiché dans le panneau, du plus récent au plus
  ancien : par run, date/heure + liste des réunions (nom, date/heure réunion, statut
  `downloaded` / `skipped` / `noTranscript` / `error`) + compteurs.
- **Bilan** du dernier scan : `X téléchargé(s), Y déjà traité(s), Z sans transcript, W en erreur`.
- **Export des logs de debug** d'un run (JSON) si ce run comporte erreurs ou sans-transcript.
- **Pastille de statut** sur l'icône : ● violet = scan en cours, ● vert = automatisation active,
  ■ rouge = arrêté, rien = désactivée. Icône dessinée à la volée (document sur fond violet).

### EF-10 — Extraction manuelle de secours
- Bouton **« Extraire manuellement (onglet actif) »** : reproduit la logique V1 sur l'onglet
  Teams actif (transcript déjà ouvert), seuil de score ≥ 3. Repli quand l'automatisation échoue.

### EF-11 — Outils de debug
- **Debug DOM** : pour chaque frame de l'onglet piloté, URL + scan heuristique + dump de la
  sidebar → `teams-dom-debug.json`.
- **Debug réunion** : ouvre la 1re réunion et capture, à chaque étape (ouverture, récap,
  transcript), les frames + libellés cliquables → `teams-meeting-debug.json`.
- (Boutons masqués par défaut dans l'UI, destinés à la maintenance.)

---

## 7. Parcours utilisateur (happy path)

1. L'utilisateur clique sur l'icône → un onglet Teams s'ouvre/cible, le panneau latéral s'affiche.
2. Il règle le **nombre de discussions** et l'**intervalle**, éventuellement la **plage horaire**.
3. Il bascule **Automatisation ON** → le scan démarre immédiatement ; le voile recouvre l'onglet.
4. Il **ferme le panneau** et continue son travail sur d'autres onglets.
5. En fond : chaque réunion est ouverte, le transcript extrait et téléchargé ; les doublons sont
   ignorés. Le **journal** et le **bilan** se remplissent en direct.
6. Entre deux scans, un **compte à rebours** s'affiche ; la boucle se relance toute seule.
7. À tout moment, **Stop** arrête tout et désactive l'automatisation.

---

## 8. Architecture technique

### Composants (V3)
```
┌──────────────────────┐  messages   ┌──────────────────────────┐  executeScript  ┌─────────────────┐
│ panel.html/.js/.css   │ ──────────► │ background.js            │ ──────────────► │ Frames Teams    │
│ (télécommande UI)     │ ◄────────── │ (service worker /        │                 │ (main + Recap)  │
└──────────────────────┘  storage    │  orchestration)          │ ◄────────────── └─────────────────┘
                                      └──────────────────────────┘   résultats             │ content.js (ping)
```
- **`panel.*`** : pure télécommande. Envoie `start/stop/extractManual/resetHistory/
  autoEnabledChanged/debug/debugMeeting/panelReady` et **reflète l'état lu dans
  `chrome.storage.local`** (`scanState`, `runLog`, réglages). Aucune logique métier.
- **`background.js`** : toute l'orchestration (scan, extraction injectée, onglet dédié, voile,
  alarms, téléchargement, dédup, journal).
- **`content.js`** : minimal (répond à un ping). Le travail réel passe par `chrome.scripting`
  pour cibler un frame précis.

### Mécanismes clés
- **Annulation par génération** : chaque scan capture `scanGen` (`myGen`) ; `cancelScan()`
  incrémente `scanGen`, invalidant instantanément le scan en cours (sortie au prochain point de
  contrôle, sans écraser l'état idle). Un flag `window.__ttdAbort` est posé dans les frames pour
  interrompre la boucle de scroll injectée.
- **Sommeil annulable** (`sleepCancellable`) : réveil anticipé si le scan est invalidé.
- **Keep-alive** : `chrome.alarms` à ~0,4 min pendant un long scan, pour éviter la mise en veille
  du service worker.
- **État partagé** : mémoire du SW + miroir dans `chrome.storage.local` (`scanState`) → le
  panneau peut se rouvrir et retrouver l'état exact.

### Extraction multi-frame
- `chrome.webNavigation.getAllFrames` énumère toutes les frames (dont l'iframe Recap).
- Heuristique par frame : motifs horaires `\d{1,2}:\d{2}`, `[data-automationid="ListCell"]`,
  `[role="listitem"]`, taille du body → score pondéré, seuil minimal anti-faux-positif.
- D'où `host_permissions: ["<all_urls>"]` : les iframes Recap proviennent d'origines Microsoft
  variables et `executeScript` n'atteint que des origines couvertes par les permissions.

---

## 9. Permissions requises

| Permission | Raison |
|---|---|
| `activeTab` | Accéder à l'onglet courant au clic sur l'icône. |
| `scripting` | Injecter les fonctions d'extraction/orchestration dans les frames ciblées. |
| `downloads` | Télécharger les `.txt` et les fichiers de debug. |
| `webNavigation` | Énumérer les iframes (`getAllFrames`) pour trouver le Recap. |
| `storage` | Réglages + état du scan + historique + journal (`chrome.storage.local`). |
| `tabs` | Ouvrir/retrouver l'onglet Teams dédié et le cibler sans qu'il soit actif. |
| `alarms` | Boucle d'automatisation (pause entre scans) + keep-alive du service worker. |
| `sidePanel` | Panneau latéral attaché par onglet. |
| `host_permissions: <all_urls>` | Cibler les iframes Recap servies depuis des origines Microsoft variables. |

Matchers content script : `https://teams.microsoft.com/*`, `https://teams.cloud.microsoft/*` (`run_at: document_idle`).

---

## 10. Exigences non fonctionnelles

- **Performance** : pause configurable entre scans ; défilement borné (max 400 paliers, ~600 ms).
- **Résilience** : reprise après veille du SW, après redémarrage navigateur ; tentatives
  multiples avec seuil de complétude ; sondage de l'en-tête récap rendu de façon asynchrone.
- **Sécurité & vie privée** : **tout reste local** (dossier Téléchargements + `chrome.storage.local`),
  aucune donnée envoyée à un service tiers ; aucun secret. Voile pour éviter les actions
  accidentelles de l'utilisateur sur l'onglet piloté.
- **Maintenabilité** : JavaScript vanilla, aucune dépendance runtime, pas de build ; sélecteurs
  centralisés (`findContainer`, `extractEntryFromCell`, onglets par `data-tid`) ; outils de debug
  intégrés.
- **Compatibilité** : Chrome/Chromium avec `chrome.sidePanel` (≥ 114) et Manifest V3.
- **Localisation** : UI en français.

---

## 11. Données & stockage (`chrome.storage.local`)

| Clé | Contenu |
|---|---|
| `autoEnabled`, `maxChats`, `intervalMin` | Réglages principaux. |
| `scheduleEnabled`, `scheduleDays`, `scheduleStart`, `scheduleEnd` | Restriction horaire. |
| `scanState` | État live (phase, current/total, message, `nextRunAt`, `summary`). |
| `processedKeys` | Map d'identités de réunions déjà téléchargées (dédup). |
| `runLog` | 30 derniers runs (réunions, statuts, compteurs). |
| `dedicatedTabId` | Onglet Teams piloté (réhydraté au réveil du SW). |

---

## 12. Risques & limitations

- **Dépendance au DOM Teams** : classes/`data-tid` évoluent → régressions possibles d'extraction
  ou de détection des réunions (mitigation : *Debug DOM* / *Debug réunion*, sélecteurs partiels).
- **Horodatage best-effort** : repose sur des motifs texte ; une refonte du DOM peut le casser.
- **Transcript doit être disponible** côté Teams (réunion transcrite) ; sinon `noTranscript`.
- **Virtualisation** : un chargement lazy raté peut tronquer ; mitigé par le seuil 10 Ko + retentes.
- **Web Store** : distribution actuelle par release GitHub / chargement non empaqueté.

---

## 13. Distribution & release

- Release **automatique à chaque commit sur `main`** (`.github/workflows/release.yml`) : tag
  `v<version>-<short_sha>`, construction d'un zip par version (`v1`/`v2`/`v3`) ne contenant que
  les fichiers exécutables par Chrome, publication GitHub Release avec les 3 zips en assets.
- Installation utilisateur : télécharger le zip `…-v3-…`, décompresser, `chrome://extensions/`
  → Mode développeur → *Charger l'extension non empaquetée* → dossier `v3/`.

---

## 14. Évolutions futures (non engagées)

- Publication **Chrome Web Store**.
- **Export JSON** depuis le flux automatique (en plus du `.txt`).
- **Internationalisation** (au-delà du français) des libellés et des parsers de dates.
- Sélecteur de **format/destination** de fichier ; archivage groupé (zip).
- Robustesse accrue des sélecteurs (stratégie de fallback configurable).

---

*Document dérivé du code de `v3/` (manifest `3.0.22`) et du `README.md`. Source de vérité : le
code de `v3/background.js`, `v3/panel.js`, `v3/panel.html`, `v3/manifest.json`.*
