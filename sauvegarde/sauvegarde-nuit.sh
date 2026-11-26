#!/usr/bin/env bash
# Sauvegarde nocturne de la Gallia : données de la chaîne (+ trousseau du nœud et clés du serveur).
# Le nœud est arrêté quelques secondes pour une copie propre, puis relancé.
# Les sauvegardes vont dans ~/gallia-backups (hors Git, lisibles par root seulement), 7 dernières gardées.
# (L'indexeur sera ajouté ici à l'étape 4.)
set -euo pipefail
DEST="$HOME/gallia-backups"
JOUR=$(date +%Y-%m-%d)
mkdir -p "$DEST" && chmod 700 "$DEST"
trap 'docker start gallia-noeud >/dev/null 2>&1 || true' EXIT
docker stop -t 60 gallia-noeud >/dev/null
tar -C "$HOME" -czf "$DEST/gallia-$JOUR.tar.gz" gallia-data gallia-secrets
docker start gallia-noeud >/dev/null
chmod 600 "$DEST/gallia-$JOUR.tar.gz"
ls -1t "$DEST"/gallia-*.tar.gz | tail -n +8 | xargs -r rm --
echo "$(date -Is) sauvegarde OK : $DEST/gallia-$JOUR.tar.gz ($(du -h "$DEST/gallia-$JOUR.tar.gz" | cut -f1))"
