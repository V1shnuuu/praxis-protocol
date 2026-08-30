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
   │  │ ReputationScore  0–1000    │  │   …or, with nothing deployed yet,
   │  └────────────────────────────┘  │   an in-process ledger mirroring
   └───────────────┬──────────────────┘   the same arithmetic
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
├── backend/                 FastAPI orchestrator          — complete
├── frontend/                Next.js dashboard             — complete
├── docs/DEMO-STORYBOARD.md  60–90s demo script
├── deployed-addresses.json  written by the deploy script, read by backend + frontend
└── deployments/abis/        generated ABIs, read by backend + frontend
```

---

## Status

| Layer | State |
| --- | --- |
| Contracts | Complete. 66 tests, 97.5% statement / 99.0% line coverage. |
| Orchestrator | Complete. 200 tests. Runs with or without a chain; one env var switches it. |
| Dashboard | Complete. Runs standalone in demo mode; one env var switches it to the live backend. |
| Amoy deployment | **Not yet deployed** — it needs a funded key. See *Deploying* below. |

Both halves run without a chain, and neither one fakes it while doing so.

The dashboard ships with a self-contained **demo mode**: with no backend
configured it simulates three agents, their attestations, and the full
rogue → dispute → slash loop in the browser, using the same arithmetic as the
contracts. Trail hashes are real keccak256 digests and are verified
client-side, so the tamper-evidence story is genuine even without a chain.

The orchestrator does the same one layer down. With no deployment recorded it
runs against an in-process ledger that mirrors the contracts line by line, so
the agents really decide, the trails are really hashed and stored, the watcher
really catches breaches, and the bond arithmetic is the arithmetic Amoy would
produce. Deploying swaps the ledger and nothing else — the agents, the watcher
and the API are unchanged, and `/api/status` starts reporting `live` with
transaction hashes attached.

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

### 2. Orchestrator

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                    # 200 tests
uvicorn praxis.main:app   # http://127.0.0.1:8000
```

No `.env`, no chain and no Ollama required — it starts against the in-process
ledger and the agents begin deciding immediately. API docs at `/docs`.

Full reference, including the two-ledger design and how to attach a deployment:
[`backend/README.md`](backend/README.md).

### 3. Dashboard

```bash
cd frontend
npm install
npm run dev               # http://localhost:3000
```

That's it — no backend or chain required. The dashboard opens in demo mode with
three agents already operating.

To point it at the orchestrator instead:

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

The numbers above are the dashboard's own demo mode, whose agents are seeded
with a few days of history. The orchestrator runs the identical loop from a
standing start, so its scores differ by the longevity bonus its agents have not
earned yet — the bond arithmetic (10,000 → 8,000, 1,100 to the challenger) is
the same either way, because both derive it from the contracts.

The same flow with the orchestrator driving it is `NEXT_PUBLIC_API_URL=... npm
run dev` against `uvicorn praxis.main:app`; against real contracts on Amoy it is
`cd contracts && npm run demo:amoy`, which prints a PolygonScan link for every
transaction.

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

## How the two halves meet

The dashboard talks to the outside world through exactly one file —
[`frontend/src/lib/api.ts`](frontend/src/lib/api.ts). It defines the `PraxisApi`
interface, a `demo` implementation, and an `http` implementation. Every
component is written against the interface, so demo mode and live mode differ in
that file and nowhere else.

The orchestrator serves exactly the routes the `http` implementation expects:

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/status` | `SystemStatus` |
| `GET` | `/api/agents` | `Agent[]` (newest reputation history last) |
| `GET` | `/api/attestations?limit=40` | `Attestation[]` (newest first) |
| `GET` | `/api/attestations/{id}/trail` | `DecisionTrail`, 404 if unknown |
| `GET` | `/api/disputes` | `Dispute[]` (newest first) |
| `POST` | `/api/agents/{id}/rogue` | `{ attestationId: number }` |
| `POST` | `/api/disputes/{id}/resolve` | `Dispute`, body `{ upheld: boolean }` |
| `POST` | `/api/reset` | `204`; simulated mode only |

Field shapes are in [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts) and
mirrored as pydantic models in
[`backend/praxis/models.py`](backend/praxis/models.py). Two conventions matter:

- **Token amounts are decimal strings in whole PRAX**, not wei (`"8000"`, not
  `"8000000000000000000000"`). Timestamps are Unix **seconds**.
- **Trail hashes use a canonical serialisation** so the Python producer and the
  TypeScript verifier agree byte for byte. Keys sorted lexicographically and
  recursively, no insignificant whitespace:

  ```python
  body = {"attestationId": ..., "agentId": ..., "policy": ...,
          "inputs": {...}, "reasoning": ..., "output": {...}, "nonce": ...}
  canonical = json.dumps(body, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False)
  trail_hash = keccak(text=canonical).hex()
  ```

  The rule lives in [`frontend/src/lib/canonical.ts`](frontend/src/lib/canonical.ts)
  and [`backend/praxis/canonical.py`](backend/praxis/canonical.py), and the two
  are held together by generated test vectors rather than by good intentions:
  `backend/tests/vectors/generate_vectors.mjs` imports the dashboard's own
  implementation and `backend/tests/test_canonical.py` replays every vector
  through the Python one. Getting this wrong is not a subtle bug — the
  dashboard's verification banner goes red on an honest trail — and the two
  places it is easy to get wrong are non-ASCII escaping (`ensure_ascii=False`)
  and integral floats (`JSON.stringify(4000.0)` is `"4000"`).

Swapping in a different orchestrator is a matter of serving those eight routes;
if yours uses different paths, remap them in the `paths` object at the top of
`api.ts`.

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
- **The watcher isn't told which agent went rogue.** It re-derives the violation
  from the committed decision alone, exactly as an outside observer would. A
  flag the orchestrator sets on itself would prove nothing.
- **A model that argues its way into a breach is committed, not corrected.**
  The orchestrator does not sanity-check the LLM's output against the policy
  before publishing it. Quietly fixing it would hide the one failure this
  protocol exists to make visible.
- **The orchestrator runs against one ledger interface, not two code paths.**
  Chain and simulation are implementations of the same protocol, so the demo
  without a deployment exercises the code that will run with one.

## Licence

MIT — see [LICENSE](LICENSE).
