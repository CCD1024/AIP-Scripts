# AIP-Scripts

**Scripts PixInsight de Philippe Bernhard**

Dépôt commun pour les scripts AIP. Scripts disponibles : **SHORGB-AIP 1.03** et **SHOLuminance-AIP 0.6.2**. Ce dépôt distribue ces deux scripts, avec leurs propres versions et archives et une seule adresse de mises à jour PixInsight.

## SHOLuminance-AIP 0.6.2

Crée une luminance monochrome à partir des images SII, Ha et OIII : moyenne pondérée, Lighten ou Screen. Interface français/anglais, aperçu interactif, pieds communs ou séparés dans un panneau avancé et histogrammes individuels ou superposés en trois couleurs avec luminance finale en blanc.

- Menu après installation : **Script > CCD1024 > SHOLuminance-AIP**.
- Icône : fichier AIP.svg fourni avec le script.
- [Code](src/SHOLuminance-AIP/) · [Icône](icons/SHOLuminance_AIP/AIP.svg) · [Notice](documentation/SHOLuminance-AIP/Lisez-moi.txt).
- Installation par le dépôt PixInsight ci-dessous. Pour l'installation manuelle, extraire [l’archive manuelle 0.6.2](https://ccd1024.github.io/AIP-Scripts/manual/SHOLuminance-AIP-0.6.2-manual.zip) dans un dossier personnel, puis ajouter ce dossier avec **Script > Feature Scripts > Add**.


## SHORGB-AIP 1.03

SHORGB-AIP compose une image RGB à partir de six sources possibles : SII, Ha, OIII, R, G et B.
L'interface est disponible en français et en anglais.

Le script apparaît sous **Script > CCD1024 > SHORGB-AIP**, avec l’icône AIP.

## Fonctions

- Matrice de 18 coefficients de 0 à 3,00 (0 à 300 %), affichés sur deux décimales, avec curseurs et boutons -/+ au pas de 0,01.
- Preview réduit actualisé pendant le déplacement des curseurs ; les demandes de rafraîchissement sont regroupées pour éviter de relancer inutilement les calculs.
- Préréglages, base Auto SHO et paramètres personnalisés.
- Alignement protégé du pied des histogrammes et offsets RGB grossiers/fins ; les offsets fins conservent leur pas de 0,0001.
- Linked STF, Unlinked STF, affichage brut et niveaux Low/Medium/High.
- Histogramme DATA après normalisation de sortie, avant STF.
- Image finale en pleine résolution avec remise à l'échelle commune RGB sans écrêtage.

## Installer manuellement

L’installation par le dépôt ci-dessous est recommandée pour installer automatiquement le script et son icône.

Pour une installation manuelle :

1. Télécharger [l’archive manuelle SHORGB-AIP 1.03](https://ccd1024.github.io/AIP-Scripts/manual/SHORGB-AIP-1.03-manual.zip).
2. Extraire le dossier dans un emplacement personnel de votre choix, par exemple Documents/Scripts-PixInsight.
3. Dans **Script > Feature Scripts > Add**, sélectionner ce dossier, valider, puis ouvrir **Script > CCD1024 > SHORGB-AIP**.

Les archives manuelles utilisent l’icône AIP.svg voisine du script. Seule cette référence d’icône diffère du code des paquets de mise à jour.

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

SHORGB-AIP is a six-source SII/Ha/OIII/R/G/B matrix mixer for PixInsight. The interface supports English and French. It provides 18 independent coefficients with 0.01 steps and two decimal places, preview updates during slider movement, protected histogram-foot alignment, coarse/fine RGB offsets and full-resolution output. A common RGB normalization keeps output within [0,1] without hard clipping. STF affects preview display only.

The script is listed under **Script > CCD1024 > SHORGB-AIP** with the AIP icon. For manual installation, extract the manual ZIP into a personal folder of your choice, then add it with **Script > Feature Scripts > Add**. For installation through the PixInsight updater, add `https://ccd1024.github.io/AIP-Scripts/` in **Resources > Updates > Manage Repositories**.

## Crédits / Credits

Script : Philippe Bernhard.
Les deux scripts réutilisent et adaptent PreviewBox et des fonctions auxiliaires de Badassium238 1.2.3 par Jacques Pouyaud (MIT). Le copyright et la permission MIT sont inclus dans chaque script et dans [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

## Signature

Les scripts et le dépôt sont actuellement non signés. La demande de Philippe Bernhard pour une identité de développeur certifié PixInsight (CPD), CCD1024, est en cours. Après approbation, il pourra signer ses scripts et ce dépôt avec cette identité.

