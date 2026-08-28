# Praxis Protocol — Contracts

The on-chain accountability layer: agent identity and bonding, hashed action
attestations, challenge-and-slash disputes, and a portable reputation score.

Solidity 0.8.24 · Hardhat · OpenZeppelin 5 · target chain **Polygon Amoy (80002)**

## Contracts

| Contract | Responsibility |
| --- | --- |
| `PraxisToken.sol` | Test ERC-20 (`PRAX`) used for bonds and challenge fees. Open faucet, testnet only. |
| `AgentRegistry.sol` | Agent identity, metadata URI (declared policy), bond escrow, operator delegation, slashing primitives. |
| `ActionAttestation.sol` | Append-only log of `keccak256(decision trail)` commitments, one event per agent action. |
| `DisputeSlashing.sol` | Challenge window, staked disputes, arbiter resolution, slash distribution. |
| `ReputationScore.sol` | Stateless view contract deriving a 0–1000 score from the other three. |

### How they fit together

```
                     ┌──────────────────┐
   bond (PRAX) ─────▶│  AgentRegistry   │◀── slash / lock / credit ──┐
                     │  identity+bond   │                            │
                     └────────┬─────────┘                            │
                              │ isAuthorized / isActive              │
                              ▼                                      │
                     ┌──────────────────┐   markDisputed    ┌────────┴─────────┐
   agent action ────▶│ ActionAttestation│◀──────────────────│  DisputeSlashing │◀── challenge fee
   (hashed trail)    │  decision log    │   markResolved    │  challenge+slash │
                     └────────┬─────────┘                   └────────┬─────────┘
                              │                                      │
                              └──────────────┬───────────────────────┘
                                             ▼
                                   ┌──────────────────┐
                                   │  ReputationScore │──▶ 0–1000, read by anyone
                                   │  (pure views)    │
                                   └──────────────────┘
```

Deployment order matters: `PraxisToken → AgentRegistry → ActionAttestation →
DisputeSlashing → ReputationScore`, then `registry.setSlasher(dispute)` and
`attestation.setDisputeModule(dispute)`. `scripts/deploy-core.js` does all of it.

## Economics (defaults, all configurable)

| Parameter | Default | Meaning |
| --- | --- | --- |
| `minBond` | 1 000 PRAX | Floor an agent must keep posted to stay active. |
| `challengeWindow` | 300 s | How long an attestation stays challengeable. Short on purpose, so a live demo takes seconds. |
| `challengeFee` | 100 PRAX | Staked by the challenger; deters spam disputes. |
| `slashBps` | 2 000 (20%) | Share of the agent's *remaining* bond burned on an upheld dispute. |
| `challengerRewardBps` | 5 000 (50%) | Share of the slash paid to the challenger; the rest goes to the treasury. |

Resolution outcomes:

- **Upheld** — the agent's bond is slashed. The challenger gets their fee back
  plus `challengerRewardBps` of the slash; the treasury takes the remainder. If
  the slash drops the bond under `minBond`, the agent is deactivated and can no
  longer attest.
- **Rejected** — the challenger forfeits their fee, which is credited to the
  agent's bond as compensation for the false accusation.

A dispute reserves (`lockBond`) the amount at risk when it opens, so an agent
cannot withdraw out from under a pending challenge.

## Reputation formula

Stateless and readable by any contract — no indexer to trust.

```
score = 500 (base)
      + 5   per clean attestation      (cap 250)
      + 2   per day registered         (cap 100)
      + 25  per multiple of minBond held above the minimum (cap 100)
      + 20  per successfully defended dispute (cap 60)
      - 150 per slash
      - up to 200 severity, scaled by (totalSlashed / lifetime bond)
      - 40  per currently open dispute
clamped to [0, 1000];  an inactive (slashed-out) agent scores 0
```

Tiers: `TRUSTED` ≥ 800 · `RELIABLE` ≥ 600 · `NEUTRAL` ≥ 400 · `WATCH` ≥ 200 · `UNTRUSTED` below.

## Setup

```bash
cd contracts
npm install
cp .env.example .env     # then fill it in
npm run build
npm test
```

