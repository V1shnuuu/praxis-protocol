# Praxis Protocol — orchestrator

The FastAPI service that runs the agents, commits a hashed reasoning trail for
every decision they make, watches those decisions against the policies the
agents declared on-chain, and serves the dashboard.

Python 3.11 · FastAPI · web3.py · SQLite · optional Ollama

## Quick start

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"           # add ".[chain,dev]" to talk to a deployed stack
uvicorn praxis.main:app --reload  # http://127.0.0.1:8000
```

No `.env`, no chain, no Ollama required — it starts against the in-process
ledger and the agents begin deciding immediately. Point the dashboard at it:

```bash
cd ../frontend
echo 'NEXT_PUBLIC_API_URL=http://127.0.0.1:8000' > .env.local
npm run dev
```

Interactive API docs are at `http://127.0.0.1:8000/docs`.

## What one decision does

```
  agents.py      observe the world, decide          ── LLM, or the rule if none
       │
       ▼
  canonical.py   serialise the trail, keccak256 it  ── the one rule all three
       │                                               parties hash by
       ├──────────────► ledger.py / chain.py        ── commit the digest
       │                                               (simulation | Polygon Amoy)
       └──────────────► store.py                    ── file the trail in SQLite
                              │
                              ▼
                        policy.py                   ── the watcher reads the
                              │                        decision back and judges it
                              ▼
                     open a dispute, stake a fee    ── if it breaches the policy
                              │
                              ▼
                     the arbiter resolves           ── bond slashed, reputation drops
```

`orchestrator.py` drives that loop; `api.py` serves the result.

## Two ledgers, one interface

Everything above `ledger.Ledger` is written against the interface, so the same
orchestrator runs whether or not a deployment exists:

| | `SimulatedLedger` | `ChainLedger` |
| --- | --- | --- |
| Where | in this process | Polygon Amoy |
| Needs | nothing | a deployment, an RPC endpoint, three funded keys |
| Transactions | none (`txHash` is `null`) | real, with explorer links |
| Arithmetic | ported from the Solidity | the Solidity |
| `/api/status` `mode` | `"live"` | `"live"` |
| `/api/status` `contracts` | `null` | the five addresses |
| `/api/status` `network` | `"simulation"` | `"amoy"` |

`mode` is `"live"` either way: it tells the dashboard that a real orchestrator
is answering rather than the browser simulating one, which is what its own demo
copy claims. Whether a *chain* is attached is carried by `contracts`, `network`
and `chainId`.

`PRAXIS_MODE=auto` (the default) prefers the chain and falls back to the
simulation with a warning, which is what makes a fresh clone runnable.
`PRAXIS_MODE=live` refuses to fall back: if you asked for a chain and there
isn't one, that is a misconfiguration rather than something to paper over.

The simulation is not a rough mock. It mirrors `AgentRegistry`,
`ActionAttestation`, `DisputeSlashing` and `ReputationScore` line by line —
same wei arithmetic, same integer truncation, same lock-then-slash ordering,
same "an agent under `minBond` stops being active" — so the numbers on the
dashboard without a chain are the numbers Amoy would produce.
`tests/test_ledger.py` pins each rule to the contract it came from.

## Rehearsing the chain path locally

Do this before Amoy. It exercises `ChainLedger` against real contracts and real
transactions on a throwaway chain, so a mistake costs a restart rather than
testnet POL and an hour of the demo window.

```bash
cd ../contracts
npx hardhat node &        # a local chain on 127.0.0.1:8545
npm run deploy:localhost  # writes ../deployed-addresses.json + ../deployments/abis/
npm run fund:localhost    # PRAX + gas for the agent and challenger
```

Then point the orchestrator at it, signing with Hardhat's well-known accounts —
#0 as arbiter, #1 as the agent owner, #2 as the challenger:

```bash
cd ../backend
pip install -e ".[chain]"
PRAXIS_MODE=live PRAXIS_NETWORK=localhost PRAXIS_RPC_URL=http://127.0.0.1:8545 \
ARBITER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
CHALLENGER_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a \
uvicorn praxis.main:app
```

Those keys are Hardhat's published test accounts. They are public, they hold
nothing on any real network, and they must never appear in a `.env` that also
names a live RPC.

`/api/status` should report `chainId` 31337 and the five contract addresses;
every attestation should carry a `txHash`. The rogue →
dispute → slash flow produces the same figures as the simulation — bond 10,000 →
8,000, 2,000 slashed, 1,100 to the challenger — which is the point of the two
implementations agreeing.

`deployed-addresses.json` picks up a `localhost` key from this. It is local
scratch; there is no reason to commit it.

## Going live

```bash
cd ../contracts
npm run wallets:new       # generates the agent + challenger keys
npm run deploy:amoy       # writes ../deployed-addresses.json + ../deployments/abis/
npm run fund:amoy         # PRAX + POL for the agent and challenger

cd ../backend
pip install -e ".[chain]"
cp .env.example .env      # paste the three private keys
uvicorn praxis.main:app
```

