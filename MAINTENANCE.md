# Maintenir AIP-Scripts

- Dépôt GitHub : https://github.com/CCD1024/AIP-Scripts
- Dépôt de mises à jour : https://ccd1024.github.io/AIP-Scripts/
- Publication GitHub Pages : branche `main`, dossier `/docs`.

## Ajouter ou mettre à jour un script

1. Placer son code dans `src/`, avec un numéro de version explicite.
2. Construire une nouvelle archive ZIP sous `docs/packages/`. Son contenu doit reproduire les chemins d'installation PixInsight, par exemple `src/scripts/SHORGB-AIP/SHORGB-AIP.js`.
3. Ajouter ou mettre à jour l'entrée correspondante dans `docs/updates.xri`, avec le nom de l'archive, son empreinte SHA-1, la date de publication, la description et les versions PixInsight ciblées.
4. Mettre à jour le README et le CHANGELOG.
5. Vérifier l'archive, les chemins déployés et l'installation avant de diffuser la mise à jour.

SHOLuminance-AIP est conservé dans `src/SHOLuminance-AIP/`, avec `AIP.svg` à côté du fichier JavaScript. Son archive installe ces fichiers sous `src/scripts/CCD1024/SHOLuminance-AIP/`. Les directives `#feature-id SHOLuminance_AIP : CCD1024 > SHOLuminance-AIP` et `#feature-icon AIP.svg` définissent le sous-menu et l'icône ; elles doivent rester cohérentes avec l'archive. Sa notice est incluse dans le même dossier.

Les utilisateurs conservent la même adresse pour tous les scripts du dépôt. Les numéros de version et les archives sont propres à chaque script. Ne pas modifier une archive déjà publiée sous le même nom.

## Signatures

La première version est non signée. Pour signer une prochaine publication : utiliser une identité de développeur certifiée PixInsight, signer le script, ajouter sa signature `.xsgn` dans l'archive, mettre à jour l'empreinte de cette archive dans `updates.xri`, puis signer le manifeste en dernier. Ne jamais publier les clés privées de signature.

## Versions ciblées

Le manifeste initial couvre PixInsight 1.9.4 à 1.9.6. Les dernières vérifications du script ont été faites avec PixInsight 1.9.6 sous macOS. La déclaration multiplateforme ne constitue pas un compte rendu de test sous Windows et Linux.
