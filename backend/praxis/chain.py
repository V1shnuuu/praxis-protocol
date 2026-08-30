"""
The live ledger: the same interface, backed by real transactions.

Reads its addresses from ``deployed-addresses.json`` and its ABIs from
``deployments/abis/`` — both written by ``contracts/scripts/deploy.js``, so
deploying is the only wiring step. Three keys sign: the agent owner attests, the
watcher stakes challenge fees, and the arbiter resolves. That separation is not
cosmetic; ``DisputeSlashing`` rejects a challenge from an address authorised to
act for the agent it is challenging.

``web3`` is imported lazily so the package installs and the simulated ledger runs
without it.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from .ledger import (
    Ledger,
    LedgerAgent,
    LedgerAttestation,
    LedgerDispute,
    LedgerError,
    LedgerInfo,
    Receipt,
)

__all__ = ["ChainLedger", "ChainUnavailable", "CONTRACT_NAMES"]

log = logging.getLogger("praxis.chain")

CONTRACT_NAMES = (
    "PraxisToken",
    "AgentRegistry",
    "ActionAttestation",
    "DisputeSlashing",
    "ReputationScore",
)

#: DisputeSlashing.Status
_DISPUTE_STATUS = {0: "open", 1: "upheld", 2: "rejected"}


class ChainUnavailable(RuntimeError):
    """Raised when a live ledger was asked for but cannot be built."""


class ChainLedger(Ledger):
    """Talks to a deployed Praxis stack over JSON-RPC.

    Contract handles are held privately (``_token``, ``_registry``, ...) so they
    cannot shadow the :class:`Ledger` methods of the same name.
    """

    def __init__(
        self,
        *,
        rpc_url: str,
        network: str,
        deployment: dict[str, Any],
        abi_dir: Path,
        agent_key: str,
        challenger_key: str,
        arbiter_key: str,
    ):
        try:
            from web3 import Web3
            from web3.middleware import ExtraDataToPOAMiddleware
        except ImportError as error:  # pragma: no cover - operator path, not a test path
            raise ChainUnavailable(
                "web3 is not installed. Install the chain extra: pip install -e '.[chain]'"
            ) from error

        self._w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        # Polygon puts more than 32 bytes in extraData; without this, block reads raise.
        self._w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        if not self._w3.is_connected():
            raise ChainUnavailable(f"cannot reach the RPC endpoint at {rpc_url}")

        self._network = network
        self._deployment = deployment
        self._addresses: dict[str, str] = deployment.get("contracts", {})
        missing = [name for name in CONTRACT_NAMES if name not in self._addresses]
        if missing:
            raise ChainUnavailable(f"deployment record is missing {', '.join(missing)}")

        abis = _load_abis(abi_dir)
        contracts = {
            name: self._w3.eth.contract(
                address=self._w3.to_checksum_address(self._addresses[name]), abi=abis[name]
            )
            for name in CONTRACT_NAMES
        }
        self._token = contracts["PraxisToken"]
        self._registry = contracts["AgentRegistry"]
        self._attestations = contracts["ActionAttestation"]
        self._disputes = contracts["DisputeSlashing"]
        self._reputation = contracts["ReputationScore"]

        try:
            accounts = self._w3.eth.account
            self._agent_signer = accounts.from_key(agent_key)
            self._challenger_signer = accounts.from_key(challenger_key)
            self._arbiter_signer = accounts.from_key(arbiter_key)
        except (ValueError, TypeError) as error:
            raise ChainUnavailable(f"invalid signing key: {error}") from error

        self._chain_id = self._w3.eth.chain_id
        self._min_bond = int(self._registry.functions.minBond().call())
        self._challenge_fee = int(self._disputes.functions.challengeFee().call())
        self._challenge_window = int(self._disputes.functions.challengeWindow().call())
        self._slash_bps = int(self._disputes.functions.slashBps().call())
        self._challenger_reward_bps = int(self._disputes.functions.challengerRewardBps().call())

        log.info(
            "chain ledger ready: network=%s chainId=%s registry=%s agent=%s",
            network,
            self._chain_id,
            self._addresses["AgentRegistry"],
            self._agent_signer.address,
        )

    # ------------------------------------------------------------------ info

    def info(self) -> LedgerInfo:
        try:
            block_number: int | None = int(self._w3.eth.block_number)
        except Exception as error:  # noqa: BLE001 - a status poll must never fail the request
            log.debug("block number unavailable: %s", error)
            block_number = None

        return LedgerInfo(
            mode="live",
            network=self._network,
            chain_id=self._chain_id,
            explorer_url=self._deployment.get("explorer"),
            contracts=dict(self._addresses),
            block_number=block_number,
            min_bond_wei=self._min_bond,
            challenge_fee_wei=self._challenge_fee,
            challenge_window_seconds=self._challenge_window,
            slash_bps=self._slash_bps,
            challenger_reward_bps=self._challenger_reward_bps,
        )

    def challenger_address(self) -> str:
        return self._challenger_signer.address

    def agent_owner_address(self) -> str:
        return self._agent_signer.address

    def next_attestation_id(self) -> int:
        """The id the next ``attest`` will assign.

        Read rather than reserved: another writer could take it between this
        call and the transaction, so the orchestrator re-hashes if the id it
        gets back differs.
        """
        return int(self._attestations.functions.attestationCount().call()) + 1

    def agent_ids_of_owner(self) -> list[int]:
        """Agents already registered to the signing key, so a restart adopts them."""
        try:
            ids = self._registry.functions.agentsOfOwner(self._agent_signer.address).call()
        except Exception as error:  # noqa: BLE001 - treated as "none found"
            raise LedgerError(f"could not list agents for {self._agent_signer.address}: {error}") from error
        return [int(value) for value in ids]

    # ----------------------------------------------------------------- writes

    def register(self, *, owner_hint: str, name: str, metadata_uri: str, bond_wei: int) -> Receipt:
        self._require_balance(self._agent_signer.address, bond_wei)
        self._approve(self._agent_signer, self._registry.address, bond_wei)

        receipt = self._send(
            self._registry.functions.register(name, metadata_uri, bond_wei), self._agent_signer
        )
        agent_id = self._event_arg(receipt, self._registry.events.AgentRegistered, "agentId")
        if agent_id is None:
            agent_id = int(self._registry.functions.agentCount().call())
        return Receipt(tx_hash=_hex(receipt), id=agent_id, timestamp=self._block_time(receipt))

    def attest(self, *, agent_id: int, trail_hash: str, action_type: str, summary: str) -> Receipt:
        receipt = self._send(
            self._attestations.functions.attest(
                agent_id, _to_bytes32(trail_hash), action_type, summary
            ),
            self._agent_signer,
        )
        attestation_id = self._event_arg(
            receipt, self._attestations.events.AttestationSubmitted, "attestationId"
        )
        if attestation_id is None:
            attestation_id = int(self._attestations.functions.attestationCount().call())
        return Receipt(tx_hash=_hex(receipt), id=attestation_id, timestamp=self._block_time(receipt))

    def open_dispute(self, *, attestation_id: int, reason: str) -> Receipt:
        if self._challenge_fee:
            self._require_balance(self._challenger_signer.address, self._challenge_fee)
            self._approve(self._challenger_signer, self._disputes.address, self._challenge_fee)

        receipt = self._send(
            self._disputes.functions.openDispute(attestation_id, reason), self._challenger_signer
        )
        dispute_id = self._event_arg(receipt, self._disputes.events.DisputeOpened, "disputeId")
        if dispute_id is None:
            dispute_id = int(self._disputes.functions.disputeCount().call())
        return Receipt(tx_hash=_hex(receipt), id=dispute_id, timestamp=self._block_time(receipt))

    def resolve(self, *, dispute_id: int, upheld: bool) -> Receipt:
        receipt = self._send(
            self._disputes.functions.resolve(dispute_id, upheld), self._arbiter_signer
        )
        return Receipt(tx_hash=_hex(receipt), id=dispute_id, timestamp=self._block_time(receipt))

    # ------------------------------------------------------------------ reads

    def agent(self, agent_id: int) -> LedgerAgent:
        # AgentView: id, owner, name, metadataURI, bond, lockedBond, registeredAt,
        #            totalSlashed, slashCount, active
        view = self._registry.functions.getAgent(agent_id).call()
        return LedgerAgent(
            agent_id=int(view[0]),
            owner=str(view[1]),
            name=str(view[2]),
            metadata_uri=str(view[3]),
            bond_wei=int(view[4]),
            locked_bond_wei=int(view[5]),
            registered_at=int(view[6]),
            total_slashed_wei=int(view[7]),
            slash_count=int(view[8]),
            active=bool(view[9]),
            total_attestations=int(self._attestations.functions.totalByAgent(agent_id).call()),
            clean_attestations=int(self._attestations.functions.cleanByAgent(agent_id).call()),
            open_disputes=int(self._disputes.functions.openDisputesByAgent(agent_id).call()),
            rejected_disputes=int(self._disputes.functions.rejectedDisputesByAgent(agent_id).call()),
        )

    def attestation(self, attestation_id: int) -> LedgerAttestation:
        # AttestationView: id, agentId, trailHash, actionType, summary, timestamp,
        #                  submitter, disputed, slashed
        view = self._attestations.functions.getAttestation(attestation_id).call()
        return LedgerAttestation(
            attestation_id=int(view[0]),
            agent_id=int(view[1]),
            trail_hash="0x" + bytes(view[2]).hex(),
            action_type=str(view[3]),
            summary=str(view[4]),
            timestamp=int(view[5]),
            disputed=bool(view[7]),
            slashed=bool(view[8]),
        )

    def dispute(self, dispute_id: int) -> LedgerDispute:
        # Dispute: id, attestationId, agentId, challenger, fee, reason, openedAt,
        #          resolvedAt, lockedAmount, slashedAmount, challengerPayout,
        #          bondBefore, bondAfter, status
        view = self._disputes.functions.getDispute(dispute_id).call()
        resolved_at = int(view[7]) or None
        return LedgerDispute(
            dispute_id=int(view[0]),
            attestation_id=int(view[1]),
            agent_id=int(view[2]),
            challenger=str(view[3]),
            fee_wei=int(view[4]),
            reason=str(view[5]),
            opened_at=int(view[6]),
            resolved_at=resolved_at,
            status=_DISPUTE_STATUS.get(int(view[13]), "open"),  # type: ignore[arg-type]
            bond_before_wei=int(view[11]),
            bond_after_wei=int(view[12]) if resolved_at else None,
            slashed_wei=int(view[9]) if resolved_at else None,
            challenger_payout_wei=int(view[10]) if resolved_at else None,
        )

    def reputation(self, agent_id: int) -> int:
        return int(self._reputation.functions.scoreOf(agent_id).call())

    # ---------------------------------------------------------------- helpers

    def _require_balance(self, address: str, needed: int) -> None:
        balance = int(self._token.functions.balanceOf(address).call())
        if balance < needed:
            raise LedgerError(
                f"{address} holds {balance} PRAX-wei but needs {needed}. "
                "Top it up with `cd contracts && npm run fund:amoy`."
            )

    def _approve(self, signer, spender: str, amount: int) -> None:
        if int(self._token.functions.allowance(signer.address, spender).call()) >= amount:
            return
        self._send(self._token.functions.approve(spender, amount), signer)

    def _send(self, call, signer):
        """Builds, signs and waits for one transaction."""
        try:
            tx = call.build_transaction(
                {
                    "from": signer.address,
                    "nonce": self._w3.eth.get_transaction_count(signer.address, "pending"),
                    "chainId": self._chain_id,
                }
            )
            signed = signer.sign_transaction(tx)
            tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        except Exception as error:  # noqa: BLE001 - surface any RPC failure as a ledger error
            raise LedgerError(f"transaction failed: {error}") from error

        if receipt.get("status") != 1:
            raise LedgerError(f"transaction reverted: {_hex(receipt)}")
        return receipt

    @staticmethod
    def _event_arg(receipt, event, name: str) -> int | None:
        """Pulls an id straight out of the emitted event, when it is there."""
        try:
            entries = event().process_receipt(receipt, errors=0)
        except Exception:  # noqa: BLE001 - a decode failure just means "use the counter"
            return None
        for entry in entries:
            value = entry.get("args", {}).get(name)
            if value is not None:
                return int(value)
        return None

    def _block_time(self, receipt) -> int:
        try:
            return int(self._w3.eth.get_block(receipt["blockNumber"])["timestamp"])
        except Exception:  # noqa: BLE001 - fall back to wall clock
            return int(time.time())


def _hex(receipt) -> str:
    value = receipt["transactionHash"]
    return value.hex() if hasattr(value, "hex") else str(value)


def _load_abis(abi_dir: Path) -> dict[str, list]:
    abis: dict[str, list] = {}
    for name in CONTRACT_NAMES:
        path = abi_dir / f"{name}.json"
        if not path.exists():
            raise ChainUnavailable(
                f"ABI for {name} not found at {path}. Run `cd contracts && npm run deploy:amoy`."
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        abis[name] = payload["abi"] if isinstance(payload, dict) else payload
    return abis


def _to_bytes32(trail_hash: str) -> bytes:
    raw = trail_hash[2:] if trail_hash.startswith("0x") else trail_hash
    data = bytes.fromhex(raw)
    if len(data) != 32:
        raise LedgerError(f"trail hash must be 32 bytes, got {len(data)}")
    return data