The orchestrator reads the address book itself; there is nothing else to wire.
On startup it adopts agents already registered to the signing key rather than
registering duplicates, so restarting does not mint a new identity or post a
second bond.

The three keys must be three different accounts: `DisputeSlashing` rejects a
challenge signed by an address authorised to act for the agent it is
challenging, so an orchestrator sharing one key between the agent and the
watcher cannot open a dispute at all.

## The trail hash

The commitment is shared by three parties — this service writes it,
`ActionAttestation` stores it, the dashboard re-derives it in the browser — so
the bytes being hashed cannot depend on incidental key order:

```python
json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
```

over `{attestationId, agentId, policy, inputs, reasoning, output, nonce}`, then
keccak256 of the UTF-8 bytes. `source`, `model` and `trailHash` are transport
metadata and are excluded — the dashboard strips exactly those three before
recomputing.

Two details bite when porting this between languages, and `canonical.py`
handles both: Python escapes non-ASCII by default and JavaScript does not
(`ensure_ascii=False`), and `JSON.stringify(4000.0)` is `"4000"` where
`json.dumps(4000.0)` is `"4000.0"` (integral floats are narrowed to `int`).

This is not taken on trust. `tests/vectors/trail_vectors.json` is generated by
importing the dashboard's own `frontend/src/lib/canonical.ts` and running it over
cases chosen to break a naive port; `tests/test_canonical.py` replays every one
through the Python implementation and asserts both the serialised string and the
digest match. Regenerate after changing either side:

```bash
cd frontend && npm install
node --experimental-strip-types ../backend/tests/vectors/generate_vectors.mjs
```

## The brain

`decide()` asks Ollama and falls back to a deterministic rule whenever the model
is unreachable, slow, or replies with something that isn't a decision. The trail
records which one answered, so the dashboard never has to guess.

A model that reasons its way into breaching the policy is committed as-is, not
quietly corrected. Silently fixing it would hide precisely the failure this
protocol exists to make visible — the watcher catches it like any other breach.

Rogue mode is the exception: it is scripted rather than prompted, because a demo
of a policy breach has to actually breach, every time.

```bash
ollama pull gemma3        # optional
OLLAMA_MODEL=gemma3 uvicorn praxis.main:app
PRAXIS_LLM_ENABLED=0 uvicorn praxis.main:app   # force the rules
```

## The watcher

`policy.py` holds each policy twice over: as the plain-language sentence the
agent registers on-chain, and as the machine-checkable rule. One object, so the
string a judge reads on the agent card is the rule being enforced.

The watcher is not told about rogue mode. It re-derives the violation from the
committed decision alone, exactly as an outside observer would — so the amber
card on the dashboard is a detection, not a flag someone set.

## API

Exactly the routes `frontend/src/lib/api.ts` declares:

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/api/status` | `SystemStatus` |
| `GET` | `/api/agents` | `Agent[]` |
| `GET` | `/api/attestations?limit=40` | `Attestation[]`, newest first |
| `GET` | `/api/attestations/{id}/trail` | `DecisionTrail`, 404 if unknown |
| `GET` | `/api/disputes` | `Dispute[]`, newest first |
| `POST` | `/api/agents/{id}/rogue` | `{ attestationId }` |
| `POST` | `/api/disputes/{id}/resolve` | `Dispute`, body `{ upheld }` |
| `POST` | `/api/reset` | `204`; simulated mode only |

Two conventions, carried from `types.ts`: **token amounts are decimal strings in
whole PRAX** (`"8000"`, not `"8000000000000000000000"`), and **timestamps are
Unix seconds**.

## Tests

```bash
pip install -e ".[dev]"
pytest                    # 214 tests, no network, no chain, no model
```

| File | Holds the line on |
| --- | --- |
| `test_canonical.py` | byte-for-byte agreement with the dashboard's hashing |
| `test_reputation.py` | parity with `ReputationScore.sol`, component by component |
| `test_ledger.py` | the simulation matching the contracts it mirrors |
| `test_policy.py` | the watcher catching breaches without flagging honest work |
| `test_agents.py` | an agent's rule never breaching its own declared policy |
| `test_llm.py` | unusable model output falling back rather than being committed |
| `test_store.py` | refusing to store a trail that doesn't match its commitment |
| `test_api.py` | the REST contract, and the rogue → dispute → slash flow |
| `test_chain_mapping.py` | the struct indices and enum ordinals `chain.py` decodes by |

## Configuration

Every setting has a working default; see [`.env.example`](.env.example) for the
full list with commentary. The ones that change behaviour most:

| Variable | Default | Effect |
| --- | --- | --- |
| `PRAXIS_MODE` | `auto` | `auto` / `live` / `simulated` |
| `PRAXIS_TICK_SECONDS` | `6.5` | cadence of ordinary agent decisions |
| `PRAXIS_AUTO_ARBITRATE` | `true` | set false to resolve disputes by hand |
| `PRAXIS_LLM_ENABLED` | `true` | set false to force the rule-based path |
| `PRAXIS_SEED_ATTESTATIONS` | `5` | decisions committed at startup |
| `PRAXIS_DB_PATH` | `./praxis.db` | where revealed trails are kept |
