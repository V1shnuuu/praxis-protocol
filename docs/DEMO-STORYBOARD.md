# Praxis Protocol — demo video storyboard

**Target length:** 75 seconds (usable range 60–90).
**Format:** screen recording at 1440×900 or 1920×1080, dashboard in a clean
browser window, no devtools, no bookmarks bar.

## Before you record

Either source works, and the dashboard looks identical:

```bash
cd frontend && npm run dev          # demo mode, no backend needed
```

```bash
cd backend && uvicorn praxis.main:app          # the real orchestrator
cd frontend && NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 npm run dev
```

Demo mode seeds its agents with nine days of history; the orchestrator starts
them fresh, so its scores sit about 20 points lower (no longevity bonus yet)
and the header reads Live rather than Demo mode. Every bond figure below is
identical either way — those come from the contract arithmetic, not the seed.

- Open `http://localhost:3000` and let it sit ~30 seconds so the feed has
  history and the sparklines have shape. A dashboard with five entries reads as
  "running system"; an empty one reads as "prototype".
- Click **Reset demo** right before you hit record, then wait ~15 seconds.
- If recording against live contracts instead, set `NEXT_PUBLIC_API_URL` and
  have `contracts && npm run demo:amoy` output ready in a second window for the
  PolygonScan cutaway at 0:60.

---

## Shot list

| Time | Shot | On screen | Voiceover |
| --- | --- | --- | --- |
| **0:00–0:08** | Full dashboard, slow scroll from header to agent cards. | Three agent cards: name, declared policy, bond, reputation with trend. | "Three autonomous agents. Each one registered on-chain with a policy it declared in plain language — and a bond it staked against keeping that policy." |
| **0:08–0:16** | Cursor to TradingAgent's policy line, hold. Then pan to the live feed. | "Never allocate more than 20% of the book to a single asset." Feed streaming compliant trades and votes. | "This one is capped at twenty percent in any single asset. Every decision it makes is hashed and committed on-chain as it happens." |
| **0:16–0:28** | Click a feed row. Trail modal opens. Hold on the green verification banner. | Full reasoning trail; committed hash and recomputed hash, identical; "Trail matches the on-chain commitment". | "Here's the full reasoning behind one decision. The dashboard recomputes the hash in the browser and checks it against what's on-chain. The trail can't be rewritten after the fact — the hash would break." |
| **0:28–0:32** | Close the modal. Cursor moves to the red button. | "Trigger rogue agent" button, TradingAgent selected. | "So what happens when an agent breaks its own rules?" |
| **0:32–0:40** | Click. New feed row appears, flagged. Agent card turns amber. | "BUY $73k ETH — 85% of book", Policy violation badge. Rogue mode badge on the card. | "Eighty-five percent of the book into one asset. Its declared cap is twenty. The violation is committed on-chain like any other action — it can't be hidden." |
| **0:40–0:52** | Dispute panel: card appears, countdown starts. Cut to the agent card showing locked bond. | Dispute #1 "Open — awaiting arbitration", challenge window counting down, 2,000 PRAX locked, reputation ticking down. | "A watcher spots it, stakes a fee, and opens a dispute. Two thousand PRAX of the bond is frozen while it's contested, and the reputation takes an immediate hit." |
| **0:52–1:05** | Dispute resolves. Hold on the before/after block. | "Upheld — bond slashed". Before 10,000 PRAX → After 8,000 PRAX. Bond slashed 2,000. Paid to challenger 1,100. Reputation drops ~190 points, from the low 600s to the mid 400s. | "The challenge is upheld. Two thousand PRAX burned from the bond, eleven hundred paid to the challenger who caught it, and the reputation drops by nearly two hundred points — live." |
| **1:05–1:12** | Pan up to the agent card. Sparkline shows the cliff. | TradingAgent: tier NEUTRAL, 8,000 PRAX, slash count 1 in red, sparkline dropping. Still Active — 8,000 is well over the 1,000 minimum. | "That mark is permanent and it's portable. The agent is still bonded and still allowed to act — but every protocol can now read what it did, straight from the chain." |
| **1:12–1:15** | Cut to the On-chain deployment panel / PolygonScan tab. | Contract addresses with explorer links, or the verified contract on Amoy. | "All of it on Polygon Amoy. Praxis Protocol." |

---

## Notes for the edit

- **The before/after block at 0:52 is the shot that matters.** Give it four
  seconds of stillness. Everything else can be tightened if you run long.
- **Don't script the exact reputation numbers.** The bond figures are fixed by
  the contract — 10,000 → 8,000, 2,000 slashed, 1,100 to the challenger, every
  run. The score depends on how many clean attestations landed before you hit
  the button, so it shifts by a few points between takes. The drop is always
  about 190: 150 for the slash and 40 for the share of the bond burned.
- Don't narrate over the hash verification at 0:16 — let the two identical
  hashes sit on screen for a beat. It's the most technically convincing moment
  and it reads better silent.
- The rogue → dispute → slash sequence runs on its own timers (~7 seconds
  total). Don't cut away mid-sequence; the continuity is the point.
- If you need to trim to 60 seconds, cut the modal shot (0:16–0:28) down to five
  seconds on the banner alone, and drop the policy hold at 0:08.
- Record at least two takes of 0:32–1:05 without touching anything — the timing
  is deterministic, so you can pick the cleanest one.

## Fallback if something misbehaves on the day

`Reset demo` restores every agent to its opening bond and clears the disputes.
It's safe to press mid-recording; the feed repopulates within a few seconds.
Against the orchestrator the same thing is `curl -X POST
http://127.0.0.1:8000/api/reset`.

And if an agent has already been slashed in an earlier take, you can still use
it: a slash only takes an agent out of the system once its bond falls under the
1,000 PRAX minimum, which takes seven of them.
