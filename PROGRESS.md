# Suivi d'avancement — Cimes

Fichier d'état pour reprendre le travail dans une nouvelle session (contexte perdu).

**Protocole de reprise :**

1. Lire `PLAN.md` (décisions, architecture, risques), puis ce fichier.
2. Se placer sur la branche `claude/grilling-peak-viser-clone-867km0` et `git pull`.
3. Reprendre à la première case non cochée ci-dessous.
4. Après chaque étape : cocher ici, committer, pousser. Jamais plus d'une étape sans sauvegarde.

## Phase 0 — échafaudage

- [x] Vite + Svelte 5 + TypeScript strict + Vitest + Prettier, coque App sombre alpin, i18n fr
- [x] CI GitHub Actions (format + check + tests + build) + déploiement GitHub Pages
- [ ] ⚠ Action manuelle (propriétaire du repo) : activer Pages — Settings → Pages → Source « GitHub Actions »

## Phase 1 — panorama

- [x] 1.1 Module `geo` : géodésie pure (distances, caps, projection locale, courbure/réfraction) + tests
- [x] 1.2 Module `terrain` : maths des tuiles slippy + décodage terrarium + HeightField bilinéaire + tests
- [x] 1.3 Chargeur de tuiles navigateur (fetch + ImageBitmap) et assemblage multi-tuiles en heightfield
      (cache mémoire 512 tuiles ; cache IndexedDB remis à la phase 3)
- [x] 1.4 Moteur panorama Three.js : maillage LOD en anneaux, caméra au sol, contrôles azimut/élévation
- [x] 1.5 Ciel + brume de distance + courbure terrestre appliquée au maillage
      (reste pour 1.10 : ciel en dégradé, fondu entre DEM proche z12 et lointain z10 — fine
      couture visible vers 24 km ; vérifié par captures Playwright, cf. « Notes environnement »)
- [x] 1.6 Module `peaks` : client Overpass + parsing + cache IndexedDB + tests
- [x] 1.7 Module `visibility` : ligne de vue par raymarching sur heightfield (Web Worker) + tests
- [x] 1.8 Module `labels` : projection 3D→2D, priorisation, anti-chevauchement + tests ; étiquettes en overlay DOM
      (+ mini-fiche sommet au clic, vérifié visuellement avec fixture Overpass — Mont Blanc,
      Aiguille du Midi, etc. correctement ancrés)
- [x] 1.9 Géolocalisation + recherche Nominatim + état du point de vue dans l'URL + mini-fiche sommet
      (vérifié : téléportation Chamonix → Zermatt avec fixtures, Cervin étiqueté à 8,6 km ;
      piège corrigé : ne jamais passer un proxy $state à postMessage/au moteur — copier)
- [x] 1.10 Performances mobiles (budget triangles, travail en workers) + polish visuel
      (fondu DEM proche/lointain, dôme céleste en dégradé, maillage construit dans un worker
      dédié avec aller-retour des tampons par transfert, rendu à la demande, grille allégée
      sur écrans tactiles ; échantillonneur partagé entre workers terrain et visibilité)

**Phase 1 terminée** — le mode panorama « v1 solide » du PLAN.md est complet.

## Notes environnement (sessions Claude Code distantes)

- La politique réseau du bac à sable n'autorise que certains hôtes : `s3.amazonaws.com`
  (tuiles terrarium) passe **via curl uniquement** — Chromium se fait réinitialiser dessus,
  et `overpass-api.de` / `nominatim.openstreetmap.org` / `openfreemap.org` sont refusés (403
  proxy). L'app déployée n'est pas concernée.
- Vérification visuelle : lancer `npm run dev`, puis un script Playwright
  (`executablePath: '/opt/pw-browsers/chromium'`) qui **intercepte `https://s3.amazonaws.com/**`
  et sert les tuiles via `curl`** (voir scratchpad `shot.mjs` de la session, à recréer au besoin).
- Les modules `peaks` (Overpass) et la recherche Nominatim se testent donc par fixtures ;
  ne pas perdre de temps à déboguer le réseau du bac à sable.

- [x] Rapport de débogage embarqué (zéro backend) : journal circulaire (100 événements) +
      fournisseurs d'état par composant (`lib/debug/report`, testé), instrumentation du mode
      Viser (capteurs bruts, démarrage caméra, données, visibilité, chaque calibrage avec
      statistiques de confiance et résultat du matcher) et du panorama ; bouton « Copier le
      rapport de débogage » dans ⚙ (repli textarea si presse-papiers refusé). L'utilisateur
      colle le JSON dans la conversation — rien ne quitte l'appareil sans ce geste.

## Phase 2 — carte 3D (détail à affiner en fin de phase 1)

- [x] MapLibre GL + terrain terrarium + marqueurs de sommets + fiches + lien panorama ↔ carte
      (bascule Panorama/Carte dans l'en-tête, mode dans l'URL `&mode=carte`, marqueurs DOM
      rafraîchis au déplacement avec anti-course, fiche → « Voir le panorama d'ici », FAB
      « Panorama ici » ; à re-vérifier sur l'app déployée : rendu hillshade/terrain 3D,
      invisible sous SwiftShader headless bien que les tuiles se chargent sans erreur)