`.env` is git-ignored. Never put a key with real value in it — everything here
is testnet-only.

### Wallets

The demo uses three roles so it mirrors the real trust model:

| Role | Key | Does |
| --- | --- | --- |
| deployer | `DEPLOYER_PRIVATE_KEY` | deploys, and is protocol admin + arbiter + treasury |
| agent | `AGENT_PRIVATE_KEY` | owns the registered agents; the Phase 2 orchestrator signs as this key |
| challenger | `CHALLENGER_PRIVATE_KEY` | the watcher that stakes a fee to open disputes |

Only the deployer is needed to deploy. To create the other two:

```bash
npm run wallets:new       # prints two fresh keys — paste them into .env
```

Fund the deployer with test POL from <https://faucet.polygon.technology> (select
Polygon Amoy), then top the other two up with gas and PRAX:

```bash
npm run fund:amoy
```

## Deploying

```bash
npm run deploy:amoy
```

This writes `../deployed-addresses.json` (keyed by network — the backend and
frontend both read it) and exports plain ABIs to `../deployments/abis/`.

Local alternatives:

```bash
npm run deploy:local          # in-process chain, ephemeral
npm run node                  # persistent node on :8545, in another terminal
npm run deploy:localhost
```

## Verifying on PolygonScan

```bash
POLYGONSCAN_API_KEY=... npm run verify:amoy
```

The script reads every address and constructor argument from
`deployed-addresses.json`, so there is nothing to retype. Contracts already
verified are reported and skipped.

<details>
<summary>Manual verification, if you have no API key</summary>

1. Open `https://amoy.polygonscan.com/address/<contract>#code` → **Verify and Publish**.
2. Compiler type: **Solidity (Standard-Json-Input)**. Compiler: **v0.8.24+commit.e11b9ed9**. License: **MIT**.
3. Upload the standard JSON input, which Hardhat leaves in
   `artifacts/build-info/*.json` under the `input` key:
   ```bash
   node -e "const b=require('./artifacts/build-info/'+require('fs').readdirSync('./artifacts/build-info')[0]); \
     require('fs').writeFileSync('standard-input.json', JSON.stringify(b.input))"
   ```
4. ABI-encode the constructor arguments (the same lists as in `scripts/verify.js`)
   and paste them in the constructor arguments field.
5. Repeat for each of the five contracts.
</details>

## End-to-end demo flow

Runs the whole Phase 1 storyline against live contracts and prints explorer
links for every transaction:

```bash
npm run demo:amoy        # or demo:local / demo:localhost
```

```
register agent (10 000 PRAX bond)  →  reputation 600
  ↓ compliant attestation                reputation 605
  ↓ rogue attestation (85% of book, cap is 20%)
  ↓ watcher reveals the trail, hash matches, opens a dispute
  ↓ 2 000 PRAX locked                    reputation 570
  ↓ arbiter upholds
bond 10 000 → 8 000 PRAX, challenger paid 1 100 PRAX
                                         reputation 415 (NEUTRAL)
```

## Tests

```bash
npm test          # 66 tests
npm run coverage  # 97.5% statements, 99.0% lines
```

| File | What it covers |
| --- | --- |
| `test/AgentRegistry.test.js` | registration, bonding, top-up/withdraw, operators, lock/unlock, slash arithmetic, access control, pagination, faucet |
| `test/ActionAttestation.test.js` | attestation submission, operator delegation, replay protection, trail verification, dispute hooks, feed pagination |
| `test/DisputeSlashing.test.js` | challenge window, fee staking, upheld/rejected payouts, token conservation, concurrent disputes, arbiter access control |
| `test/ReputationScore.test.js` | every bonus and penalty term, caps, clamping at 0 and 1000, batch reads |
| `test/EndToEnd.test.js` | the full demo storyline, plus the honest-agent and token-conservation invariants |

## Notes on the build

`solc` is pinned as an npm devDependency and wired in through a
`TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD` override in `hardhat.config.js`, so
compilation never reaches out to `binaries.soliditylang.org`. Builds are
reproducible and work in sandboxed CI. If the pinned package is missing,
Hardhat falls back to its normal download path.
