#!/usr/bin/env bash
# Sauvegarde nocturne de la Gallia : données de la chaîne (+ trousseau du nœud et clés du serveur).
# Le nœud est arrêté quelques secondes pour une copie propre, puis relancé.
# Les sauvegardes vont dans ~/gallia-chaine-sauvegardes (hors Git, lisibles par root seulement), 7 dernières gardées.
# L'indexeur est sauvegardé par une copie (pg_dump) de sa base, sans l'arrêter.
set -euo pipefail
DEST="$HOME/gallia-chaine-sauvegardes"
JOUR=$(date +%Y-%m-%d)
mkdir -p "$DEST" && chmod 700 "$DEST"
trap 'docker start gallia-noeud >/dev/null 2>&1 || true' EXIT
docker stop -t 60 gallia-noeud >/dev/null
tar -C "$HOME" -czf "$DEST/gallia-$JOUR.tar.gz" gallia-data gallia-secrets
docker start gallia-noeud >/dev/null
chmod 600 "$DEST/gallia-$JOUR.tar.gz"
if docker ps -q -f name=gallia-indexeur-db | grep -q .; then
  docker exec gallia-indexeur-db pg_dump -U postgres -Fc squid > "$DEST/indexeur-$JOUR.dump"
  chmod 600 "$DEST/indexeur-$JOUR.dump"
  ls -1t "$DEST"/indexeur-*.dump | tail -n +8 | xargs -r rm --
fi
ls -1t "$DEST"/gallia-*.tar.gz | tail -n +8 | xargs -r rm --
echo "$(date -Is) sauvegarde OK : $DEST/gallia-$JOUR.tar.gz ($(du -h "$DEST/gallia-$JOUR.tar.gz" | cut -f1))"