## Phase 3 — PWA

- [x] Manifest + service worker + attributions complètes
      (installable, coque en cache-first, navigation avec repli hors-ligne, tuiles S3 en
      cache plafonné à 600 entrées ; vérifié sur build de prod : enregistrement, activation,
      portée /peak/, cache coque créé)

## Backlog (après les 3 phases du plan)

- [x] Recalage automatique sur l'horizon (mode Viser) : profil d'horizon théorique calculé
      par le worker de visibilité (marche de rayon 360°), détection ciel→terrain dans l'image
      caméra réduite (contraste par sommes préfixes, sans IA), mise en correspondance
      cap+assiette par recherche sur grille avec régularisation d'assiette (l'ambiguïté
      cap/assiette d'un horizon rectiligne est départagée en faveur de la gravité). Bouton
      « Recaler sur l'horizon », appliqué seulement si l'alignement est net (mae ≤ 1,5°),
      sinon message et recalage manuel. Testé : +7°/−1° retrouvés à ±0,5° sur horizon
      synthétique ; échec propre vérifié en prod sur image sans horizon. Restent le terrain
      réel (votre téléphone) et, si concluant, un suivi continu en option.
- [x] Horizon calculé affiché dans le mode Viser : polyligne SVG du profil théorique,
      projetée avec les mêmes conventions de caméra que les étiquettes (`skylineScreenPoints`,
      testé) — repère visuel pour le recalage manuel et lecture directe de ce que « pense »
      le recalage automatique.
- [x] Crêtes intermédiaires dans le mode Viser : la marche de rayon relève, en plus de
      l'horizon, chaque silhouette de relief vue devant un relief plus lointain (saut de
      profondeur ≥ 30 % et creux ≥ 0,5° derrière la crête, ce qui écarte les ondulations
      du DEM et la plaine qui s'enfonce sous la courbure) ; les crêtes des azimuts voisins
      sont chaînées par continuité de distance en polylignes (`computeDemProfile`, testé,
      couture 360° recousue), tracées plus fines que l'horizon dans le SVG et la capture
      de débogage. Mesuré sur Chamonix (tuiles réelles) : 27 crêtes, la plus longue sur 76°.
- [x] Étiquettes : un petit sommet ne cache plus un gros. La priorité de placement est
      l'importance absolue (altitude + 2 × proéminence, `peakImportance`) et non plus la
      hauteur apparente — qui reste le critère de CHOIX des sommets (`topPeaksFrom`).
      Une étiquette dont la place est prise n'est plus jetée : elle est surélevée (jusqu'à
      trois niveaux, trait de rappel allongé, `lift` dans `PlacedLabel`), à l'écran comme
      dans la capture de débogage ; elle disparaît seulement faute de place sous le bord
      haut. Testé (priorité, empilement, renoncement en haut d'écran).
- [x] FOV caméra mesuré par l'horizon (le web ne l'expose pas) : recherche à trois
      dimensions cap × assiette × FOV (40–80°, grossier→fin) dans matchSkyline, a priori
      très doux vers le FOV courant (surface de coût plate : le cap absorbe une partie de
      la compression), persisté par appareil (`cameraFovDeg`) uniquement sur alignement
      excellent (mae ≤ 0,8°) et utilisé partout (étiquettes, horizon, glissés). Testé :
      68° retrouvés à ±2° depuis une hypothèse à 55°.
- [x] Retour terrain « horizon trop haut à l'écran » (biais d'assiette des capteurs) :
      glissé vertical = recalage d'assiette en mode capteurs (borné ±20°, il ne corrigeait
      que le cap), fenêtre d'assiette du matcher élargie à ±8°, et départage du cap sur
      horizon plat (pénalité minuscule sur |hOff| — l'égalité prenait sinon le premier
      candidat de la grille, −25°). Testé : plaine avec biais de −5° → assiette corrigée,
      cap intact.
