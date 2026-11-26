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
| Forgerons (nœuds) | 3 certifications de forgerons | reconnus par le KYC de la Titulus : invitation, sans certification de forgeron |
| Qui peut recevoir de la monnaie | tout compte | seulement les Gallis vérifiés par la Titulus, le Trésor, les Vérificateurs et les comptes techniques autorisés |
| Comptes à usage unique, échanges atomiques | oui | non (ils contourneraient la règle ; pas de pont vers une autre chaîne) |

Fichiers modifiés : `runtime/shared/parameters.rs`, `runtime/common/src/pallets_config.rs`,
`pallets/universal-dividend` (part du mérite, `set_merit_account`), `pallets/duniter-wot`
(Vérificateurs, `add_verifier`, `remove_verifier`, `claim_membership`, `renew_membership`,
comptes autorisés `authorize_account` / `unauthorize_account`, règle `can_receive`), `pallets/identity`
(le compte n'a plus besoin d'exister avant que le Vérificateur crée l'identité), `runtime/shared/runtime.rs`
(filtre des virements), `node/src/chain_spec/gtest.rs` et `node/src/command.rs` (chaînes `gallia_local` et `gallia_live`).

### Règle « seuls les comptes vérifiés reçoivent des Gallo »

Le filtre d'appels du runtime refuse tout virement (`balances.transfer_*`, `universalDividend.transfer_ud*`,
y compris caché dans un lot, un proxy ou un multisig) vers un compte qui n'est ni un Galli vérifié
(identité créée par un Vérificateur, non révoquée) ni un compte autorisé (Trésor, Vérificateurs, comptes techniques).
Les comptes à usage unique et les échanges atomiques sont désactivés. Limite connue : l'administrateur
(`sudo`), qui disparaîtra au profit de la gouvernance, n'est pas soumis au filtre.

## Parcours d'un nouveau Galli

1. Le Vérificateur crée son identité (`identity.create_identity`) : cela vaut sa certification.
   À partir de là, le compte peut recevoir des Gallo ; le Vérificateur lui envoie de quoi payer ses premiers frais.
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
entrée d'un Galli sans règle de distance, 3,00 GALLO au Trésor pour 7 membres, pain reçu par le nouveau Galli,
virements refusés vers un compte non vérifié, y compris par pain quotidien, compte à usage unique ou lot).

## Bloc zéro de la vraie chaîne

Copier `fondateurs.exemple.yaml` en `fondateurs.yaml`, y mettre les adresses publiques, puis
`python3 etape3/creer_bloc_zero.py` écrit `chain/resources/gallia.yaml` et `chain/resources/gallia-data.json`.
La spécification de la chaîne se construit ensuite avec `duniter build-spec --chain gallia_live --raw`
(fichier `chain/resources/gallia-raw.json`). Le nœud du serveur se lance avec `noeud/docker-compose.yml`
(ports 9944 et 9615 réservés au serveur, 30333 ouvert aux autres nœuds) ; ses clés sont dans `~/gallia-data`
et `~/gallia-secrets`, hors Git. `etape3/verifier_gallia.py <adresse>` montre l'état de la chaîne et d'un compte.
Sauvegarde chaque nuit à 3 h 30 : `sauvegarde/sauvegarde-nuit.sh` (7 dernières copies dans `~/gallia-backups`).
