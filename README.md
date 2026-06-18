# Teams Transcript Downloader

Extension Chrome (Manifest V3) pour télécharger les transcripts de réunions Microsoft Teams (y compris via l'interface **Recap**) au format JSON ou TXT.

## Trois versions

Le dépôt fournit **trois versions** complètes de l'extension, dans trois dossiers distincts. On charge l'une ou l'autre dans Chrome selon l'usage souhaité.

| Version | Dossier | Fonctionnement |
|---|---|---|
| **V1** | [`v1/`](v1/) | Extraction **manuelle** : on ouvre soi-même le panneau Transcript dans Teams, puis on clique sur *Extraire*. |
| **V2** | [`v2/`](v2/) | Tout V1 **+ automatisation en arrière-plan** (service worker) : scan des N premières discussions (paramétrable), **même popup fermée** et **sans que l'onglet Teams soit actif**, avec ouverture auto d'un onglet Teams dédié, démarrage automatique après activation, et arrêt manuel. |
| **V3** | [`v3/`](v3/) | Identique à V2 sur le fond, mais l'UI est un **panneau latéral attaché à l'onglet Teams** (`chrome.sidePanel`, comportement type extension Claude). Le clic sur l'icône **ouvre (ou cible) un onglet Teams dédié** et y attache le panneau ; celui-ci **disparaît dès qu'on change d'onglet** (activé sur les onglets Teams, désactivé ailleurs). L'onglet Teams piloté est recouvert d'un **voile gris semi-transparent** : on voit l'automatisation travailler mais l'utilisateur ne peut pas cliquer par erreur dedans. |

La V1 reste strictement inchangée. V2 est un sur-ensemble de V1, V3 un sur-ensemble de V2.

## Description

La version web de Microsoft Teams affiche les transcripts de réunions mais n'offre pas de bouton de téléchargement natif. Cette extension scanne automatiquement la page et ses iframes (notamment celles de la vue *Recap*), extrait chaque ligne du transcript (heure, orateur, message) puis propose un export en JSON structuré ou en TXT lisible.

### V2 — automatisation en arrière-plan

La V2 déporte toute l'orchestration dans un **service worker** ([`background.js`](v2/background.js)). Conséquences :

- le traitement **continue même popup fermée** ;
- l'onglet Teams ciblé **n'a pas besoin d'être actif/visible** (`chrome.scripting.executeScript` cible un `tabId` précis), on peut travailler sur d'autres onglets en parallèle ;
- un **onglet Teams dédié** est ouvert automatiquement (non actif) si aucun n'existe ;
- l'**Automatisation est OFF par défaut** (rien ne se lance à l'installation) ; une fois activée, le scan démarre **immédiatement**, puis **se relance en boucle** avec une **pause paramétrable entre deux scans** (défaut **5 min**, via `chrome.alarms`) et un **compte à rebours** dans la popup ; il redémarre aussi au lancement du navigateur ;
- le scan peut être **arrêté manuellement** en cours (bouton **Arrêter**) ;
- le nombre de discussions scannées est **paramétrable** (les N premières, défaut **50**, `0` = toutes) ;
- option **« Réunions uniquement »** (activée par défaut) : ne scanne que les chats de réunion, en s'appuyant sur l'icône d'avatar générique (`span.fui-Avatar__icon` sans `[data-tid="PersonaAvatar"]`), et ignore les chats individuels (avatar + badge de présence) et de groupe (photo).

Déroulé du scan, pour chaque discussion du bloc **Discussions** :