- [x] Rapport terrain n° 1 (iPhone **paysage**, bord de mer — calibrage toujours refusé :
      assiette épinglée à +8°, FOV à 40°, mae ~4,4° malgré une confiance médiane de 1,0).
      Diagnostic reproduit par simulation sur le matcher réel ; trois corrections.
      (a) Le calibrage analysait le **plein cadre** caméra alors qu'`object-fit: cover`
      n'en affiche qu'une bande centrale en paysage (~58 % de la hauteur pour la vue du
      rapport) : le premier plan **invisible à l'écran** accrochait le détecteur pendant
      que l'utilisateur cadrait un horizon propre — il n'analyse plus que la découpe
      visible (`lib/viser/videoView`, module pur testé). (b) Un seul nombre servait de
      FOV vertical à la fois à l'écran (étiquettes, horizon, glissés) et au cadre caméra
      (calibrage) — quantités incompatibles en paysage (facteur ~0,58 en tangente) :
      étiquettes et horizon ne pouvaient pas coller à la vidéo. Le réglage persisté
      devient `cameraShortFovDeg` (FOV du petit côté du capteur, invariant en rotation
      d'écran ; l'ancien `cameraFovDeg` est ignoré), le FOV d'écran s'en déduit par la
      découpe. (c) Matcher robuste : erreur par colonne plafonnée (3°) pour qu'une
      minorité de colonnes parasites (reflets en contre-jour marin, premier plan) ne
      tire plus assiette et FOV vers les bornes ; application seulement si la MAE des
      colonnes concordantes ≤ 1° ET ≥ 60 % de colonnes concordantes (`isMatchReliable`,
      testé) — un accrochage majoritaire est refusé au lieu d'appliquer un recalage faux,
      un accrochage minoritaire n'empêche plus le verrouillage. Au passage, corrigé le
      double chargement visible dans le journal du rapport (`start()` ET l'$effect
      lançaient chacun `loadData` → deux « viser:donnees », deux workers) avec garde
      anti-course pendant les await. Limite connue : le **roulis** n'est pas modélisé —
      téléphone penché ⇒ refus propre du calibrage (mae > 1°) ; à modéliser depuis les
      capteurs si les rapports le redemandent.

- [x] Réglages (qualité de rendu, unités) — panneau ⚙ dans l'en-tête, persistés en
      localStorage ; qualité Auto/Élevée/Économique (densité du maillage + pixelRatio,
      rechargement du terrain), unités métriques/impériales dans étiquettes, fiches et
      marqueurs (vérifié sur build de prod : bascule en direct + persistance)
- [x] Icônes PWA en PNG 192/512 + variante maskable (générées depuis le SVG via Chromium)
- [ ] Vérifier hillshade/terrain MapLibre sur l'app déployée (angle mort SwiftShader du bac à sable)
- [x] Étiquettes : nom `name:fr` vs local selon préférence (réglage « Noms des sommets »,
      appliqué au panorama et à la carte sans rechargement) ; proéminence OSM parsée et
      intégrée au score de priorité (altitude + 2 × proéminence, sélection et étiquetage)
- [x] Phase 4 : AR livrée en web (amendement de la décision n° 2, cf. PLAN.md) — mode
      « Viser » : caméra `getUserMedia` + orientation appareil (matrice W3C ZXY → cap/assiette,
      module pur testé ; `webkitCompassHeading` iOS géré), étiquettes des sommets visibles
      par-dessus, recalage boussole au doigt, repli « glisser pour viser » sans capteurs,
      permission iOS demandée au geste. Vérifié en prod : caméra factice + orientations
      synthétiques (sud → Mont Blanc, est → Aiguille Verte, recalage +7°). Piège corrigé :
      `setPointerCapture` sur un conteneur retarge les `click` — ignorer les appuis sur boutons.
      (App native : option future si la précision des capteurs web déçoit.)
- [x] Boussole du mode Viser : ruban de cap gradué en haut de la vue (graduations fines
      tous les 5°, hautes tous les 15°, lettres cardinales tous les 45°, N en accent),
      projeté avec la même caméra que les étiquettes — tangente du FOV horizontal, assiette
      ignorée (affichage tête haute) — pour que « N » tombe sous les sommets plein nord ;
      module pur `lib/viser/compass` testé (bornes du champ, symétrie, franchissement du
      nord, espacement en tangente). Repère central + cap chiffré sous le ruban :
      l'ancienne pastille « 245° · SO » y déménage (elle chevauchait l'en-tête sur mobile),
      et le ruban suit capteurs, glissés de recalage et mode sans capteurs.
