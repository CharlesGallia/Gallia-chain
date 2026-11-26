"""Étape 3 : état de la vraie chaîne Gallia, en clair (lecture seule, aucune clé nécessaire).

Usage : python verifier_gallia.py [adresse g1…] [ws://127.0.0.1:9944] [--attendre-pain]
"""
import datetime as dt
import sys
import time

from substrateinterface import SubstrateInterface

URL = next((a for a in sys.argv[1:] if a.startswith("ws")), "ws://127.0.0.1:9944")
s = SubstrateInterface(url=URL)
s.ss58_format = s.get_constant("System", "SS58Prefix").value
DEC = s.properties.get("tokenDecimals", 2)
SYM = s.properties.get("tokenSymbol", "?")
fmt = lambda v: f"{v / 10**DEC:,.2f} {SYM}".replace(",", " ")
q = lambda m, f, p=None: s.query(m, f, p or []).value
heure = lambda ms: dt.datetime.fromtimestamp(ms / 1000).strftime("%d/%m/%Y à %H:%M")


def pain_a_reclamer(addr):
    """Pains quotidiens accumulés par un membre, pas encore réclamés (même calcul que la chaîne)."""
    idx = q("Identity", "IdentityIndexOf", [addr])
    idty = q("Identity", "Identities", [idx]) if idx is not None else None
    premier = idty and idty["data"]["first_eligible_ud"]
    if not premier:
        return 0
    courant, total = q("UniversalDividend", "CurrentUdIndex"), 0
    for index_reeval, montant in reversed(q("UniversalDividend", "PastReevals")):
        debut = max(index_reeval, premier)
        total += max(courant - debut, 0) * montant
        courant = debut
        if index_reeval <= premier:
            break
    return total


def etat(addr):
    idx = q("Identity", "IdentityIndexOf", [addr])
    idty = q("Identity", "Identities", [idx]) if idx is not None else None
    return idx, idty


print(f"Chaîne : {s.chain} | monnaie {SYM}, {DEC} décimales | bloc n° {s.get_block_number(None)}")
print(f"Gallis membres : {q('Membership', 'CounterForMembership')}")
print(f"Pain quotidien actuel : {fmt(q('UniversalDividend', 'CurrentUd'))} | "
      f"prochain pain le {heure(q('UniversalDividend', 'NextUd'))} | pains versés : {q('UniversalDividend', 'CurrentUdIndex') - 1}")
print(f"Masse monétaire : {fmt(q('UniversalDividend', 'MonetaryMass'))}")

addr = next((a for a in sys.argv[1:] if a.startswith("g1")), None)
if addr:
    idx, idty = etat(addr)
    print(f"\nCompte {addr}")
    print(f"  identité n° {idx}, statut {idty['status'] if idty else 'aucune'}")
    print(f"  solde : {fmt(q('System', 'Account', [addr])['data']['free'])} | pain à réclamer : {fmt(pain_a_reclamer(addr))}")
    if "--attendre-pain" in sys.argv:
        debut = q("UniversalDividend", "CurrentUdIndex")
        print(f"  attente du prochain pain quotidien ({heure(q('UniversalDividend', 'NextUd'))})…")
        while q("UniversalDividend", "CurrentUdIndex") == debut:
            time.sleep(12)
        p = pain_a_reclamer(addr)
        print(f"  le pain est arrivé : {fmt(p)} à réclamer sur ce compte")
        sys.exit(0 if p > 0 else 1)