1. dépliage de « Voir plus » pour charger les discussions masquées ;
2. sélection des discussions = treeitems feuilles **avec `id` + avatar** (hors navigation et hors canaux d'équipe) ;
3. ouverture de la discussion **par son `id`** (`getElementById`) ;
4. tentative d'ouverture du **récapitulatif** puis de l'onglet **Transcript** (skip rapide si aucun) ;
5. si un transcript est détecté, extraction (moteur V1) puis téléchargement direct du `.txt` dans le dossier Téléchargements.

Retours visuels : un **loader** (spinner) s'affiche dans la popup pendant le scan, l'icône de l'extension est dessinée à la volée (document « transcript » sur fond violet), et une **pastille de statut** apparaît dessus (● violet = scan en cours, ● vert = automatisation active, ■ rouge = arrêté, rien = désactivée).

Les transcripts déjà traités ne sont **pas re-téléchargés** : une signature de contenu (`titre|nb entrées|hash du texte`, stable entre cycles et sessions) est mémorisée dans `chrome.storage.local` (`processedKeys`) et vérifiée avant chaque téléchargement. Le bilan de fin indique « X nouveau(x), Y déjà traité(s) », et le bouton **« Réinitialiser l'historique »** vide cette mémoire. La popup affiche l'état/progression en direct (lu dans `chrome.storage.local`, clé `scanState`).

> Note technique : le service worker n'ayant pas de DOM, le téléchargement se fait via une **`data:` URL** (et non `URL.createObjectURL`).

Le bouton **« Extraire manuellement »** reproduit le comportement de la V1 sur le panneau Transcript déjà ouvert de l'onglet actif (repli).

## Installation

### Depuis une release GitHub (recommandé)

1. Rendez-vous sur la page des releases :
   [github.com/blamouche/teams-transcript-downloader/releases](https://github.com/blamouche/teams-transcript-downloader/releases).
2. Téléchargez l'archive souhaitée de la dernière release :
   `teams-transcript-downloader-v1-vX.Y.Z.zip` (manuelle) ou
   `teams-transcript-downloader-v2-vX.Y.Z.zip` (automatique).
3. Décompressez l'archive dans un dossier de votre choix.
4. Ouvrez Chrome à l'adresse `chrome://extensions/`.
5. Activez le **Mode développeur** (toggle en haut à droite).
6. Cliquez sur **« Charger l'extension non empaquetée »** et sélectionnez le
   dossier décompressé.

### Mode développeur (depuis les sources)

1. Clonez ce dépôt.
2. Ouvrez Chrome à l'adresse `chrome://extensions/`.
3. Activez le **Mode développeur** (toggle en haut à droite).
4. Cliquez sur **« Charger l'extension non empaquetée »**.
5. Sélectionnez le dossier **`v1/`** (manuelle), **`v2/`** (automatique, popup)
   ou **`v3/`** (automatique, panneau latéral + voile sur l'onglet dédié) selon la
   version voulue.

### Chrome Web Store

*(À venir)*

## Utilisation

**V1 (manuelle)**

1. Ouvrez Microsoft Teams (`teams.microsoft.com` ou `teams.cloud.microsoft`) dans Chrome.
2. Accédez à la réunion et affichez le transcript (vue *Recap* ou panneau Transcript).
3. Cliquez sur l'icône de l'extension dans la barre d'outils.
4. Cliquez sur **« Extraire le transcript »** — l'extension scanne automatiquement les iframes et choisit celle qui contient le transcript.
5. Vérifiez l'aperçu, puis téléchargez au format **JSON** ou **TXT**.

**V2 (automatique, en arrière-plan)**

1. Cliquez sur l'icône de l'extension (inutile d'avoir Teams au premier plan).
2. Réglez le **nombre de discussions** à scanner (défaut 50, `0` = toutes).
3. Deux façons de lancer :
   - **Automatisation ON** (OFF par défaut) → le scan démarre **immédiatement**, puis se relance en boucle (pause paramétrable, défaut 5 min, avec compte à rebours) ; il reprend aussi au démarrage du navigateur ;
   - **« Scanner maintenant »** → un scan unique immédiat.
4. Un onglet Teams dédié s'ouvre en arrière-plan si besoin ; vous pouvez **fermer la popup** et continuer à travailler sur vos autres onglets. Le `.txt` de chaque discussion contenant un transcript est téléchargé dans Téléchargements.
5. **Arrêter** interrompt le scan en cours. En cas d'échec, ouvrez vous-même le panneau Transcript et utilisez **« Extraire manuellement »**.

## Architecture technique

### Vue d'ensemble

L'extension suit une architecture à trois composants découplés :

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  popup.html/.js/.css│────►│ chrome.scripting /       │────►│ Frames Teams    │
│  (UI + orchestr.)   │     │ webNavigation APIs       │     │ (main + Recap)  │
└─────────────────────┘     └──────────────────────────┘     └─────────────────┘
                                                                      │
                                                                      ▼
                                                              ┌─────────────────┐
                                                              │  content.js     │
                                                              │  (ping only)    │
                                                              └─────────────────┘
```

- **`popup.html` / `popup.css`** : interface utilisateur minimale (bouton *Extraire*, aperçu, choix du format, bouton *Debug DOM*).
- **`popup.js`** : orchestrateur. Contient toute la logique d'extraction, injectée à la demande dans les frames via `chrome.scripting.executeScript`.
- **`content.js`** : script de contenu minimaliste, chargé automatiquement sur les domaines Teams, qui ne sert qu'à répondre à un *ping* éventuel. Le travail réel est effectué via `chrome.scripting` pour pouvoir cibler un frame précis.
- **`manifest.json`** : Manifest V3, permissions et matchers.

### Flux d'exécution de l'extraction

```
1. popup.js: chrome.webNavigation.getAllFrames(tabId)
        │
        ▼
2. Pour chaque frame: executeScript(frameScanForTranscript)
        │   → renvoie { timeCount, listCells, listItems, bodyLength }
        ▼
3. Scoring: score = timeCount + 5×listCells + 5×listItems
        │   → sélection du "bestFrame" (score > 3)
        ▼
4. executeScript(frameFullExtract) sur bestFrame
        │   → findContainer() → scroll progressif → collectEntries()
        ▼
5. executeScript(frameGetTitle) sur le frame principal (frameId: 0)
        │
        ▼
6. Construction de { title, date, entries[], url } et rendu dans le popup
```

### Extraction multi-frame (Teams Recap)

La vue *Recap* de Teams intègre le transcript dans une iframe distincte (domaine et arborescence propres). Pour la trouver sans dépendre d'URLs précises :

1. `chrome.webNavigation.getAllFrames` liste tous les frames de l'onglet.
2. La fonction `frameScanForTranscript` est injectée dans chaque frame et renvoie une *heuristique* :
   - nombre de motifs horaires (`\d{1,2}:\d{2}`) dans `document.body.textContent`,
   - nombre d'éléments `[data-automationid="ListCell"]`,
   - nombre d'éléments `[role="listitem"]`,
   - taille du body.
3. Un score pondéré (`timeCount + 5×listCells + 5×listItems`) désigne le frame le plus « transcript-like ». Un seuil minimal de 3 évite les faux positifs.

C'est pour cela que le manifest déclare `host_permissions: ["<all_urls>"]` : les iframes *Recap* peuvent être servies depuis des sous-domaines Microsoft variables, et `chrome.scripting.executeScript` ne peut cibler que des frames dont l'origine est couverte par les permissions.

### Algorithme d'extraction (`frameFullExtract`)

1. **Détection du conteneur** (`findContainer`) — par ordre de priorité :
   - sélecteurs connus : `#scrollToTargetTargetedFocusZone`, `[data-tid="transcriptContainerRef"]`, `[data-tid="transcript-pane"]`, `[data-tid="transcript-content"]`, `.ms-List` ;
   - remontée DOM depuis la première `[data-automationid="ListCell"]` jusqu'au premier parent scrollable ;
   - `[role="list"]` ayant plus de 2 enfants ;
   - `[role="log"]` ;
   - heuristique finale : n'importe quel `div` comportant au moins 3 motifs horaires.
2. **Scroll progressif** si le conteneur est scrollable (`scrollHeight > clientHeight + 50`) :
   - avance de 500 px toutes les ~400 ms, jusqu'à 500 itérations max ;
   - détection de fin : 5 passages consécutifs sans progression du `scrollTop` ;
   - retour en haut (`scrollTop = 0`) pour une passe finale puis restauration de la position initiale.
3. **Collecte** (`collectEntries`) via `[data-automationid="ListCell"], [role="listitem"]`, fallback sur `container.children`.
4. **Extraction par ligne** (`extractEntryFromCell`) :
   - `time` via regex `\d{1,2}:\d{2}(?::\d{2})?` ;
   - `speaker` via sélecteurs partiels (`[class*="itemDisplayName"]`, `[class*="displayName"]`, `[class*="speaker"]`, `[class*="author"]`, `[data-tid*="speaker"]`, `[data-tid*="name"]`) ;
   - `message` via (`[class*="eventText"]`, `[class*="message"]`, `[class*="caption"]`, `[class*="text-"]`, `[data-tid*="text"]`, `[data-tid*="caption"]`), fallback sur `textContent` brut ;
   - fallback « Nom : message » via regex sur la majuscule initiale ;
   - nettoyage : retrait des préfixes redondants (time, speaker) et des bruits type « X minutes Y secondes ».
5. **Déduplication** : clé `speaker|message.substring(0,50)` dans un `Set`.

### Récupération du titre

Injection de `frameGetTitle` dans le frame principal (`frameIds: [0]`). Sélecteurs testés dans l'ordre :
`[data-tid="chat-title"]`, `[data-tid="meeting-title"]`, `h1`, `h2`, `[role="heading"]`. Valeur par défaut : `"Meeting Transcript"`.

### Formats de sortie

**JSON** — structure complète :
```json
{
  "title": "Nom de la réunion",
  "date": "2026-04-17T09:32:11.123Z",
  "url": "https://teams.microsoft.com/...",
  "entries": [
    { "time": "00:01", "speaker": "Alice Martin", "message": "Bonjour à tous." },
    { "time": "00:05", "speaker": "Bob Dupont", "message": "Salut Alice." }
  ]
}
```

**TXT** — lisible, avec fusion automatique des messages consécutifs du même orateur sans horodatage :
```
Transcript: Nom de la réunion
Date: 17/04/2026 09:32:11
URL: https://teams.microsoft.com/...

========================================

[00:01] Alice Martin: Bonjour à tous.
[00:05] Bob Dupont: Salut Alice.

========================================
Total: 2 entrées
```

Les noms de fichiers sont de la forme `transcript-<slug>-YYYYMMDD.{json,txt}`.

### Outil de Debug DOM

Le bouton **Debug DOM** du popup déclenche `debugDOM()` : pour chaque frame, il enregistre URL, type, parent et résultat du scan (`frameScanForTranscript`), puis télécharge un JSON `teams-dom-debug.json`. Très utile pour diagnostiquer une évolution du DOM Teams côté utilisateur.

## Structure du projet

```
├── v1/                # Version 1 — extraction manuelle (inchangée)
│   ├── manifest.json  # Manifest V3 : permissions, matchers, action, content_scripts
│   ├── content.js     # Content script minimaliste (ping)
│   ├── popup.html     # UI du popup
│   ├── popup.css      # Styles (thème Teams)
│   ├── popup.js       # Orchestration + fonctions injectées (scan, extract, title, debug)
│   └── icons/         # Icônes de l'extension (16/48/128 + SVG)
├── v2/                # Version 2 — automatisation en arrière-plan (sur-ensemble de V1)
│   ├── manifest.json  # Manifest V3 (service worker, perms tabs/alarms, popup)
│   ├── background.js  # Service worker : orchestration, scan, tab dédié, alarms, download
│   ├── content.js
│   ├── popup.html     # UI télécommande : switch, nb discussions, start/stop, manuel
│   ├── popup.css
│   ├── popup.js       # Télécommande : messages au SW + rendu de l'état (storage)
│   └── icons/
├── v3/                # Version 3 — panneau latéral + voile sur l'onglet dédié (sur-ensemble de V2)
│   ├── manifest.json  # Manifest V3 (perm sidePanel, side_panel.default_path, action sans popup)
│   ├── background.js  # SW V2 + comportement side panel + injection/cycle de vie du voile
│   ├── content.js
│   ├── panel.html     # UI du panneau latéral (ex-popup, largeur fluide)
│   ├── panel.css
│   ├── panel.js       # Télécommande (identique au principe V2)
│   └── icons/
├── README.md
├── .github/workflows/ # Workflows GitHub Actions (release automatique des 2 versions)
└── .prompt-hub/       # Mémoire, lessons, version, releases (workflow prompt-hub)
```

Les chemins de code cités plus bas (`popup.js`, `manifest.json`, …) existent à l'identique dans `v1/` et `v2/` ; la logique d'extraction décrite est commune aux deux. La V2 ajoute en plus les fonctions d'orchestration `frameClickMeeting`, `frameClickByKeywords`, `clickAcrossFrames` et `autoDownload`.

## Permissions

Déclarées dans [`manifest.json`](manifest.json) :

| Permission | Raison |
|---|---|
| `activeTab` | Accéder à l'onglet courant au moment du clic sur l'icône. |
| `scripting` | Injecter `frameScanForTranscript` / `frameFullExtract` / `frameGetTitle` via `chrome.scripting.executeScript`. |
| `downloads` | Déclencher le téléchargement des fichiers JSON/TXT/debug. |
| `webNavigation` | Appeler `chrome.webNavigation.getAllFrames` pour énumérer les iframes (nécessaire pour *Recap*). |
| `storage` *(V2)* | Réglages (switch *Automatisation*, nombre de discussions) et état du scan (`chrome.storage.local`). |
| `tabs` *(V2)* | Ouvrir/retrouver l'onglet Teams dédié et le cibler sans qu'il soit actif. |
| `alarms` *(V2)* | Déclenchement automatique 1 min après activation + keep-alive du service worker pendant un long scan. |
| `host_permissions: <all_urls>` | Pouvoir cibler les iframes *Recap* servies depuis des origines Microsoft variables. |

Matchers des content scripts : `https://teams.microsoft.com/*` et `https://teams.cloud.microsoft/*` (`run_at: document_idle`).

## Développement

### Technologies

- **Manifest V3** (Chrome Extensions).
- **JavaScript vanilla** côté popup et côté frame (aucune dépendance runtime, pas de build).
- **HTML / CSS** pour l'UI.

### Tester une modification

1. Modifiez les fichiers sources.
2. Dans `chrome://extensions/`, cliquez sur l'icône *Recharger* de l'extension.
3. Ouvrez Teams, testez, et utilisez le bouton **Debug DOM** pour inspecter la structure si l'extraction renvoie 0 entrée.

### Points d'extension / maintenance

- **Nouveau sélecteur de conteneur** : ajouter l'entrée en tête de la liste dans `findContainer()` de [`popup.js`](popup.js).
- **Nouveau pattern d'entrée** : ajuster `extractEntryFromCell()` (regex time, sélecteurs speaker/message, fallback).
- **Nouveau domaine Teams** : ajouter le matcher dans `manifest.json` → `content_scripts.matches` et (si nécessaire) dans `checkTeamsTab()` de `popup.js`.

## Release

La publication des releases est entièrement automatisée par le workflow
[`.github/workflows/release.yml`](.github/workflows/release.yml).

### Déclencher une release

1. Mettre à jour la version dans `v1/manifest.json` / `v2/manifest.json` si nécessaire.
2. Créer un tag versionné (préfixe `v`) et le pousser :
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```
3. Le workflow GitHub Actions s'exécute automatiquement :
   - construit, pour **chaque version**, un dossier temporaire ne contenant que
     les fichiers nécessaires à l'extension (`manifest.json`, `content.js`,
     `popup.html`, `popup.css`, `popup.js`, `icons/icon{16,48,128}.png`),
   - les zippe sous `teams-transcript-downloader-v1-<tag>.zip` et
     `teams-transcript-downloader-v2-<tag>.zip`,
   - crée une release GitHub portant le nom du tag, avec les deux zips en assets
     et des notes de release auto-générées (`generate_release_notes`).

### Contenu des zips

Chaque zip ne contient **que** les fichiers exécutables par Chrome de sa
version (`v1/` ou `v2/`). Sont exclus : documentation, `.prompt-hub/`,
`.github/`, fichiers `*.md`, `CLAUDE.md`, `agents.md`. Il peut être chargé tel
quel via `chrome://extensions/` → *Charger l'extension non empaquetée*.

## Limitations connues

- L'extension fonctionne uniquement lorsque le transcript est **visible / ouvert** dans Teams.
- Les classes et `data-tid` de Teams évoluent : une régression d'extraction peut nécessiter la mise à jour des sélecteurs (utiliser *Debug DOM* pour capturer l'état courant).
- L'horodatage repose sur la détection d'un motif texte : une refonte majeure du DOM de Teams peut le casser.

## Licence

MIT
