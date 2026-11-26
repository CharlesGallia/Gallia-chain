# Étape 3 : la chaîne Gallia

Le code de la chaîne est dans `chain/` : c'est Duniter v2 (`gtest-1000-2.3.3`, licence AGPL-3.0 conservée),
adapté à la Gallia. Chaque modification porte la mention « Gallia » dans le code.

## Ce qui change par rapport à Duniter

| Règle | Duniter (Ğ1) | Gallia |
|---|---|---|
| Monnaie | Ğ1, 2 décimales | GALLO, 2 décimales |
| Pain quotidien de départ | 10,00 | 1,00 Gallo par jour |
| Trésor du mérite | aucun | à chaque pain quotidien, 3/7 du pain créé va au Trésor (70 % pain / 30 % mérite) |
| Croissance | c² = 0,00238 (≈ 10 %/an) | c² = 0,7 × 0,00238, pour garder ≈ 10 %/an en comptant le mérite |
| Entrée d'un membre | 5 certifications + règle de distance | 1 certification du Vérificateur Titulus, sans règle de distance |
| Qui certifie / crée des identités | tout membre certifié 5 fois | uniquement les Vérificateurs (liste gérée par la gouvernance) |
| Délai entre deux certifications | 5 jours | aucun |
| Forgerons (nœuds) | 3 certifications | 1 au lancement (à remonter quand il y aura 3 à 5 nœuds) |

Fichiers modifiés : `runtime/shared/parameters.rs`, `runtime/common/src/pallets_config.rs`,
`pallets/universal-dividend` (part du mérite, `set_merit_account`), `pallets/duniter-wot`
(Vérificateurs, `add_verifier`, `remove_verifier`, `claim_membership`, `renew_membership`),
`node/src/chain_spec/gtest.rs` et `node/src/command.rs` (chaînes `gallia_local` et `gallia_live`).

## Parcours d'un nouveau Galli

1. Le Vérificateur crée son identité (`identity.create_identity`) : cela vaut sa certification.
2. Le Galli confirme son identité avec son portefeuille (`identity.confirm_identity`, son pseudonyme).
3. Le Vérificateur (ou le Galli) valide l'adhésion (`wot.claim_membership`).
4. Chaque année, l'adhésion se renouvelle (`wot.renew_membership`), et la certification tous les deux ans.

## Compiler et tester

    chain/gallia-build.sh fast      # version de test : pain toutes les 10 minutes
    chain/gallia-build.sh           # version réelle : pain chaque jour

    # chaîne de test locale (comptes de test publics //Alice = Vérificateur, //Tresor = Trésor)
    docker run -d --name gallia-local --network host --entrypoint /usr/local/bin/duniter \
      -v ~/gallia-build/duniter-gallia-fast:/usr/local/bin/duniter:ro duniter/duniter-gtest-1000:1200-fast-2.3.3 \
      --dev --rpc-port 9945 --port 30334 --prometheus-port 9616 --rpc-cors all --rpc-methods unsafe --no-telemetry
    docker run --rm --network host -v "$PWD/etape3":/w:ro gallia-outils-py python /w/tester_gallia.py --attendre-pain

Résultat du 26/11/2026 : tous les contrôles passent (symbole, pain de 1 Gallo, refus des non-Vérificateurs,
entrée d'un Galli sans règle de distance, 3,00 GALLO au Trésor pour 7 membres, pain reçu par le nouveau Galli).

## Bloc zéro de la vraie chaîne

Copier `fondateurs.exemple.yaml` en `fondateurs.yaml`, y mettre les adresses publiques, puis
`python3 etape3/creer_bloc_zero.py` écrit `chain/resources/gallia.yaml` et `chain/resources/gallia-data.json`.
La spécification de la chaîne se construit ensuite avec `duniter build-spec --chain gallia_live`.
