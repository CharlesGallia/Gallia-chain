# Étape 4 : voir et utiliser les Gallo

Trois briques, toutes sur le serveur, sans toucher à n8n :

| Brique | Rôle | Où |
|---|---|---|
| Indexeur (`indexeur/`) | range l'historique de la chaîne (virements, pains quotidiens, Gallis) | duniter-squid, logiciel libre de Duniter (AGPL-3.0), sans modification ; API sur 127.0.0.1:4350 |
| Galli.Pay (`galli-pay/`) | portefeuille et tableau « La Gallia en chiffres » | https://pay.gallia.space (page sur le port 8090, HTTPS par le Traefik existant) |
| Outils (`outils/`) | captures d'écran et essai automatique | `capture.js`, `essai_galli_pay.js` |

## Galli.Pay

Interface propre au Gallo, charte GALLIA « Nuit Impériale » (nuit `#0D0E1B`, or `#C6A56A`, ivoire `#F6F0E4`,
titres Cormorant Garamond, texte Inter). Aucun nom, logo ni écran de la Ğ1. Écrit pour la Gallia avec les
bibliothèques libres polkadot.js (Apache-2.0) et qrcode (MIT).

- Créer un compte : 12 mots secrets en français, générés dans le navigateur ; le compte y est rangé chiffré par le code secret du Galli.
- Retrouver un compte : 12 mots (français ou anglais) et, conseillé, l'adresse g1… pour retrouver le bon chemin de dérivation (comptes créés avec d'autres portefeuilles libres).
- Confirmer son identité après le KYC de la Titulus, et devenir Galli membre.
- Solde, pain quotidien à réclamer, recevoir (adresse et QR code), envoyer (refusé d'avance vers un compte non vérifié), historique.
- La Gallia en chiffres : nombre de Gallis, Gallibra du jour (pain et mérite), pain quotidien et prochain versement, Gallo en circulation, derniers virements, consultation d'un compte.

Les clés ne quittent jamais le navigateur. Le nœud n'accepte que les fonctions « sûres » (`--rpc-methods=safe`).

### Construire et lancer

    cd etape4/galli-pay
    docker run --rm -v "$PWD":/app -w /app node:20-alpine sh -c "npm ci && npm run build"   # produit public/app.js
    docker compose up -d

Traefik (déjà présent pour n8n, non modifié) découvre le conteneur par ses étiquettes et obtient le
certificat Let's Encrypt de `pay.gallia.space` dès que l'enregistrement DNS `A pay → 91.108.102.109` existe.

## Indexeur

    cd etape4/indexeur
    printf 'DB_NAME=squid\nDB_PASSWORD=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)" > .env   # une seule fois, hors Git
    docker compose up -d

`input/gallia.json` est la spécification lisible de la chaîne (`duniter build-spec --chain gallia_live`, sans `--raw`) :
l'indexeur y lit le bloc zéro. Les fichiers `*_hist.json` sont vides : la Gallia n'a pas d'histoire avant son bloc zéro.
Sa base est sauvegardée chaque nuit avec la chaîne (`sauvegarde/sauvegarde-nuit.sh`).

## Essai complet (chaîne de test)

Avec la chaîne de test (`gallia-local`, pain toutes les 10 minutes) et une copie de Galli.Pay branchée dessus
(`galli-pay/essai/nginx-essai.conf`, port 8091), un robot utilise la page comme un Galli :

    docker run --rm --network host -e NODE_PATH=/home/pptruser/gp/node_modules \
      -v "$PWD/captures":/home/pptruser/captures -v "$PWD/etape4/outils":/home/pptruser/outils:ro \
      -v "$PWD/etape4/galli-pay":/home/pptruser/gp:ro ghcr.io/puppeteer/puppeteer:23.11.1 node outils/essai_galli_pay.js

Résultat du 26/11/2026 : tout fonctionne. Compte créé (12 mots), virement refusé tant que le compte n'est pas
vérifié, identité créée par le Vérificateur puis confirmée dans Galli.Pay (« Galli membre »), pain réclamé
(0,00 → 8,22 GALLO), 0,50 GALLO envoyés à un Galli vérifié, envoi vers un compte non vérifié refusé avec un message clair.
