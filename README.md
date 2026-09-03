# Centro

Public traffic platform for São José dos Campos, with **Auto Escola Centro** as the first premium provider.

## Constitutional product boundary

```text
PUBLIC VALUE MUST NOT REQUIRE
AUTO ESCOLA CENTRO ENROLLMENT.

STUDENT STATE MUST NOT EXIST
WITHOUT AN ENROLLMENT.
```

Centro is not a landing page for a driving school. The public product must remain independently useful to any driver or future driver.

## R3B — Public Traffic Platform

The public information architecture is now:

```text
/
├── /cnh
├── /transito
├── /guias
├── /ferramentas
│   └── /ferramentas/minha-jornada
├── /sao-jose-dos-campos
└── /auto-escola-centro
```

### Public regime

No login and no account creation.

The user can:

- understand the current CNH process;
- distinguish public fees from private services;
- explore official traffic and mobility sources;
- read situational guides;
- build a self-declared CNH checkpoint locally in the browser;
- continue independently without contacting Auto Escola Centro.

The public journey is persisted only in `localStorage` under `centro.publicJourney.v1`. It is not an institutional student record.

### Premium provider regime

`Auto Escola Centro` is represented as a provider, not as the owner of the public journey.

Verified state:

- Auto Escola Centro;
- Avenida São José, 1.009 — Centro — São José dos Campos, SP;
- WhatsApp / phone `(12) 9 8177-9745`;
- categories A, B and D;
- first-license, category-addition and licensed-driver training intents.

Explicitly unknown commercial state remains modeled in `src/commercial.ts`:

- pricing;
- fleet;
- opening hours;
- lesson availability;
- payment methods.

## Public data provenance

`src/platform-data.ts` is the R3B source registry. Each public source carries:

```text
source
scope
freshness
checkedAt
status
```

Current source families include:

- Detran-SP CNH guidance;
- Detran-SP practical exams;
- Detran-SP theoretical exams;
- Detran-SP active fleet;
- Detran-SP traffic infractions;
- São José dos Campos municipal traffic monitoring;
- São José dos Campos mobility updates.

R3B exposes source availability and verified public facts only. Historical ingestion and municipal indicators belong to R3C; the UI must not fabricate a number when a dataset has not yet been ingested.

## Architecture

Current client stack:

- React + TypeScript;
- Vite;
- React Router;
- deterministic public journey tool;
- local browser persistence;
- canonical business/commercial state;
- canonical official-guidance snapshot;
- public source registry.

No backend is required for R3B.

## Deployment contract

The repository is deploy-ready as a static SPA using the included multi-stage Docker image:

```text
Node build
   ↓
/dist
   ↓
nginx
   ↓
SPA fallback to /index.html
```

Files:

- `Dockerfile`
- `nginx.conf`
- `railway.toml`

Health endpoint:

```text
GET /healthz → 200 ok
```

The deployment boundary is deliberately after CI. No production URL is part of R3B itself.

## Next regimes

### R3C — Public Intelligence

Ingest official snapshots, normalize municipal observations and publish provenance-bearing indicators for São José dos Campos.

### R3D — Public Tools

Add official-cost and document/checklist tools without requiring authentication.

### R4 — Student Identity

Student identity is issued only after enrollment. No public self-registration.

```text
Student UUID (internal)
Student code (public)
Credential issued by school
```

### R5 — Student Portal

Checkpoint-oriented private surface for enrolled students: real process, lessons, next lesson, documents, exam and financial state.

## Status

`CENTRO-R3B / PUBLIC-TRAFFIC-PLATFORM` — implementation candidate; deploy gate requires green CI.