- [x] PWA installable sur iPhone (« une app plutôt qu'un site ») : icône tactile 180×180
      opaque et 11 écrans de démarrage portrait générés depuis le SVG par
      `scripts/generate-ios-assets.mjs` (Playwright ; dans le bac à sable :
      `CHROMIUM_PATH=/opt/pw-browsers/chromium`), balises Apple dans index.html (titre,
      barre de statut translucide, startup-image à correspondance exacte points × densité,
      sinon iOS les ignore), zones sûres `env(safe-area-inset-*)` sur l'en-tête, le pied de
      page et l'UI ancrée aux bords des trois vues, ruban de boussole compris
      (encoche/Dynamic Island/barre home, portrait et paysage), `"id"` ajouté au manifest,
      coque SW passée en v2 — règle établie : les fichiers publics non hachés sont épinglés
      cache-first, bump obligatoire à chaque édition —, aide « Installer l'app » dans ⚙
      visible seulement sur iOS hors standalone (`lib/pwa/install`, module pur testé).
      Vérifié sur build de prod : balises rebasées /peak/, assets servis, coque v2. Restent
      les vérifications sur iPhone réel : installation, icône, lancement sans flash blanc,
      plein écran sans chevauchement de la barre de statut, hors-ligne après une première
      session en ligne dans l'app installée (stockage partitionné, distinct de Safari),
      caméra + capteurs du mode Viser en standalone.
- [x] Retours d'usage mobile : (a) plus de pied de page de crédits — les attributions
      ODbL/OSM/tuiles (décision n° 14 : elles restent affichées dans l'app) déménagent
      dans le panneau ⚙, section « Données » ; le panneau plafonne sa hauteur et défile.
      (b) Portrait pris en charge : sous 640 px l'en-tête quitte le flottant une-ligne
      (qui débordait) et repasse dans le flux sur deux rangées — titre + modes + ⚙,
      recherche en pleine largeur dessous — la vue commence sous l'en-tête, plus aucun
      chevauchement avec HUD/boussole, zones sûres conservées. (c) Zoom du mode Viser :
      pincement à deux doigts (molette au bureau), numérique ×1 à ×4 (`scale()` CSS
      centré sur la vidéo) ; le FOV de vue suit en espace tangente — `coverCrop`,
      `screenFovDeg` et `shortSideFovDeg` prennent un facteur de zoom (testés) — donc
      étiquettes, ruban de boussole, horizon et glissés restent alignés sous zoom, et le
      calibrage automatique analyse la découpe zoomée réellement visible puis re-mesure
      le FOV capteur en dézoomant sa conversion. Badge « 2,4× » (virgule française),
      accroche à ×1 en fin de pincement ; `setPointerCapture` toléré en échec (pointeur
      déjà relâché — vu en pointeurs synthétiques). Vérifié au navigateur (Playwright,
      caméra simulée par canvas) : molette jusqu'à la butée ×4, pincements ×2,6 → ×1,3 →
      retour ×1 badge masqué, transform vidéo cohérente, en-tête portrait et réglages OK.
- [x] Rapport terrain : boussole instable téléphone à la verticale (la pose du viseur).
      Cause : `webkitCompassHeading` iOS est l'azimut du HAUT de l'appareil — à la
      verticale, le haut pointe le zénith, sa projection horizontale n'est que du bruit,
      et cette valeur remplaçait α à chaque événement. Correction : filtre complémentaire
      (`lib/viser/aimFilter`, module pur testé) — le gyroscope (α relatif, β, γ, doux dans
      cette pose) porte la dynamique image par image ; la boussole n'apprend que le
      DÉCALAGE vers le nord vrai, pondéré cos β (1 à plat, 0 à la verticale, nul au-delà
      où l'azimut du haut se retourne de 180°), convergence ~3 s à plat ; lissage de
      sortie par l'arc court (τ = 0,1 s) avec saut direct au-delà de 45° ; boussole
      d'`accuracy` négative (non étalonnée) ignorée. Au passage : les deux flux Android
      (absolu + relatif, origines de cap différentes) ne sont plus mélangés — le relatif
      est écarté tant que le flux absolu vit. Décalage appris et poids courant exposés au
      rapport de débogage (`filtreBoussole`). Vérifié au navigateur (événements iOS
      synthétiques) : pose inclinée → « 90° · E » appris immédiatement ; à la verticale,
      boussole battant de ±40° → cap affiché strictement stable sur 150 événements, et la
      rotation au gyroscope continue de suivre (tests unitaires du module).
- [x] Revue « l'horizon généré ne colle pas au vrai » : biais systématique d'azimut
      identifié dans la projection locale équirectangulaire (`localEastNorth` /
      `localToLatLon`) — elle ne préserve pas les caps : une crête à 90 km plein est
      était placée à ~0,4° au sud de son cap apparent réel (l'erreur croît en
      tan(latitude)·distance², signes opposés à l'est et à l'ouest du nord — donc
      inrattrapable par un recalage de cap, qui est global). Horizon calculé, étiquettes
      de sommets et panorama 3D glissaient tous du même gauchissement par rapport aux
      sommets réels. Correction : la projection locale devient azimutale équidistante —
      atan2(est, nord) = cap initial vrai du grand cercle, hypot = distance orthodromique
      (`initialBearing`/`haversineDistance` à l'aller, `destinationPoint` au retour,
      réciprocité exacte) — mêmes signatures, aucun appelant modifié. Par construction :
      bacs du profil d'horizon = caps vrais, azimuts d'étiquettes = caps vrais, et la
      marche de visibilité suit désormais la trace au sol exacte du rayon lumineux
      œil→sommet. Coût : quelques appels trigonométriques de plus par échantillon,
      dans les workers uniquement, une fois par point de vue. Validé par un harnais de
      revue jetable contre une référence sphérique exacte (grand cercle + rayon effectif) :
      gauchissement 0,000° à toutes distances/caps après correction (0,42° avant),
      élévations à ≤ 0,001°, polyligne écran à ≤ 0,2 px de la silhouette de référence ;
      aller-retour `projectToScreen` ↔ `pixelToAngles` exact au passage. Reste en
      connaissance : la verticale du modèle reste la normale sphérique (déviation de la
      verticale et géoïde ignorés, < 0,01° dans les Alpes).
- [x] Vérification de bout en bout de l'horizon (`npm run test:e2e`, opt-in
      `CIMES_E2E=1`, hors du `npm test` courant) — deux étages au-dessus des tests
      unitaires. (1) **Données réelles** : les vraies tuiles AWS Terrain Tiles autour de
      Chamonix traversent la chaîne de production (assemblage → champ géoréférencé →
      échantillonneur fondu → profil d'horizon) ; l'œil ressort à l'altitude de la
      vallée, et le Mont Blanc comme l'Aiguille du Midi (sommets « dominants » de leur
      rayon) tombent à leur cap vrai (± 0,6°) et à leur angle d'élévation vrai
      (−0,9/+0,3°) ; l'Aiguille Verte, masquée par la crête du Montenvers depuis le
      centre-ville, ne vérifie que le plancher. Attrape géoréférencement, décodage
      terrarium et couture de blocs sur données vivantes ; tuiles en cache disque,
      téléchargement par curl. (2) **Navigateur** : le build de production tourne dans
      Chromium (Playwright) — tuiles d'altitude et Overpass simulés depuis un monde
      synthétique analytique, caméra remplacée par un canvas qui « filme » la silhouette
      de référence exacte (grand cercle, rayon effectif), capteurs
      `deviceorientationabsolute` synthétiques. Mesuré sur CAPTURES D'ÉCRAN : la
      polyligne rouge épouse l'horizon visible de la vidéo (médiane 1 px, p90 2 px sur
      ~170 colonnes), l'étiquette du sommet s'ancre sur la crête (± 7 px, repère fenêtre
      vs conteneur Viser converti), puis un biais capteurs injecté (+6° cap, −3°
      assiette) fait visiblement décrocher la ligne (> 10 px) et « Recaler sur
      l'horizon » l'annonce (−6°) et la rattrape (≤ 4,5 px). Chromium de l'environnement
      en repli si la révision Playwright n'est pas provisionnée. Outillage dédié :
      codec PNG minimal Node (zlib), monde synthétique partagé tuile/référence
      (`src/e2e/`), `tsconfig.e2e.json` typé Node (le tsconfig app exclut `src/e2e`).
      Répartition assumée : le gauchissement d'azimut fin (~0,2° à ces distances) reste
      épinglé par le test unitaire de `localEastNorth` et le cap vrai des sommets réels ;
      l'étage navigateur couvre tout le reste de la chaîne (FOV/découpe `cover`, capteurs,
      workers, projection, SVG, calibrage) au pixel près.
