# Étape 2 : Duniter v2 tel quel

Nœud de test Duniter v2 (image officielle `duniter/duniter-gtest-1000:1200-fast-2.3.3`, réseau de développement local,
données effacées à chaque arrêt). Accès RPC sur `127.0.0.1:9944` uniquement.

    docker compose up -d                       # démarrer
    docker build -q -t gallia-outils-py - <<< $'FROM python:3.12-slim\nRUN pip install -q substrate-interface'
    docker run --rm --network host -v "$PWD":/w:ro gallia-outils-py python /w/verifier.py             # état de la chaîne
    docker run --rm --network host -v "$PWD":/w:ro gallia-outils-py python /w/verifier.py --reclamer  # Alice réclame son dividende
    docker compose down                        # arrêter

Résultat du 26/11/2026 : 6 membres de test, dividende de 10 ĞT toutes les 10 minutes (version « fast » de test),
Alice est passée de 10 000,00 à 10 010,00 ĞT après avoir réclamé son premier dividende.

Note : `verifier.py` contient la phrase de test publique de Substrate (`bottom drive obey…`). Elle est connue de tous
et ne sert qu'aux réseaux de test : ce n'est pas un secret.
