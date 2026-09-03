# Centro

Digital acquisition and operating surface for **Auto Escola Centro**, São José dos Campos — SP.

## Canonical business identity

- **Name:** Auto Escola Centro
- **Legacy name found in old copy:** Auto Escola Central
- **Address:** Avenida São José, 1.009 — Centro — São José dos Campos, SP
- **Phone / WhatsApp:** (12) 9 8177-9745
- **Operating history:** more than 20 years, according to the business's supplied institutional copy
- **Confirmed categories:** A, B and D
- **Confirmed service intents:** first CNH, category addition and training for licensed drivers

The canonical public identity lives in `src/business.ts`. Commercial knowledge lives in `src/commercial.ts` and must carry an explicit state instead of being inferred from missing data.

## Commercial knowledge model

Each commercial field is classified as:

- `verified` — confirmed by the operation and safe to state publicly;
- `unknown` — not currently known and must not be invented;
- `needs_review` — recovered from a legacy/public source but still requires reconciliation.

Current state:

| Field | State |
| --- | --- |
| Categories A / B / D | `verified` |
| First CNH / category addition / licensed-driver training | `verified` |
| Pricing | `unknown` |
| Fleet | `unknown` |
| Opening hours | `unknown` |
| Lesson availability | `unknown` |
| Payment methods | `unknown` |

Public UI renders unknown commercial data as **consult current conditions**, never as fabricated placeholders.

## R3A — Commercial Foundation

R3A establishes four contracts:

1. **Canonical commercial state** — known and unknown facts are represented explicitly.
2. **Contextual WhatsApp** — the selected CNH journey determines the message handed to the real WhatsApp channel.
3. **Service reconciliation** — A, B and D are verified; unconfirmed pricing/fleet/scheduling data remain unknown.
4. **Official guidance boundary** — Detran-SP rules, fees and process guidance live separately from Auto Escola Centro commercial conditions.

Official guidance is represented in `src/official-guidance.ts` as a dated snapshot, with the Detran-SP source retained. It is not treated as Auto Escola Centro policy.

## Product thesis

Centro is not a brochure site. It is the public interface between a student, the CNH journey and Auto Escola Centro's real operating capacity.

The product focuses on:

- diagnosing where the student is in the CNH journey;
- recommending the next practical action;
- handing a qualified lead to WhatsApp with context;
- separating public regulation from private commercial offer;
- making location and contact information first-class product objects;
- establishing canonical state that can later reconcile the website, Google Business Profile and other public surfaces;
- preparing for scheduling, Detran-SP intelligence, ViaCEP, weather and mobility adapters without making those integrations runtime dependencies.

## Interface direction

The UI is inspired by the product discipline of Lisa App rather than copied from its identity: warm neutral canvas, editorial hierarchy, restrained surfaces, semantic accent color, compact operational cards and short state transitions.

Centro translates that language into a driving system: route/progress primitives, category/state signals, local context and direct operational handoff.

## Status

`CENTRO-R3A / COMMERCIAL-FOUNDATION` — canonical commercial state, contextual WhatsApp, verified A/B/D catalog and official-guidance boundary materialized.
