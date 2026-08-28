# Praxis Protocol

**An on-chain accountability layer for autonomous AI agents.**

Agents register with a staked bond, commit hashed attestations of every decision
they make, can be challenged and slashed for provably policy-violating
behaviour, and carry a portable on-chain reputation score that any protocol can
read.

---

## The problem

Autonomous agents are starting to move real value — rebalancing portfolios,
voting in DAOs, approving loans — and the only thing standing behind their
behaviour is a prompt and a promise. When an agent does something it shouldn't,
there is no record of *why* it decided that, no way to prove the record wasn't
edited afterwards, and no cost to the operator.

Praxis makes the promise expensive to break:

1. **Declare.** An agent registers on-chain with a plain-language policy — *"never
   allocate more than 20% of the book to a single asset"* — and posts a bond.
2. **Commit.** Every decision produces a full reasoning trail (inputs → reasoning
   → output). The agent commits `keccak256(trail)` on-chain and keeps the trail
   off-chain. The commitment is tamper-evident: the trail cannot be rewritten
   after the fact without the hash breaking.
3. **Challenge.** Anyone can stake a fee and dispute an attestation inside the
   challenge window, revealing the trail as evidence.
4. **Slash.** An upheld challenge burns part of the bond and pays the challenger.
   A rejected challenge forfeits the challenger's fee to the agent, so
   frivolous accusations cost money too.
5. **Carry.** Reputation is derived live from registry + attestation + dispute
   history by a stateless contract, so it is portable across protocols and needs
   no trusted indexer.

The result: an agent's track record is something it stakes on, not something its
operator asserts.

---

## Architecture

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  Orchestrator (FastAPI)                                              │
   │  TradingAgent · DAOVotingAgent · LendingAgent                        │
   │  decide() → Ollama/Gemma, rule-based fallback → act()                │
   │  rogue-mode toggle · policy watcher                                  │
   └───────────────┬──────────────────────────────────┬───────────────────┘
                   │ keccak256(canonical trail)       │ full trail
                   ▼                                  ▼
   ┌──────────────────────────────────┐   ┌──────────────────────────────┐
   │  Polygon Amoy                    │   │  SQLite trail store          │
   │  ┌────────────────────────────┐  │   │  keyed by trail hash,        │
   │  │ AgentRegistry   identity   │  │   │  revealed on dispute         │
   │  │ ActionAttestation  log     │  │   └──────────────────────────────┘
   │  │ DisputeSlashing  challenge │  │
   │  │ ReputationScore  0–1000    │  │
   │  └────────────────────────────┘  │
   └───────────────┬──────────────────┘
                   │  REST (agents, attestations, disputes)  +  read-only RPC
                   ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  Dashboard (Next.js)                                                 │
   │  agent cards · live action feed · dispute before/after · rogue button│
   │  re-derives every trail hash client-side                             │
   └──────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
praxis-protocol/
├── contracts/               Solidity + Hardhat            — complete
├── frontend/                Next.js dashboard             — complete
├── backend/                 FastAPI orchestrator          — not in this repo (see below)
├── docs/DEMO-STORYBOARD.md  60–90s demo script
├── deployed-addresses.json  written by the deploy script, read by backend + frontend
└── deployments/abis/        generated ABIs, read by backend + frontend
```

---

## Status

| Layer | State |
| --- | --- |
| Contracts | Complete. 66 tests, 97.5% statement / 99.0% line coverage. |
| Dashboard | Complete. Runs standalone in demo mode; one env var switches it to the live backend. |
| Backend | **Not present in this repository.** See *Wiring the backend* below. |
| Amoy deployment | **Not yet deployed.** See *Deploying* below. |

The dashboard ships with a self-contained **demo mode**: with no backend
configured it simulates three agents, their attestations, and the full
rogue → dispute → slash loop in the browser, using the same arithmetic as the
contracts. Trail hashes are real keccak256 digests and are verified
client-side, so the tamper-evidence story is genuine even without a chain.

---

## Quick start

### 1. Contracts

```bash
cd contracts
npm install
cp .env.example .env      # fill in DEPLOYER_PRIVATE_KEY
npm test                  # 66 tests
npm run demo:local        # register → attest → go rogue → dispute → slash
```

Full contract reference, economics and the reputation formula:
[`contracts/README.md`](contracts/README.md).

### 2. Dashboard

```bash
cd frontend
npm install
npm run dev               # http://localhost:3000
```

That's it — no backend or chain required. The dashboard opens in demo mode with
three agents already operating.

To point it at a live orchestrator:

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
```

---

## How to run the demo

Roughly 60 seconds, entirely from the UI.

