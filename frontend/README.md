# Praxis Protocol — Dashboard

Next.js 16 · React 19 · TypeScript · Tailwind 3 · viem

The dashboard makes the whole protocol visible: who is registered, what they
decided, what they staked, and what it cost them when they broke their own
rules.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

No backend and no chain required — see **Demo mode** below.

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |

## Demo mode

With `NEXT_PUBLIC_API_URL` unset, the dashboard runs
[`src/lib/demo-store.ts`](src/lib/demo-store.ts): an in-browser simulation of
three agents, their attestations, and the full rogue → dispute → slash loop.

It is a simulation, and the UI says so in a banner — but two things about it are
real:

- **The arithmetic.** [`src/lib/reputation.ts`](src/lib/reputation.ts) is a
  faithful port of `ReputationScore.sol`, and the slash maths matches
  `DisputeSlashing.sol`. The numbers on screen are what the chain would produce.
- **The hashes.** Trail commitments are genuine `keccak256` digests over the
  canonical trail JSON, and the reveal panel recomputes and compares them in the
  browser.

Point it at a live orchestrator with:

```bash
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

## Structure

```
src/
├── app/
│   ├── layout.tsx           shell + metadata
│   ├── page.tsx             dashboard composition, all data wiring
│   ├── globals.css          design tokens, panel/skeleton primitives
│   └── icon.svg             favicon
├── components/
│   ├── Header.tsx           brand, mode/health badges, wallet connect
│   ├── StatBar.tsx          protocol headline numbers (stat tiles, not charts)
│   ├── DemoControls.tsx     the one-click "Trigger rogue agent" path
│   ├── AgentList.tsx        ┐
│   ├── AgentCard.tsx        ├ policy, bond, reputation + trend, status
│   ├── ReputationTrend.tsx  ┘ headline number + supporting sparkline
│   ├── ActionFeed.tsx       live attestation stream
│   ├── TrailModal.tsx       trail reveal + client-side hash verification
│   ├── DisputeView.tsx      ┐
│   ├── DisputeCard.tsx      ┘ before/after bond and reputation
│   ├── ContractPanel.tsx    deployed addresses + explorer links
│   ├── WalletConnect.tsx    read-only injected-wallet connect
│   └── ui/primitives.tsx    Panel, Badge, Button, Skeleton, Empty/Error states
└── lib/
    ├── api.ts               ★ the only file that talks to the outside world
    ├── types.ts             domain types = the backend contract
    ├── canonical.ts         canonical trail serialisation + keccak256
    ├── demo-store.ts        in-browser simulation
    ├── reputation.ts        TS port of ReputationScore.sol
    ├── wallet.ts            EIP-1193 helpers (read-only)
    ├── hooks.ts             polling, ticker, dismissable overlay
    ├── config.ts            NEXT_PUBLIC_* config
    └── format.ts            presentation helpers
```

### The integration seam

`src/lib/api.ts` defines `PraxisApi` and two implementations (`demoApi`,
`httpApi`). Components only ever see the interface. The expected routes and the
canonical hashing rule are documented in the root
[README](../README.md#wiring-the-backend); the route table lives in the `paths`
object at the top of `api.ts` so remapping is a one-object edit.

## Design

Dark navy ground, cyan as the single accent, and status colours reserved for
agent state so it reads at a glance:

| Token | Use |
| --- | --- |
| `navy.950 → navy.600` | page ground → panel → raised panel → borders |
| `cyan.400 / 500` | the one accent: primary actions, links, live indicators |
| `ink.50 → ink.600` | primary → secondary → muted → disabled text |
| `state.clean` | active agent, clean attestation, rejected challenge |
| `state.disputed` | open dispute, policy violation, demo-mode warning |
| `state.slashed` | slashed bond, destructive actions |

Status hue never travels alone — every coloured dot or bar has a text label
beside it. Reputation is presented as a headline number with a supporting
sparkline rather than a chart: single series, no legend, one marker on the
current value only.

## Wallet connect

Read-only, via the injected EIP-1193 provider (`window.ethereum`), read through
`useSyncExternalStore` so there is no SSR hydration mismatch. The dashboard
never requests a signature or sends a transaction — connecting exists so a judge
can confirm their own wallet sees the same chain and the same contracts.

`wagmi` was dropped in favour of `viem` alone: the WalletConnect and MetaMask
SDK connector trees carried several advisories and are unnecessary for a
read-only connection. `npm audit --omit=dev` reports zero vulnerabilities.

## Accessibility & responsiveness

- Verified at 390px, 820px and 1440px with no horizontal overflow.
- Keyboard-visible focus rings only (`:focus-visible`); Escape closes the trail
  modal and background scroll locks while it is open.
- `prefers-reduced-motion` disables the feed and pulse animations.
- Loading (skeleton), empty and error states on every panel, with retry.
