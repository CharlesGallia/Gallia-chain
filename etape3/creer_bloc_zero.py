"""Étape 3 : fabrique le bloc zéro de la Gallia à partir de fondateurs.yaml.

Le fichier fondateurs.yaml ne contient QUE des clés publiques (adresses g1…) et des pseudonymes :
jamais de phrase secrète. Ce script écrit :
  - chain/resources/gallia.yaml       (réglages : pain de départ, Vérificateur, Trésor, forgeron…)
  - chain/resources/gallia-data.json  (identités, certifications et soldes du bloc zéro)

Usage : python3 creer_bloc_zero.py [fondateurs.yaml]
"""
import json
import sys
import time
from pathlib import Path

import yaml

ICI = Path(__file__).resolve().parent
RESSOURCES = ICI.parent / "chain" / "resources"
ENTREE = Path(sys.argv[1]) if len(sys.argv) > 1 else ICI / "fondateurs.yaml"

AN = 365 * 24 * 3600
PAIN_DE_DEPART = 100  # 1 Gallo = 100 unités de base (deux décimales)
DEPOT_MINIMUM = 100  # 1 Gallo : transféré au bloc zéro au trésor de gouvernance de Duniter

cfg = yaml.safe_load(ENTREE.read_text(encoding="utf-8"))


def erreur(msg):
    sys.exit(f"ERREUR : {msg}")


def adresse(valeur, quoi):
    if not isinstance(valeur, str) or not valeur.startswith("g1") or len(valeur) < 40:
        erreur(f"{quoi} : adresse publique g1… attendue, reçu {valeur!r}")
    return valeur


verif = cfg.get("verificateur") or erreur("section `verificateur` manquante")
fondateurs = cfg.get("fondateurs") or erreur("au moins un fondateur est nécessaire")
pseudos = [verif["pseudo"]] + [f["pseudo"] for f in fondateurs]
if len(set(pseudos)) != len(pseudos):
    erreur("deux identités ont le même pseudonyme")
adresses = [adresse(verif["adresse"], verif["pseudo"])] + [adresse(f["adresse"], f["pseudo"]) for f in fondateurs]
if len(set(adresses)) != len(adresses):
    erreur("deux identités ont la même adresse")
tresor = adresse(cfg.get("tresor"), "tresor")
admin = adresse(cfg.get("administrateur"), "administrateur")
forgeron = cfg.get("forgeron") or erreur("section `forgeron` manquante")
if forgeron["pseudo"] not in pseudos:
    erreur(f"le forgeron `{forgeron['pseudo']}` doit être une identité du bloc zéro")
comite = cfg.get("comite_technique") or [fondateurs[0]["pseudo"]]
for p in comite:
    if p not in pseudos:
        erreur(f"membre du comité technique `{p}` inconnu")

maintenant = int(time.time())
fin_adhesion = maintenant + AN  # adhésion d'un an, renouvelable
fin_certif = maintenant + 2 * AN  # certification valable deux ans
revocation = maintenant + 2 * AN

identites = {}
premier = fondateurs[0]["pseudo"]
for i, (pseudo, addr) in enumerate(zip(pseudos, adresses), start=1):
    est_verif = i == 1
    identites[pseudo] = {
        "index": i,
        "owner_pubkey": None,
        "owner_address": addr,
        "old_owner_key": None,
        "membership_expire_on": fin_adhesion,
        "membership_revokes_on": revocation,
        "revoked": False,
        # Le Vérificateur porte le dépôt minimum, aussitôt versé au trésor de gouvernance.
        "balance": DEPOT_MINIMUM if est_verif else 0,
        # Chaque fondateur est certifié par le Vérificateur ; le Vérificateur par le premier fondateur.
        "certs_received": {premier: fin_certif} if est_verif else {verif["pseudo"]: fin_certif},
    }

donnees = {
    "initial_monetary_mass": DEPOT_MINIMUM,
    "current_block": {"number": 0, "medianTime": maintenant},
    "identities": identites,
    "wallets": {},
}

reglages = {
    "ud": PAIN_DE_DEPART,
    "first_ud": None,
    "first_ud_reeval": None,
    "clique_smiths": [{"name": forgeron["pseudo"], "session_keys": forgeron.get("cles_de_session")}],
    "sudo_key": admin,
    "treasury_funder_address": adresses[0],
    "technical_committee": comite,
    # Champs propres à la Gallia
    "verifiers": [verif["pseudo"]],
    "merit_account": tresor,
}

RESSOURCES.mkdir(parents=True, exist_ok=True)
(RESSOURCES / "gallia-data.json").write_text(json.dumps(donnees, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
entete = "# Bloc zéro de la Gallia : fichier généré par etape3/creer_bloc_zero.py, ne pas modifier à la main.\n"
(RESSOURCES / "gallia.yaml").write_text(entete + yaml.safe_dump(reglages, allow_unicode=True, sort_keys=False), encoding="utf-8")
print(f"Bloc zéro préparé : {len(pseudos)} identités (dont le Vérificateur), forgeron {forgeron['pseudo']}.")
print(f"Fichiers écrits dans {RESSOURCES}")
