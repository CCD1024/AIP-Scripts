# AIP-Scripts

**Scripts PixInsight de Philippe Bernhard**

Dépôt commun pour les scripts AIP. Scripts disponibles : **SHORGB-AIP 1.01** et **SHOLuminance-AIP 0.6.1**. Les autres scripts seront ajoutés avec leurs propres versions et archives, tout en conservant une seule adresse de mises à jour PixInsight.

## SHOLuminance-AIP 0.6.1

Crée une luminance monochrome à partir des images SII, Ha et OIII : moyenne pondérée, Lighten ou Screen. Interface français/anglais, aperçu interactif, pieds communs ou séparés dans un panneau avancé et histogrammes individuels ou superposés en trois couleurs avec luminance finale en blanc.

- Menu après installation : **Script > CCD1024 > SHOLuminance-AIP**.
- Icône : fichier AIP.svg fourni avec le script.
- [Code et icône](src/SHOLuminance-AIP/) · [Notice](src/SHOLuminance-AIP/Lisez-moi.txt).
- Installation par le dépôt PixInsight ci-dessous. Pour l'installation manuelle, conserver le script et son icône dans le même dossier, puis ajouter ce dossier avec **Script > Feature Scripts**.


## SHORGB-AIP 1.01

SHORGB-AIP compose une image RGB à partir de six sources possibles : SII, Ha, OIII, R, G et B.
L'interface est disponible en français et en anglais.

Le script apparaît sous **Script > CCD1024 > SHORGB-AIP**, avec l’icône AIP.

## Fonctions

- Matrice de 18 coefficients de 0 à 3,000 (0 à 300 %), avec boutons -/+ au pas de 0,001.
- Preview réduit et réglages interactifs.
- Préréglages, base Auto SHO et paramètres personnalisés.
- Alignement protégé du pied des histogrammes et offsets RGB grossiers/fins.
- Linked STF, Unlinked STF, affichage brut et niveaux Low/Medium/High.
- Histogramme DATA après normalisation de sortie, avant STF.
- Image finale en pleine résolution avec remise à l'échelle commune RGB sans écrêtage.

## Installer manuellement

L’installation par le dépôt ci-dessous est recommandée pour installer automatiquement le script et son icône.

Pour une installation manuelle :

1. Télécharger [l’archive 1.01](https://ccd1024.github.io/AIP-Scripts/packages/SHORGB-AIP-1.01.zip).
2. Copier son contenu dans le dossier d’installation de PixInsight en conservant les sous-dossiers `src/` et `rsc/`. Sur macOS, il s’agit du dossier PixInsight, pas du paquet `PixInsight.app`.
3. Dans **Script > Feature Scripts**, ajouter ou actualiser le dossier du script si nécessaire, puis ouvrir **Script > CCD1024 > SHORGB-AIP**.

Le code JavaScript est aussi disponible dans `src/SHORGB-AIP.js`. Son icône utilise la ressource installée `rsc/icons/script/SHORGB_AIP/AIP.svg`.

Le script demande PixInsight 1.9.4 ou ultérieur avec le moteur V8. Les dernières vérifications ont été effectuées sous PixInsight 1.9.6 sur macOS. Les autres systèmes n’ont pas été testés dans cette session.

## Installer par le dépôt PixInsight

Adresse à ajouter dans PixInsight :

```text
https://ccd1024.github.io/AIP-Scripts/
```

[Page d'installation](https://ccd1024.github.io/AIP-Scripts/) | [Code source](src/SHORGB-AIP.js)

Dans PixInsight : **Resources > Updates > Manage Repositories**, ajouter l'URL publiée, puis vérifier les mises à jour. Redémarrer PixInsight si demandé.

Le dossier `docs/` contient les fichiers du serveur de mises à jour. Le fichier `updates.xri` déclare l'archive à installer, son empreinte et les versions de PixInsight ciblées.

## Démarrer

1. Choisir les sources utiles et un preset, ou utiliser Auto SHO.
2. Préparer/rafraîchir le preview.
3. Ajuster les coefficients, le pied et les offsets.
4. Contrôler les données et créer l'image finale.

Unlinked STF change l'équilibre apparent des couleurs uniquement dans le preview. Le STF n'est pas appliqué à l'image finale.
L'histogramme du preview est une estimation issue de pixels moyennés, avec la normalisation calculée depuis les extrema en pleine résolution. Après création, l'histogramme compte tous les pixels de sortie.

## English

SHORGB-AIP is a six-source SII/Ha/OIII/R/G/B matrix mixer for PixInsight. The interface supports English and French. It provides 18 independent coefficients, live preview, protected histogram-foot alignment, coarse/fine RGB offsets and full-resolution output. A common RGB normalization keeps output within [0,1] without hard clipping. STF affects preview display only.

The script is listed under **Script > CCD1024 > SHORGB-AIP** with the AIP icon. For manual installation, copy the contents of the versioned ZIP into the PixInsight installation directory, preserving its `src/` and `rsc/` paths, then refresh **Script > Feature Scripts** if needed. For installation through the PixInsight updater, add `https://ccd1024.github.io/AIP-Scripts/` in **Resources > Updates > Manage Repositories**.

## Crédits / Credits

Script : Philippe Bernhard.
L'en-tête du code conserve les références d'inspiration de son architecture de preview.

## Signature

Cette version du script et du dépôt est non signée. Une signature certifiée PixInsight pourra être ajoutée à une prochaine publication.