- [x] Capture de la vue caméra pour Claude (débogage) : le rapport JSON dit ce que l'app
      CROIT viser, la capture montre ce que la caméra voit VRAIMENT. Bouton « 📸 Capture
      pour Claude » en mode Viser (et dans ⚙ tant que la visée tourne) : la découpe
      réellement visible du flux (`cover` + zoom, comme le calibrage) est redessinée dans
      un canvas borné à 1280 px de côté long, surmontée de l'horizon calculé (même rouge
      que l'overlay), des étiquettes de sommets avec leur trait de rappel, et d'un bandeau
      gravant cap, assiette, recalages, FOV vue/capteur (étalonné ou non), zoom, présence
      des capteurs et de l'horizon — l'image se lit seule, détachée du rapport. JPEG remis
      par la feuille de partage native quand elle existe (iOS : « Enregistrer dans
      Photos », Messages…), sinon par téléchargement ; un partage ANNULÉ ne déclenche pas
      de téléchargement surprise. Zéro backend, zéro accès direct : Claude ne voit la
      caméra que par le fichier que l'utilisateur joint lui-même, et les métadonnées de la
      dernière capture rejoignent le rapport JSON (`derniereCapture`). Module
      `lib/debug/snapshot` (registre de source, bornage de taille, nom horodaté, légende,
      remise injectable) testé ; vérifié au navigateur (scénario 3 de `test:e2e`) SUR
      L'IMAGE PRODUITE : dimensions = celles de la vue, JPEG non trivial, ligne rouge
      gravée à 4,5 px près de l'horizon vidéo (la mise à l'échelle vue → image est donc
      juste) et bandeau de légende présent.
- [x] Rapport terrain n° 2 (première capture réelle, Chartreuse depuis Chambéry) : la ligne
      rouge épouse la crête à 2,5 px près (médiane, ≈ 0,16° ; p90 3,5 px) sur toute la
      largeur — le recalage automatique fait son travail (+18,1° de cap, la boussole était
      donc à 18° du nord vrai). Deux défauts trouvés DANS le bandeau de la capture :
      (1) « capteur 40,0° (étalonné) » alors que 40° est exactement le plancher de
      recherche — l'optimum butait sur la borne et cette valeur bornée (non mesurée) était
      persistée ; les flux 16:9 (fréquents sur iPhone) ont un petit côté sous ce plancher.
      Correction : plancher à 28°, `SkylineMatch.fovAtBound` signale un optimum collé à une
      borne, et l'étalonnage n'est plus persisté dans ce cas (testé). (2) « 0 étiquette »
      indécidable — sommets non chargés, masqués par le relief, ou simplement hors du
      champ ? La légende donne désormais les trois nombres (chargés, en vue, dans le champ)
      et le motif du statut, plus l'horodatage, le point de vue et l'altitude de l'œil. Au passage : la capture est rendue à la résolution de la découpe source (et
      non aux points CSS de la vue — moitié du détail perdu sur écran dense) et la légende
      s'ajoute SOUS la photo, qui n'est plus masquée d'un pixel.
