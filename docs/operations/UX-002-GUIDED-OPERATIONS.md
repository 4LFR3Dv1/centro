# UX-002 — Guided Operation Primitives

Status: PRESENTATION CONTRACT
Parent: #64
Workpack: #66
Depends on: UX-001

## Objective

Provide a shared presentation vocabulary that converts existing Centro operational state into guidance a first-time user can understand.

This layer is presentation-only. It never owns institutional facts and never executes mutations independently of the existing domain commands.

## Boundary

```text
Process / Schedule / Exams / Access
              |
              | existing facts + commands
              v
      Guided presentation adapter
              |
              v
          GuidedState
              |
              v
        Staff / Student UI
```

`GuidedState` is not a workflow state machine. It is a UI projection.

## Contract

```ts
type GuidedStateKind = 'READY' | 'WAITING' | 'BLOCKED' | 'DONE';

type GuidedState = {
  kind: GuidedStateKind;
  eyebrow?: string;
  title: string;
  detail?: string;
  consequence?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryActions?: Array<{
    label: string;
    onClick: () => void;
  }>;
};
```

## Meaning

### READY

The user can do something now.

Required UI behavior:
- say what can happen;
- explain why;
- expose one obvious primary action whenever one exists.

### WAITING

Centro is waiting for an external or later event.

Required UI behavior:
- say what is being waited for;
- explicitly state that no user action is required when that is true;
- do not visually compete with READY/BLOCKED items.

### BLOCKED

The expected action cannot proceed because a concrete prerequisite is missing.

Required UI behavior:
- name the missing prerequisite;
- explain why it matters;
- link to the existing owner-domain surface that can resolve it when available.

### DONE

No current action remains for this context.

Required UI behavior:
- confirm what is complete;
- explain the next expected transition if useful;
- do not invent a new action.

## OperationalAction adapter

Existing `OperationalAction.severity` maps only to presentation:

```text
ACTION_REQUIRED -> READY
SCHEDULED       -> WAITING
WAITING         -> WAITING
BLOCKING        -> BLOCKED
COMPLETE        -> DONE
```

The adapter may rewrite labels and explanatory copy according to UX-001, but:

- `primaryCommand` remains the only primary command authority;
- `secondaryCommands` remain the only secondary command authority;
- `href` remains navigation only;
- the adapter must not fabricate an executable action.

## Loading

Preferred:

> Verificando o próximo passo…

Not:

> Derivando orientação operacional…

## Error

Preferred:

> Não foi possível verificar o próximo passo agora.
> `Tentar novamente`

The original technical error may remain available to logs/diagnostics but should not be the only user-facing explanation.

## Completion

Preferred:

> Nenhuma etapa precisa de atenção agora.
> Quando algo mudar, o próximo passo aparecerá aqui.

## Confirmation consequence

After a successful mutation, surface what changed and where the result can be found.

Examples:

- lesson: `A aula foi agendada e já aparece na agenda da escola e do aluno.`
- exam result: `O resultado foi registrado e o próximo passo do aluno foi atualizado.`
- access: `O QR foi substituído. Use apenas o novo código a partir de agora.`

## Accessibility requirements

A guided primitive must:

- use semantic heading structure;
- never encode state only by color;
- expose state text (`Precisa de ação`, `Aguardando`, `Impedido`, `Concluído`);
- preserve keyboard reachability for every action;
- use `aria-live="polite"` for asynchronous state replacement where appropriate;
- avoid auto-focus jumps that move the user unexpectedly.

## Acceptance

A first-time user can look at a guided block and answer without documentation:

1. What is happening?
2. Do I need to do something?
3. If yes, what exactly should I do?
4. If no, what are we waiting for?
5. What happens after the action?