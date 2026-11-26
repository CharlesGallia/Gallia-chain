"""Étape 3 : teste la chaîne Gallia locale (comptes de test publics, aucune valeur réelle).

Vérifie : symbole et pain quotidien de départ, entrée d'un Galli par le Vérificateur Titulus,
refus pour un compte qui n'est pas Vérificateur, seuls les comptes vérifiés reçoivent des Gallo,
part du Trésor du mérite, réclamation du pain.
Usage : python tester_gallia.py [ws://127.0.0.1:9945] [--attendre-pain]
"""
import hashlib
import sys
import time

import bip39
from substrateinterface import Keypair, KeypairType, SubstrateInterface

URL = next((a for a in sys.argv[1:] if a.startswith("ws")), "ws://127.0.0.1:9945")
s = SubstrateInterface(url=URL)
s.ss58_format = s.get_constant("System", "SS58Prefix").value
DEC = s.properties.get("tokenDecimals", 2)
SYM = s.properties.get("tokenSymbol", "?")
fmt = lambda v: f"{v / 10**DEC:,.2f} {SYM}".replace(",", " ")

# Phrase de test standard de Substrate : publique, connue de tous, réservée aux réseaux de test.
DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk"


def dev_key(name):
    """Clé de test //name en ed25519 (comme `duniter key inspect --scheme ed25519 //name`)."""
    mini = bytes(bip39.bip39_to_mini_secret(DEV_PHRASE, ""))
    cc = (bytes([len(name) << 2]) + name.encode()).ljust(32, b"\0")
    seed = hashlib.blake2b(bytes([11 << 2]) + b"Ed25519HDKD" + mini + cc, digest_size=32).digest()
    return Keypair.create_from_seed(seed.hex(), ss58_format=s.ss58_format, crypto_type=KeypairType.ED25519)


def send(kp, module, fn, params):
    call = s.compose_call(module, fn, params)
    try:
        r = s.submit_extrinsic(s.create_signed_extrinsic(call, keypair=kp), wait_for_inclusion=True)
    except Exception as e:  # transaction refusée avant même d'entrer dans un bloc
        return False, f"refusée : {e}"
    return r.is_success, (None if r.is_success else r.error_message)


def free(addr):
    return s.query("System", "Account", [addr]).value["data"]["free"]


def idty_of(addr):
    return s.query("Identity", "IdentityIndexOf", [addr]).value


def status(idx):
    v = s.query("Identity", "Identities", [idx]).value
    return v["status"] if v else None


ok_all = True


def check(label, cond):
    global ok_all
    ok_all &= bool(cond)
    print(("  OK   " if cond else "  ÉCHEC ") + label)


print(f"Chaîne : {s.chain} | monnaie {SYM}, {DEC} décimales | bloc n° {s.get_block_number(None)}")
check(f"symbole GALLO ({SYM})", SYM == "GALLO")
ud = s.query("UniversalDividend", "CurrentUd").value
check(f"pain quotidien de départ 1 Gallo ({fmt(ud)})", ud == 100)
alice, bob, tresor = dev_key("Alice"), dev_key("Bob"), dev_key("Tresor")
verif = s.query("Wot", "Verifiers", [idty_of(alice.ss58_address)]).value
check("Alice est Vérificateur Titulus", verif is not None)
check("Bob n'est pas Vérificateur", s.query("Wot", "Verifiers", [idty_of(bob.ss58_address)]).value is None)
check("compte du Trésor du mérite défini", s.query("UniversalDividend", "MeritAccount").value == tresor.ss58_address)

print("\nEntrée d'un nouveau Galli :")
galli = Keypair.create_from_mnemonic(Keypair.generate_mnemonic(), ss58_format=s.ss58_format)
intrus = Keypair.create_from_mnemonic(Keypair.generate_mnemonic(), ss58_format=s.ss58_format)
okt, err = send(bob, "Balances", "transfer_keep_alive", {"dest": galli.ss58_address, "value": 500})
check(f"avant vérification, le compte ne peut pas recevoir de Gallo ({err})", not okt)
okb, err = send(bob, "Identity", "create_identity", {"owner_key": intrus.ss58_address})
check(f"Bob (pas Vérificateur) ne peut pas créer d'identité ({err})", not okb)
ok1, err = send(alice, "Identity", "create_identity", {"owner_key": galli.ss58_address})
check(f"le Vérificateur crée l'identité du Galli {err or ''}", ok1)
idx = idty_of(galli.ss58_address)
okt, err = send(bob, "Balances", "transfer_keep_alive", {"dest": galli.ss58_address, "value": 500})
check(f"une fois vérifié, le Galli peut recevoir des Gallo {err or ''}", okt)
okt, err = send(galli, "Balances", "transfer_keep_alive", {"dest": intrus.ss58_address, "value": 100})
check(f"le Galli ne peut pas envoyer à un compte non vérifié ({err})", not okt)
okt, err = send(bob, "UniversalDividend", "transfer_ud", {"dest": intrus.ss58_address, "value": 1000})
check(f"pas de contournement par un virement en pains quotidiens ({err})", not okt)
okt, err = send(bob, "OneshotAccount", "create_oneshot_account", {"dest": intrus.ss58_address, "value": 500})
check(f"pas de contournement par un compte à usage unique ({err})", not okt)
check("le compte non vérifié n'a reçu aucun Gallo", free(intrus.ss58_address) == 0)
ok2, err = send(galli, "Identity", "confirm_identity", {"idty_name": f"Galli-test-{idx}"})
check(f"le Galli confirme son identité {err or ''}", ok2)
okc, err = send(bob, "Certification", "add_cert", {"receiver": idx})
check(f"Bob ne peut pas certifier ({err})", not okc)
ok3, err = send(alice, "Wot", "claim_membership", {"idty_index": idx})
check(f"le Vérificateur valide l'adhésion, sans règle de distance {err or ''}", ok3)
check(f"le Galli n°{idx} est membre ({status(idx)})", status(idx) == "Member")

if "--attendre-pain" in sys.argv:
    print("\nPain quotidien :")
    t0 = s.query("UniversalDividend", "CurrentUdIndex").value
    avant_tresor = free(tresor.ss58_address)
    membres = s.query("Membership", "CounterForMembership").value
    print(f"  {membres} membres, attente du prochain pain quotidien…")
    while s.query("UniversalDividend", "CurrentUdIndex").value == t0:
        time.sleep(6)
    attendu = 100 * membres * 3 // 7
    gain = free(tresor.ss58_address) - avant_tresor
    check(f"le Trésor du mérite a reçu {fmt(gain)} (attendu {fmt(attendu)})", abs(gain - attendu) <= 1)
    avant = free(galli.ss58_address)
    ok4, err = send(galli, "UniversalDividend", "claim_uds", {})
    apres = free(galli.ss58_address)
    check(f"le nouveau Galli reçoit son pain : {fmt(avant)} -> {fmt(apres)} {err or ''}", ok4 and apres - avant == 100)
    print(f"  Masse monétaire : {fmt(s.query('UniversalDividend', 'MonetaryMass').value)}")

print("\nRÉSULTAT :", "tout fonctionne" if ok_all else "il y a des échecs")
sys.exit(0 if ok_all else 1)
