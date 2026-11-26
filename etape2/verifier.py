"""Étape 2 : lit l'état du nœud de test Duniter v2 (blocs, membres, dividende universel)."""
import sys
from substrateinterface import SubstrateInterface

s = SubstrateInterface(url=next((a for a in sys.argv[1:] if a.startswith("ws")), "ws://127.0.0.1:9944"))
s.ss58_format = s.get_constant("System", "SS58Prefix").value
props = s.properties
dec = props.get("tokenDecimals", 2)
sym = props.get("tokenSymbol", "?")
fmt = lambda v: f"{v / 10**dec:,.2f} {sym}"

print("Chaîne :", s.chain, "| bloc n°", s.get_block_number(None))
for name in ["UdCreationPeriod", "UdReevalPeriod", "SquareMoneyGrowthRate"]:
    try:
        print(f"{name} :", s.get_constant("UniversalDividend", name).value)
    except Exception as e:
        print(name, ": ?", e)
print("Dividende actuel :", fmt(s.query("UniversalDividend", "CurrentUd").value))
print("Dividendes créés :", s.query("UniversalDividend", "CurrentUdIndex").value - 1)
print("Masse monétaire :", fmt(s.query("UniversalDividend", "MonetaryMass").value))
import datetime
nxt = s.query("UniversalDividend", "NextUd").value
print("Prochain dividende :", datetime.datetime.fromtimestamp(nxt / 1000, datetime.timezone.utc).strftime("%H:%M:%S UTC"))
print("Membres :", s.query("Membership", "CounterForMembership").value)

from substrateinterface import Keypair, KeypairType
# //Alice est la clé de test publique et connue de tous du réseau de développement (aucune valeur réelle).
import hashlib, bip39
DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk"  # phrase de test standard Substrate
def dev_key_ed25519(name):
    """Dérivation dure //name en ed25519, comme `duniter key inspect --scheme ed25519 //name`."""
    mini = bytes(bip39.bip39_to_mini_secret(DEV_PHRASE, ""))
    cc = (bytes([len(name) << 2]) + name.encode()).ljust(32, b"\0")
    seed = hashlib.blake2b(bytes([11 << 2]) + b"Ed25519HDKD" + mini + cc, digest_size=32).digest()
    return Keypair.create_from_seed(seed.hex(), ss58_format=s.ss58_format, crypto_type=KeypairType.ED25519)
alice_kp = dev_key_ed25519("Alice")
alice = alice_kp.ss58_address
idx = s.query("Identity", "IdentityIndexOf", [alice]).value
ident = s.query("Identity", "Identities", [idx]).value
acc = s.query("System", "Account", [alice]).value
print(f"Alice : identité n°{idx}, statut {ident['status']}, premier dividende réclamable n°{ident['data']['first_eligible_ud']}")
print("Alice solde libre :", fmt(acc["data"]["free"]))

if "--reclamer" in sys.argv:
    call = s.compose_call("UniversalDividend", "claim_uds", {})
    r = s.submit_extrinsic(s.create_signed_extrinsic(call, keypair=alice_kp), wait_for_inclusion=True)
    print("Réclamation du dividende par Alice :", "réussie" if r.is_success else r.error_message)
    print("Alice solde libre après :", fmt(s.query("System", "Account", [alice]).value["data"]["free"]))