1. **Open the dashboard.** Three agents — Trading, DAO voting, Lending — each
   showing its declared policy, bond, reputation and trend. The live feed is
   already streaming compliant decisions.
2. **Click any feed row.** The full reasoning trail opens, and the dashboard
   recomputes `keccak256` over the canonical JSON in your browser and shows it
   matching the committed hash. This is the tamper-evidence claim, demonstrated
   rather than asserted.
3. **Press "Trigger rogue agent."** TradingAgent commits a decision that breaks
   its own 20% concentration cap — 85% of the book into one asset. It appears in
   the feed flagged as a policy violation.
4. **Watch the watcher.** Within a few seconds a dispute opens: the agent's card
   turns amber, 2,000 PRAX of its bond is locked, the challenge-window countdown
   starts, and reputation drops by the open-dispute penalty.
5. **Watch the slash.** The arbiter upholds the challenge. The dispute panel
   shows the before/after side by side — bond 10,000 → 8,000 PRAX, reputation
   628 → 443 — the challenger is paid 1,100 PRAX, and the attestation is
   permanently marked slashed in the feed.

"Reset demo" puts every agent back to its opening bond so you can run it again.

The same flow against real contracts is `cd contracts && npm run demo:amoy`,
which prints a PolygonScan link for every transaction.

Shot-by-shot script for recording: [`docs/DEMO-STORYBOARD.md`](docs/DEMO-STORYBOARD.md).

---

## Deploying to Polygon Amoy

```bash
cd contracts
npm run wallets:new       # generates the agent + challenger keys
# paste them into .env, fund the deployer at https://faucet.polygon.technology
npm run deploy:amoy       # writes ../deployed-addresses.json + ../deployments/abis/
npm run fund:amoy
npm run demo:amoy         # full flow on-chain, with explorer links
POLYGONSCAN_API_KEY=... npm run verify:amoy
```

`deployed-addresses.json` is the integration point: the backend reads contract
addresses from it, and the dashboard surfaces them (with explorer links) in the
On-chain deployment panel.

---

## Wiring the backend

The dashboard talks to the outside world through exactly one file —
[`frontend/src/lib/api.ts`](frontend/src/lib/api.ts). It defines the `PraxisApi`
interface, a `demo` implementation, and an `http` implementation. Every
component is written against the interface, so connecting a real orchestrator is
a change in that file and nowhere else.

The `http` implementation expects these routes:

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/status` | `SystemStatus` |
| `GET` | `/api/agents` | `Agent[]` |
| `GET` | `/api/attestations?limit=40` | `Attestation[]` (newest first) |
| `GET` | `/api/attestations/{id}/trail` | `DecisionTrail` |
| `GET` | `/api/disputes` | `Dispute[]` (newest first) |
| `POST` | `/api/agents/{id}/rogue` | `{ attestationId: number }` |
| `POST` | `/api/disputes/{id}/resolve` | body `{ upheld: boolean }` |

Field shapes are in [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts).
Two conventions matter:

- **Token amounts are decimal strings in whole PRAX**, not wei (`"8000"`, not
  `"8000000000000000000000"`). Timestamps are Unix **seconds**.
- **Trail hashes use a canonical serialisation** so the Python producer and the
  TypeScript verifier agree byte for byte. Keys sorted lexicographically and
  recursively, no insignificant whitespace:

  ```python
  body = {"attestationId": ..., "agentId": ..., "policy": ...,
          "inputs": {...}, "reasoning": ..., "output": {...}, "nonce": ...}
  canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
  trail_hash = Web3.keccak(text=canonical).hex()
  ```

  The rule is documented in
  [`frontend/src/lib/canonical.ts`](frontend/src/lib/canonical.ts). If the
  backend hashes a different byte sequence, the dashboard's verification banner
  will correctly report a mismatch.

If your routes differ, remap them in the `paths` object at the top of `api.ts`.

---

## Design notes

- **Bonds are an ERC-20 (`PRAX`), not native POL.** Slashing and split payouts
  are safer with `SafeERC20` than with native transfers, and the token's faucet
  lets judges self-serve.
- **The arbiter is a single admin address**, explicitly a stand-in for a
  decentralised arbitration layer. Swapping it out is a `setArbiter` call.
- **Reputation is a pure view contract.** Any protocol can read a live score
  without trusting an indexer. It costs marginally more gas to read; that is the
  price of the portability claim.
- **A rejected dispute pays the agent.** The forfeited challenge fee is credited
  to the agent's bond, so an honest agent that survives a false accusation ends
  up better off than before it.
- **The dashboard verifies, it doesn't trust.** Every revealed trail is
  re-hashed in the browser and compared against the on-chain commitment.

## Licence

MIT — see [LICENSE](LICENSE).