- [x] Rapport terrain n° 3 (capture depuis Saint-Jeoire-Prieuré, Bauges au cap 86°) : le
      correctif n° 2 tient — FOV mesuré à 50,5° (plus en butée), 300 sommets chargés et 16
      en ligne de vue. Mais l'horizon calculé passe SOUS la crête réelle : mesuré sur
      l'image, écart nul à gauche, +27 px (≈ 3,0°) au centre, +19 px à droite — un écart de
      FORME (cap résiduel ou FOV encore faux), pas un biais d'assiette constant. Le bandeau
      montrait aussi « recalage +380,5° » : le recalage de cap s'accumulait sans repli sur
      l'arc court, signature d'un utilisateur qui corrige au doigt un alignement qui
      résiste. Corrigés/instrumentés : `signedDeltaDeg` (lib/geo, testé) ramène le recalage
      dans (−180, 180] au glissé comme au calibrage ; la légende grave désormais la
      définition du flux caméra (4:3 ou 16:9 — décisif pour juger le FOV petit côté) et le
      verdict du dernier recalage (appliqué/refusé, MAE, % de colonnes concordantes, FOV
      retenu, mention « en butée ») ; ⚙ gagne « Oublier l'étalonnage caméra », sans quoi une
      optique mal mesurée restait persistée sans aucun moyen de la reprendre. Diagnostic
      final en attente d'une capture prise après remise à zéro de l'étalonnage.
- [x] Ouverture en mode Viser : l'app sert d'abord à identifier ce qu'on a devant soi.
      `DEFAULT_MODE = 'viser'` (lib/viewpoint/url, testé) — une adresse nue ouvre la visée,
      les liens partagés portent `mode=panorama` ou `mode=carte` explicitement (le mode par
      défaut n'est plus écrit dans l'URL). Corollaire indispensable : sans coordonnées dans
      l'URL, la position est demandée dès l'ouverture (une seule fois, échec ou refus =
      point de vue par défaut) — un horizon calculé depuis Chamonix n'a aucun sens sur la
      caméra de quelqu'un qui vise les Bauges. La provenance du point de vue (défaut, lien,
      GPS, recherche, carte) est suivie, exposée au rapport de débogage (fournisseur `app`)
      et gravée dans la capture : « point de vue 45.5881, 5.8764 (GPS) ». Vérifié au
      navigateur : adresse nue → onglet Viser actif, géolocalisation appliquée, URL
      resynchronisée sans `mode=` ; `?mode=panorama` ouvre toujours le panorama.
- [x] Rapport terrain n° 4 : la légende enrichie donne la cause. « flux 640×480 » (iOS sert
      du VGA sans contrainte) et surtout « FOV vue 17,5° (en butée) » alors que la vue est
      dessinée à 22,3° : le garde-fou n° 2 refusait bien d'adopter cette optique bornée,
      mais le CAP et l'ASSIETTE trouvés AVEC elle étaient tout de même appliqués. Or ils ne
      valent que pour le FOV qui les a produits — d'où un horizon qui colle au bord gauche
      et décroche de 3° au centre (mesuré sur l'image : +2 px à gauche, +41 px au centre,
      +19 px à droite, pour 0,076°/px). Corrigé : quand la mesure d'optique n'est pas
      adoptée, la mise en correspondance est REFAITE au FOV réellement en usage, et c'est
      celle-là qui s'applique (test unitaire : au FOV de la vue, le résidu de la mise en
      correspondance refaite est plus bas que celui héritée du FOV écarté). Deux corollaires :
      le flux est demandé plus fin en gardant le 4:3 (`width/height: ideal 1600×1200` —
      changer de forme changerait le FOV du petit côté), et l'aspect du flux est mémorisé
      AVEC l'étalonnage (`cameraStreamAspect`) : un flux de forme différente rend la mesure
      caduque et l'app repart du défaut plutôt que d'appliquer un angle faux en silence.
      La légende distingue enfin le FOV appliqué de l'optique mesurée écartée.
