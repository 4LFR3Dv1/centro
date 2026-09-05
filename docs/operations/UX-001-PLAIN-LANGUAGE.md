# UX-001 — Plain Language Constitution

Status: ACCEPTED LANGUAGE CONTRACT
Parent: #64
Workpack: #65

## Objective

Centro must be usable by people who understand the work of a driving school without requiring them to learn Centro's implementation model.

The interface translates institutional state into familiar work language. Internal architecture remains precise in code, logs, tests and engineering documentation, but primary user-facing surfaces speak only in terms of people, commitments, decisions and consequences.

## Core law

> The system knows the process. The employee knows the work. The interface translates between them.

## Five language rules

1. **Say what is happening, not how it is implemented.**
2. **Prefer a concrete verb over a generic action.** `Agendar aula` is better than `Abrir`.
3. **Tell the user whether they need to act.** Waiting is a valid state and must be explicit.
4. **Explain the consequence of important actions.** The user should know what changes after confirmation.
5. **Errors must contain a recovery path whenever one exists.**

## Primary UI vocabulary

Prefer:

- aluno
- matrícula
- etapa
- próximo passo
- aula
- prova
- resultado
- acesso
- senha
- QR do aluno
- aguardando
- precisa de atenção
- concluído
- não é necessário fazer nada agora

## Forbidden implementation language in primary UI

The following terms are implementation vocabulary and must not appear in ordinary Staff or Student UI copy unless they are part of an explicit technical/audit view:

- materializar / materializado / materialização
- Process Kernel
- Lesson Kernel
- ProcessResolver
- OperationalCommand
- domain authority / autoridade de domínio
- domínio institucional
- milestone / marco processual
- projection / projeção
- intake / intake institucional
- credential / credencial
- derivar / derivado when describing a user task
- state machine / estado de máquina

The identifiers may continue to exist in source code, API contracts, tests, logs and engineering docs.

## CTA convention

A button should predict its effect.

Prefer:

- `Ver aluno`
- `Agendar aula`
- `Registrar resultado`
- `Ver QR do aluno`
- `Copiar link de acesso`
- `Trocar senha`
- `Ver próxima aula`
- `Ver prova`

Avoid generic CTAs when the exact action is known:

- `Abrir`
- `Continuar`
- `Executar`
- `Processar`
- `Confirmar` without naming the object

## State language

### READY

Pattern:

> **[What can happen now]**
> [Why this is the correct next step.]
> `[Exact action]`

Example:

> **Maria já pode começar as aulas práticas.**
> A prova teórica está aprovada.
> `Agendar primeira aula`

### WAITING

Pattern:

> **[What Centro is waiting for]**
> Nenhuma ação da escola é necessária agora.

### BLOCKED

Pattern:

> **[Concrete missing dependency]**
> [Why it prevents the action.]
> `[Resolve dependency]`

### DONE

Pattern:

> **[What is complete]**
> [What happens next, if anything.]

## Form convention

Forms ask questions in the language of the real-world operation.

Prefer:

> `Em que ponto este aluno está?`

instead of exposing internal state names.

Help text should answer one of these questions:

- why are we asking this?
- what format is expected?
- what happens with this information?

Do not explain implementation invariants to ordinary users.

## Error convention

Bad:

> Não foi possível derivar a próxima ação.

Good:

> Não foi possível verificar o próximo passo agora. Tente novamente.

Bad:

> A credencial ainda não foi materializada.

Good:

> O aluno ainda não ativou o acesso.

## Success convention

A success message has two parts:

1. what just changed;
2. what happens next.

Example:

> **Aula agendada.**
> Ela já aparece na agenda da escola e na área do aluno.

## Progressive disclosure

Primary surfaces should display information in this order:

1. what needs attention now;
2. current context;
3. upcoming commitments;
4. identity/details;
5. history;
6. technical/audit evidence.

Technical evidence is available when needed but does not compete with the next operational gesture.

## Student tone

Student copy is direct, calm and personal. It does not mention institutional architecture.

Prefer:

- `Agora`
- `Sua próxima aula`
- `Você não precisa fazer nada agora`
- `A escola precisa registrar o resultado`

## Staff tone

Staff copy is operational and concise. It names the person, the situation and the next gesture.

Prefer:

- `3 alunos precisam de atenção`
- `Aguardando resultado do Detran`
- `Agendar primeira aula`

## Acceptance test

For every primary UI string ask:

1. Would a driving-school employee understand this on day one?
2. Does it describe work instead of implementation?
3. If action is required, is the action obvious?
4. If no action is required, does the interface say so?
5. If the user confirms an operation, do they understand what changes next?

If any answer is no, the copy is not accepted.