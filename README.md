# Teams Transcript Downloader

Extension Chrome pour télécharger les transcripts de meetings Microsoft Teams.

## Description

La version web de Microsoft Teams permet d'afficher les transcripts de réunions mais ne permet pas de les télécharger. Cette extension Chrome extrait automatiquement le contenu du transcript affiché et permet de le sauvegarder en JSON ou TXT.

## Installation

### Installation manuelle (Mode développeur)

1. Téléchargez ou clonez ce repository
2. Ouvrez Chrome et allez à `chrome://extensions/`
3. Activez le **Mode développeur** (toggle en haut à droite)
4. Cliquez sur **"Charger l'extension non empaquetée"**
5. Sélectionnez le dossier contenant l'extension
6. L'extension est maintenant installée !

### Installation depuis le Chrome Web Store

*(À venir si publié)*

## Utilisation

1. Ouvrez Microsoft Teams dans votre navigateur
2. Accédez à un meeting avec un transcript
3. Ouvrez le transcript (bouton "Transcript" dans la réunion)
4. Cliquez sur l'icône de l'extension dans la barre d'outils Chrome
5. Cliquez sur **"Extraire le transcript"**
6. Une fois extrait, choisissez le format (JSON ou TXT) et téléchargez

## Fonctionnalités

- Détection automatique des pages Teams avec transcripts
- Extraction des entrées du transcript (heure, orateur, message)
- Aperçu avant téléchargement
- Export en JSON (structure complète)
- Export en TXT (format texte simple)
- Interface intuitive avec thème Teams

## Structure de l'extension

```
├── manifest.json      # Configuration de l'extension
├── content.js         # Script d'extraction du DOM
├── popup.html         # Interface du popup
├── popup.css          # Styles du popup
├── popup.js           # Logique du popup
└── icons/             # Icônes de l'extension
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── icon.svg
```

## Développement

### Technologies utilisées

- Manifest V3 (Chrome Extensions)
- JavaScript vanilla
- HTML/CSS

### Permissions requises

- `activeTab` : Accès à l'onglet actif
- `scripting` : Injection du content script
- `downloads` : Téléchargement des fichiers
- `https://teams.microsoft.com/*` : Accès aux pages Teams

## Notes importantes

- L'extension fonctionne uniquement sur les pages Teams (`teams.microsoft.com`)
- Le transcript doit être visible/ouvert pour pouvoir être extrait
- Les classes CSS de Teams peuvent changer, ce qui peut nécessiter des mises à jour

## Licence

MIT
