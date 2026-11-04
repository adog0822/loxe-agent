# Loxe product UI: design rules

Loxe clears AI agents against a frozen probe battery and proves it with a hash-chained ledger.
The UI is a game-menu hub applied to that job: one move leads every screen, everything else
ranks behind it, and every claim is one click from its evidence.

Scene: an engineering lead in daylight, a buyer's security questionnaire open in another tab,
who needs to know in five seconds which agent is the problem and what to do about it. Light is
the default; dark is a full token set for late sessions and follows the OS unless toggled.

## Files
- `css/tokens.css`: every value (type, space, radius, colour light and dark, motion, layers).
- `css/app.css`: components. No value in it that is not a token, except 1px and 2px geometry.
- `js/app.js` shell, auth and router; `js/api.js` client; `js/mock.js` fixtures for `?mock=1`;
  `js/canonical.js` the browser twin of `src/core/canonical.js`; `js/screens/*` one file per screen.

## Type
- Bodoni Moda (opsz axis, weight 500 to 600) only for: word-only H1s, the grade letter, the report cover headline.
- An H1 that contains a digit sets in Geist 600 instead (`h1()` in `ui.js` decides). Didone figures read slowly.
- Geist for everything else: 15px body, 13px labels at weight 500 with +0.01em, buttons 13px 600.
- Geist Mono 12px only for hashes, probe IDs, URLs, rule output and patches.
- Scale (rem): grade 7.5, H1 2.75 (2.125 on phones), H1 with number 2.25, H2 1.375, H3 1.0625, body 0.9375, small 0.8125, mono 0.75.
- Tabular figures everywhere. Small counts are spelled out in sentences ("five open gaps").

## Colour
Ninety percent of the screen is ink on a near-white with chroma 0.003 toward hue 205 (clear
water, not navy, not cream). Colour appears only when state changes:

| Token | Light | Dark | Means |
|---|---|---|---|
| `--proven` / `--proven-fill` | oklch 0.47 0.12 152 / 0.68 0.175 150 | 0.82 0.165 152 | Passed, verified, connected |
| `--gap` / `--gap-fill` | oklch 0.53 0.195 27 / 0.60 0.215 27 | 0.72 0.18 32 | Failing, open, broken |
| `--stale` / `--stale-fill` | oklch 0.50 0.10 72 / 0.76 0.14 78 | 0.83 0.12 82 | Inconclusive, out of date |

`*-wash` tints back verdict panels. `*-live` versions sit on the hero tile, which is ink in light
mode and a raised slab (`--hero-bg`) in dark mode. Text pairs clear 4.5:1; marks clear 3:1.
The primary action is ink, never a colour. No gradients except the hatch patterns of state marks
and the skeleton shimmer.

## State marks
Shape carries meaning before colour, so the marks survive greyscale and colour blindness.
- Pass: solid square. Fail: square with its top-right corner cut away.
- Inconclusive or stale: hatched square. Not run or not configured: dotted outline.
- Running: outline that fills from the bottom, on a loop.
- Decisions on a failing probe keep the cut corner: accepted exception is an outline with a slash,
  fix proposed is half filled, resolved is a green outline (a claim) until a re-run makes it solid (proof).
- Grade seal: Bodoni letter in a 4px-radius frame. A is filled green, D and F filled red, B and C
  are ink outlines with a red cut corner, never-graded is dotted, stale adds a hatched band, running fills.
- Probe strip: one cell per probe, grouped by the five categories. Failing cells are taller and cut,
  so a run reads like a barcode of its gaps at any size.

## Layout
- Hub, 7/4: the hero tile holds the next move (default focus, so Enter does it); the rail ranks the
  next four; the roster below is ordered by the same rule. The rule, in order: ledger does not verify,
  run stopped, open critical or high gaps, never run, stale (older than 7 days with sentinel off),
  other gaps, running, cleared.
- Report, Run and Ledger, 7/3: the dominant pane holds the live evidence (findings, lanes, trace);
  the side pane holds facts, controls and verdicts. Add, Share and Monitor use 3/2.
- No identical card grids. Max width 1280, gutter 32 (16 on phones). Everything collapses to one
  column under 980px; the roster turns into stacked rows under 860px.
- Radius 4px small, 6px controls, 8px tiles and panels (the ceiling). 1px hairlines. No capsules.

## Disclosure
Every finding has three layers, always in this order: the plain sentence (row), the reason and the
fix (expanded), the raw record (rule output, patch, replay, control IDs, payload and entry hash).
A "Read as" toggle switches every finding between Plain English, Engineer and Auditor; each finding
also has its own toggle. The raw layer is never removed.

## Visible proof
- Live run polls `GET /api/runs/:id` every second. Lanes fill per category from `progress.current`;
  on completion the lanes turn into the real pass, fail and inconclusive cells.
- Ledger trace recomputes `sha256(canonical({agentId, seq, prevHash, payloadHash}))` in the browser
  for each entry, types the hash in, links it to the previous entry, and marks every entry after a
  mismatch as unproven. The verdict panel is driven by the real `GET /verify/:agentId` response.
  Try `?mock=1&tamper=1` to see a broken chain.

## Motion
120ms focus, 180ms state, 220ms screen, 520ms meter fill, expo-out. Nothing blocks input. The hero
draws one outline on first arrival and stops. `prefers-reduced-motion` cuts everything to instant
and skips the hash typing.

## Voice
- One headline and one sentence per section. Headlines say the state or the move:
  "Fix Support Copilot first." "Check the ledger yourself." "Evidence a buyer can check without asking you."
- Buttons are verbs with objects: "Fix the critical gap", "Run clearance now", "Verify the chain".
- Every status says what is true, since when, and from which system.
- Loading says what the backend is doing ("Asking Maritime which agents you host").
- Errors say what happened, that nothing was lost, and what to do, with a copyable raw error.
- Missing integrations say "Not configured: set X on the Loxe server".
- The claim is always "cleared against these probes on this date, verifiable here".
  Never certified, compliant or approved. The Share screen states what the page does not claim.
- Banned: em and en dashes, middle-dot separators, eyebrow labels, pill tags over headers,
  three-word staccato, "No X. No Y." frames, title-cased bold bullet leads, and the words elevate,
  revolutionize, supercharge, transform, leverage, seamless, genuinely, exactly, meticulously,
  unlock, robust, cutting-edge. Checked by grep before shipping.

## Mock mode
`?mock=1` answers every call from `js/mock.js`, shaped field for field like `docs/API.md`, with real
SHA-256 ledger hashes. Extra switches: `&tamper=1` (broken chain), `&empty=1` (no agents),
`&signedout=1` (dev sign-in screen). Serve with `python3 -m http.server 4318 --directory web`.