- [x] Rapport terrain n° 5 (capture + rapport JSON, Bauges depuis Cognin, flux 1600×1200) :
      la géométrie est BONNE — mesurée sur l'image, la ligne rouge est à 3 px de la crête
      (médiane sur 1280 colonnes, p90 4 px, soit 0,18°) avec le FOV par défaut (55°) et un
      recalage quasi nul. Le défaut est ailleurs : la DÉTECTION d'horizon dans l'image. La
      coupure à contraste maximal choisissait la limite montagne↔arbres plutôt que
      ciel↔montagne — mesuré sur la photo, elle tombait ligne 506 au lieu de 203, soit 18°
      trop bas — parce qu'une crête brumeuse est presque aussi claire que le ciel alors que
      le premier plan (arbres, toits) est très sombre. D'où les deux calibrages du journal :
      0 colonne concordante sur 240 au premier, puis 25 % avec un cap à −11° et une optique
      en butée à 17,5° — soit un recalage qui aurait ruiné un alignement parfait (le
      garde-fou l'a refusé, à raison). Correction : la détection descend chaque colonne
      depuis le haut et s'arrête là où le pixel QUITTE le ciel (référence médiane lue en
      haut de colonne, seuil relatif sur luminance ou bleu, confirmation sur 3 lignes,
      affinage sur le plus fort gradient), avec repli sur l'ancienne coupure quand le haut
      de colonne n'est pas crédible comme ciel (sombre ou texturé). Mesuré sur la photo du
      rapport : ligne 213 au lieu de 506 (crête à 203), confiance médiane 0,48, 172 colonnes
      sur 240 exploitables. Tests : cas synthétique à trois bandes (ciel clair, montagne
      brumeuse, arbres sombres) et cas du repli. Au passage, le rapport liste désormais cap,
      élévation et distance des sommets en vue — « 0 étiquette dans le champ » restait
      indécidable avec 16 sommets visibles.
- [x] Rapport terrain n° 6 : « 300 chargés, 16 en vue, 0 dans le champ » face à une crête
      parfaitement calée. Cause : `topPeaks` retenait les 300 sommets les plus importants
      DANS L'ABSOLU (altitude + 2 × proéminence) dans un rayon de 75 km. Depuis Chambéry,
      ces 300-là sont tous des 2500-3800 de Belledonne, de Vanoise et du Beaufortain —
      masqués par la muraille des Bauges — et la crête sous les yeux de l'utilisateur, un
      1550 à 7 km, n'entrait même pas dans la liste : rien à étiqueter, quoi qu'il vise.
      Correction : `apparentImportance` (hauteur apparente + moitié du relief propre vu à
      cette distance, courbure et réfraction comprises) et `topPeaksFrom`, qui prend le
      point de vue et l'altitude de l'œil — le mode Viser et le panorama choisissent
      désormais ce qui SE VOIT d'ici, et la priorité de placement des étiquettes suit le même
      critère (un sommet proche qui domine la vue passe devant un géant lointain quand les
      boîtes se chevauchent). La carte garde le tri absolu : une vue de dessus n'a pas de
      point de vue. Test de non-régression sur le cas réel : 400 sommets lointains de 2500
      à 3500 m plus la Croix du Nivolet — l'ancien tri l'évinçait des 300, le nouveau la
      met en tête.
- [x] Rapport terrain n° 7 : le nouveau détecteur mord. Deux recalages appliqués d'affilée,
      MAE 0,37° et **toutes** les colonnes concordantes (189/189 puis 165/165), optique
      adoptée puis persistée — FOV petit côté mesuré à 53,5°, valeur plausible pour un
      capteur 4:3 d'iPhone (c'était 0 puis 25 % de colonnes concordantes avant). En
      revanche le garde-fou d'aspect que je venais d'ajouter se trompait de critère : iOS
      fait pivoter le flux avec l'appareil (1600×1200 ↔ 1200×1600) et l'étalonnage mesuré
      en paysage était donc jeté en portrait (`etalonnageUtilisable: false`, retour au
      défaut 55°). `frameShape` (grand côté / petit côté, testé) normalise la forme : la
      rotation n'invalide plus rien, un vrai changement de format (16:9 vs 4:3) toujours si.
