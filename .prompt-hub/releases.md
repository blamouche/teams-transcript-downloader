# Releases

## 0.1.5 — 2026-06-16

- **V2 / passage en arrière-plan** (manifest extension 2.0.0 → 2.1.0). Toute
  l'orchestration migre dans un **service worker** (`background.js`) :
  - le traitement **continue popup fermée** ;
  - l'onglet Teams ciblé **n'a pas besoin d'être actif** (scripting par `tabId`),
    travail en parallèle possible sur d'autres onglets ;
  - **onglet Teams dédié** ouvert automatiquement (non actif) si absent
    (réutilisé sinon ; oublié à sa fermeture) ;
  - **nombre de discussions paramétrable** (défaut 50, `0` = toutes) ;
  - **bouton Arrêter** (drapeau `stopRequested` vérifié à chaque itération) ;
  - **boucle d'automatisation** : démarrage **immédiat** à l'activation et au
    démarrage du navigateur, puis **pause d'1 min entre deux scans** avant de
    relancer (`chrome.alarms`) ; **Arrêter** annule la prochaine itération ;
    keep-alive du SW pendant les longs scans.
- Téléchargement via **`data:` URL** (le SW n'a pas `URL.createObjectURL`).
- La popup devient une **télécommande** : messages (start/stop/extractManual/
  debug/autoEnabledChanged) au SW + rendu de l'état lu dans `chrome.storage`
  (clé `scanState`), barre de progression, mise à jour live.
- Nouvelles permissions V2 : `tabs`, `alarms`. Workflow release : copie
  conditionnelle de `background.js` dans le zip V2.

## 0.1.4 — 2026-06-16

- **V2 / scan fiabilisé** (2e debug réel). Le bloc Discussions est isolé
  proprement : chats = treeitems feuilles **avec `id` + avatar**, arrêt au 1er
  marqueur de la zone Équipes (« Afficher tous les canaux », « Voir toutes vos
  équipes ») ; canaux (sans avatar) et contrôles (`id` nul) écartés.
- **Clic par `id`** (`getElementById`) au lieu de l'index → robuste aux
  re-rendus / virtualisation.
- **Dépliage « Voir plus »** (`frameClickVoirPlus`, jusqu'à 20 fois) pour charger
  les discussions masquées avant le scan. Plafond porté à 250.
- **Skip rapide** dans `tryExtractCurrent` : si ni récapitulatif ni transcript
  ne sont cliquables, la discussion est ignorée sans attente.
- Décisions utilisateur : périmètre = toutes les discussions (hors canaux) ;
  pas d'étape de confirmation (ouvrir et tester chacune).

## 0.1.3 — 2026-06-16

- **V2 / sélecteurs réels** : exploitation du diagnostic *Debug DOM* fourni par
  l'utilisateur (Teams `teams.microsoft.com/v2/`). La sidebar est un unique
  `[role="tree"]` (`data-tid="simple-collab-dnd-rail"`) de 145
  `[role="treeitem"]` mêlant navigation et discussions. `frameChats` réécrit
  pour cibler `[role="treeitem"]` puis filtrer : visibles, feuilles (sans
  treeitem imbriqué), hors libellés de navigation (Copilot, Mentions, Activité,
  Calendrier… fr/en, badge numérique ignoré). Ajout d'un `scrollIntoView` avant
  clic (listes virtualisées) et de l'`id` dans les résultats.
- Diagnostic enrichi : `frameDumpSidebar` renvoie `__chatCandidates`
  (discussions retenues `kept` avec id/hasImg/label + `excludedAsNav`) pour
  vérifier le filtrage.
- Caveat connu : liste de discussions potentiellement virtualisée (seuls les
  items visibles sont dans le DOM) — à valider sur le prochain debug.

## 0.1.2 — 2026-06-16

- **V2 / diagnostic** : le bouton *Debug DOM* dumpe désormais aussi la structure
  réelle de la sidebar (fonction injectée `frameDumpSidebar`) sous la clé
  `sidebar` du JSON — comptes et échantillons (role, data-tid, id, aria-label,
  classes, texte) pour une série de sélecteurs candidats. Objectif : identifier
  les vrais sélecteurs des éléments de discussion (rendus côté client par React,
  donc absents du `view-source`) et fiabiliser `frameChats`.

## 0.1.1 — 2026-06-16

- **V2** : ajout d'un **switch d'automatisation** (état persistant via
  `chrome.storage.local`, permission `storage` ajoutée). Quand il est actif, la
  V2 **scanne toutes les discussions** de la sidebar Teams (parcours par index)
  et, pour chacune, ouvre le récapitulatif, l'onglet Transcript, extrait et
  télécharge le `.txt` directement dans Téléchargements. Déduplication par
  titre + nombre d'entrées, garde-fou à 50 discussions. Activer le switch lance
  immédiatement le scan ; le bouton « Scanner toutes les discussions » relance.
- Remplacement de l'orchestration single-meeting (`autoDownload`,
  `frameClickMeeting`) par le scan par lot (`autoScanAll`, `frameChats`,
  `tryExtractCurrent`).
- `README.md` mis à jour (switch, scan multi-discussions, permission `storage`).

## 0.1.0 — 2026-06-16

- Nouvelle branche `feature/v2-auto-download` : gestion de **deux versions** du
  plugin côte à côte dans le dépôt.
- Restructuration : les fichiers du plugin V1 (contenu **inchangé**) sont
  déplacés dans `v1/`.
- **V2** (`v2/`) : extension distincte (manifest `2.0.0`) qui ajoute le
  téléchargement automatique des transcripts Teams. En un clic
  (« Télécharger automatiquement »), elle : (1) cherche et ouvre une discussion
  de type *meeting* dans la sidebar, (2) ouvre le récapitulatif de réunion,
  (3) clique sur l'onglet Transcript, (4) extrait (moteur V1) puis télécharge le
  `.txt` directement dans le dossier Téléchargements (`saveAs:false`).
  Le bouton « Extraire manuellement » conserve le comportement V1 en secours.
- Workflow `release.yml` : package désormais **deux** zips
  (`...-v1-<tag>.zip` et `...-v2-<tag>.zip`).
- `README.md` : section *Deux versions*, instructions d'installation/usage par
  version, structure mise à jour, section *Release* adaptée.

## 0.0.3 — 2026-05-19

- `README.md` : ajout d'une sous-section *Depuis une release GitHub
  (recommandé)* dans la section *Installation*, avec lien direct vers la page
  des releases. Le mode développeur depuis les sources est conservé comme
  alternative.

## 0.0.2 — 2026-05-19

- Ajout du workflow GitHub Actions `.github/workflows/release.yml` :
  déclenchement automatique sur push de tag `v*`, packaging d'un zip ne
  contenant que les fichiers nécessaires au chargement de l'extension Chrome
  (`manifest.json`, `content.js`, `popup.{html,css,js}`, `icons/`), publication
  d'une release GitHub avec le zip en asset et notes auto-générées.
- Documentation : nouvelle section *Release* dans le `README.md` (procédure de
  tag + push, contenu du zip).

## 0.0.1 — 2026-04-17

- Refonte du `README.md` : ajout d'une documentation technique complète (architecture à 3 composants, flux d'extraction multi-frame, heuristique de scoring, algorithme de scroll, sélecteurs utilisés, formats JSON/TXT, permissions détaillées, limitations connues).
- Initialisation du workflow prompt-hub (`version.md`, `releases.md`, `memory.md`, `lessons.md`).
