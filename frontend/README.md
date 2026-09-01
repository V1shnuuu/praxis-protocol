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
│   ├── globals.css          glass primitives, motion classes, reduced-motion
│   └── icon.svg             favicon
├── components/
│   ├── ParallaxBackground.tsx  the aurora field the glass refracts
│   ├── Hero.tsx             landing band, layered against the backdrop
│   ├── Reveal.tsx           scroll-into-view wrapper
│   ├── Header.tsx           brand, mode/health badges, wallet connect, progress rail
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
    ├── parallax.ts          parallax, tilt, scroll-progress and reveal hooks
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

Frosted glass on a deep, lit ground. The surface language is translucent panes
separated by hairlines of light rather than by shadows, over an aurora backdrop
that supplies the colour they refract.

| Token | Use |
| --- | --- |
| `void.900` | the page ground |
| `paper.100 / 200` | opaque fallback fills where `backdrop-filter` is unavailable |
| `line.200 → 400` | rising border strength, all translucent white |
| `ink.900 → 400` | falling text emphasis: primary → secondary → muted → faint |
| `accent.500 / 600` | the one accent: live indicators, links, marks |
| `iris.400 / 500` | secondary hue, backdrop and the hero gradient only |
| `state.clean / disputed / slashed` | agent and attestation state |

Three things together make a `.panel` read as glass, and dropping any one of
them makes it read as a grey box: the `backdrop-blur`, the ~5% white fill that
tints what shows through, and the inset hairline along the top edge that reads
as a lit bevel. The blur is the part with a dependency — a blur of a flat colour
is that same flat colour, so `<ParallaxBackground />` is load-bearing, not
decoration.

Every state colour is the dark-ground variant; the light-theme greens and reds
sat under 3:1 against this base. `ink.900/800/600` clear AA on the glass fills
at body sizes, and `ink.400` is decorative or large-only. Status hue never
travels alone — every coloured dot or bar has a text label beside it.
Reputation is a headline number with a supporting sparkline rather than a
chart: single series, no legend, one marker on the current value only.

`@supports not (backdrop-filter: ...)` swaps the panes to opaque fills, because
5% white on near-black with no blur is invisible.

## Motion

`lib/parallax.ts` holds four hooks, all driven from rAF loops that write only
`transform` or a custom property resolving to one — a 60fps scroll must not
re-render a dashboard already polling four endpoints.

| Hook | Drives |
| --- | --- |
| `useParallax` | backdrop and hero layers, from scroll offset and an eased pointer |
| `useTilt` | per-card 3D tilt towards the pointer, bound to the element, not the window |
| `useScrollProgress` | the reading rail under the header, as `scaleX` |
| `useReveal` | one-shot fade-and-lift as a section enters the viewport |

Layer speeds must decrease down the page: a lower element travelling up faster
than the one above it slides into it as you scroll.

`useTilt` writes CSS variables rather than `transform` directly, so the
stylesheet keeps ownership of the function order (perspective first, or the
rotation shears) and of the settle transition on leave. It is skipped entirely
on coarse pointers, where a card would tilt on tap and stay tilted.

`useScrollProgress` is the one hook that still runs under reduced motion: the
rail reports position rather than decorating, and freezing it at zero would
misreport where the reader is. Everything else rests.

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
- `prefers-reduced-motion` rests every parallax layer, tilt and reveal; only
  the scroll-progress rail keeps updating, because it reports position.
- Loading (skeleton), empty and error states on every panel, with retry.