- [x] Rapport terrain n° 8 : ça marche. Sept sommets nommés posés sur la crête des Bauges
      (Croix du Nivolet, Mont Peney, Le Rebollion, L'Orionde, Sommet des Monts, Grand Roc),
      84 sommets en ligne de vue au lieu de 16, recalage appliqué avec MAE 0,19 degre et
      100 % de colonnes concordantes, optique adoptee (capteur 51,5 degres). Les correctifs
      des rapports 5 et 6 attendaient dans deux commits que la CI avait recales : le
      format:check echouait sur une ligne de PROGRESS.md que prettier reecrivait, et le job
      de deploiement depend du precedent — rien n'etait donc parti en ligne. A retenir :
      verifier la conclusion de la CI avant d'annoncer un deploiement. Derniere clarte de
      legende : quand l'optique est adoptee, la capture annonce desormais le FOV du PETIT
      COTE du capteur (invariant) plutot que le FOV de vue de l'instant — l'ecran a pu
      tourner entre le recalage et la capture, et les deux chiffres divergent alors sans
      que rien ne soit faux.
- [x] Revue de l'algorithme du recalage : même résultat, 30 fois moins de calcul, et une
      précision qui n'est plus quantifiée. (1) `matchSkyline` évaluait le profil théorique
      pour chaque pose de la grille cap × assiette × FOV (~1,9 s sur Node desktop avec
      estimation du FOV, donc plusieurs secondes d'interface figée sur téléphone) alors que
      la lecture du profil ne dépend que du cap : elle est faite une fois par cap et
      réutilisée pour toutes les assiettes (modèle d'assiette au premier ordre, exact en
      dérivée : pOff·cos(azimut relatif)), puis un affinage EXACT par descente sur grille
      resserrée (0,5° → 0,03°) recalcule les angles de chaque colonne à l'assiette et au
      FOV testés — 58 ms mesurés, et la correction rendue n'est plus arrondie au pas de
      grille (l'ancienne quantification de 0,5° d'assiette valait jusqu'à 0,25° d'erreur
      systématique, l'ordre de grandeur des MAE observées sur le terrain) ; le modèle
      additif de l'ancienne grille se trompait aussi de ~0,5° aux colonnes de bord pour
      une correction d'assiette de 6°. (2) `computeDemSkyline` : pas de marche
      proportionnel à la distance (30 m au premier plan au lieu de 150 m fixes — une arête
      étroite à 2 km pouvait être sautée et l'horizon rabaissé de plusieurs degrés — puis
      0,25 % de la distance) et coupure du rayon dès que le plafond du relief chargé ne
      peut plus dépasser l'horizon déjà trouvé (borne monotone, cas de l'observateur au
      point culminant traité) : 184 ms depuis une vallée synthétique contre 450 ms avant,
      pour un échantillonnage cinq fois plus fin de près. (3) Échantillonneur d'altitude
      (chemin chaud du maillage, de la visibilité et de l'horizon) : origine de la
      projection inverse pré-réduite en sinus/cosinus, projection WebMercator faite une
      fois par champ au lieu de deux à quatre — 1,6 fois plus rapide. Tests : identité
      avec/sans plafond (et plafond sous l'œil), arête étroite résolue, corrections
      sous-grille à 0,1° près, grosse correction d'assiette exacte aux bords.
- [x] Habillage clair façon PeakVisor (amendement de la décision n° 13, capture d'écran de
      référence fournie). Thème : `app.css` passe en clair — fond blanc, accent turquoise,
      rouge pour l'alerte, variables partagées du chrome (`--round`, `--chrome-top`…) et
      classe globale `.btn-round`. Coque (`App.svelte`) : plus d'en-tête dans le flux, la vue
      occupe tout l'écran et le chrome flotte dessus — colonne de boutons ronds à gauche
      (≡ menu, loupe, « 3D » = carte), bouton rond à droite (crête = panorama depuis la
      visée, caméra = visée depuis les autres modes). Le menu ≡ ouvre un tiroir latéral
      (modes, réglages, débogage dont la capture caméra, crédits) ; la loupe déplie un champ
      de recherche blanc en haut. Étiquettes (`lib/labels`, testé) : capsules blanches
      couchées à 45° vers le haut-droit — nom en noir, altitude en blanc sur turquoise —
      ancrées par leur extrémité basse au sommet d'un trait de rappel vertical (48 px
      minimum) planté sur la pointe, point turquoise sur la pointe ; l'anti-chevauchement
      travaille désormais dans le repère incliné (rectangles alignés le long de l'axe des
      capsules : test exact), la surélévation d'un niveau dégage exactement une capsule
      voisine ; les sommets visibles sans place pour leur nom gardent un point sur la crête
      (`projectPeaks`). Viser : horizon calculé en trait fin sombre, crêtes intermédiaires
      en blanc ; le ruban de boussole et le bouton « Capture pour Claude » quittent l'overlay
      (la capture reste dans le menu ≡, où elle était déjà), « Recaler sur l'horizon » devient
      un bouton rond sous la colonne de gauche, le conseil de recalage ne s'affiche que huit
      secondes. Suivi figé : toucher une étiquette ouvre sa fiche ET fige la visée (capteurs
      ignorés, image et repères immobiles) — pilule rouge « Débloquer le suivi » en haut, un
      toucher sur l'image fige/rend aussi. Fiche de sommet (`PeakCard`, partagée par la
      visée, le panorama et la carte) : feuille blanche au bas de l'écran avec poignée
      (tirer vers le bas ou toucher pour fermer), nom en grand, altitude avec icône, « 12,4 km
      vers SO », boutons ☆ favori (persisté, `lib/favorites`, testé ; l'étiquette d'un favori
      porte une étoile), « Itinéraires » (sentiers OSM sur Waymarked Trails, centré sur le
      sommet), « Téléporter » (panorama depuis la pointe, source de point de vue « sommet »)
      et ⌖ voir sur la carte (carte centrée sur le sommet sans déplacer le point de vue).
      La capture de débogage redessine les capsules couchées comme à l'écran. Hors périmètre :
      le tracé de sentier jaune de la capture (données d'itinéraires, pas d'habillage).
      Test navigateur adapté : ancre = l'élément `.peak`, horizon sombre (plus rouge),
      colonnes de la capsule exclues d'après son rectangle réel, capture lancée depuis le menu.
