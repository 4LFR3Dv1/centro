import './exception-guidance.css';

export type ExceptionKind =
  | 'CONFLICT'
  | 'MISSING_DEPENDENCY'
  | 'ABSENCE'
  | 'REJECTION'
  | 'DIVERGENCE'
  | 'PAUSED'
  | 'ACCESS_BLOCKED'
  | 'STALE_REFERENCE';

export type ExceptionActor = 'STAFF' | 'STUDENT' | 'EXTERNAL' | 'NONE';

export type ExceptionGuidance = {
  kind: ExceptionKind;
  title: string;
  detail: string;
  consequence?: string;
  actor: ExceptionActor;
  actionHint?: string;
};

const kindLabels: Record<ExceptionKind, string> = {
  CONFLICT: 'CONFLITO',
  MISSING_DEPENDENCY: 'FALTA RESOLVER',
  ABSENCE: 'AUSÊNCIA',
  REJECTION: 'RESULTADO',
  DIVERGENCE: 'PRECISA CONFERIR',
  PAUSED: 'PAUSADO',
  ACCESS_BLOCKED: 'ACESSO BLOQUEADO',
  STALE_REFERENCE: 'ACESSO ANTIGO',
};

const actorLabels: Record<ExceptionActor, string> = {
  STAFF: 'A escola precisa agir.',
  STUDENT: 'Você precisa agir.',
  EXTERNAL: 'Nenhuma ação é necessária agora. Estamos aguardando uma confirmação externa.',
  NONE: 'Nenhuma ação é necessária agora.',
};

export function ExceptionGuidanceCard({ guidance, compact = false }: { guidance: ExceptionGuidance; compact?: boolean }) {
  const passive = guidance.actor === 'EXTERNAL' || guidance.actor === 'NONE';
  return (
    <section
      className={`exception-guidance exception-${guidance.kind.toLowerCase()}${compact ? ' is-compact' : ''}`}
      role={passive ? 'status' : 'alert'}
      aria-live={passive ? 'polite' : 'assertive'}
    >
      <span className="exception-guidance-kind">{kindLabels[guidance.kind]}</span>
      <strong>{guidance.title}</strong>
      <p>{guidance.detail}</p>
      {guidance.consequence && <small>{guidance.consequence}</small>}
      <footer>
        <b>{actorLabels[guidance.actor]}</b>
        {guidance.actionHint && <span>{guidance.actionHint}</span>}
      </footer>
    </section>
  );
}

export function scheduleExceptionGuidance(message: string): ExceptionGuidance {
  const normalized = message.toLocaleLowerCase('pt-BR');

  if (normalized.includes('aluno já possui uma aula')) {
    return {
      kind: 'CONFLICT',
      title: 'O aluno já tem uma aula nesse horário.',
      detail: message,
      consequence: 'A nova aula não foi criada e os dados deste formulário foram preservados.',
      actor: 'STAFF',
      actionHint: 'Escolha outro horário e tente novamente.',
    };
  }
  if (normalized.includes('instrutor já está ocupado')) {
    return {
      kind: 'CONFLICT',
      title: 'O instrutor já está ocupado nesse horário.',
      detail: message,
      consequence: 'A nova aula não foi criada e os demais dados continuam preenchidos.',
      actor: 'STAFF',
      actionHint: 'Troque o horário ou escolha outro instrutor.',
    };
  }
  if (normalized.includes('veículo já está ocupado')) {
    return {
      kind: 'CONFLICT',
      title: 'O veículo já está ocupado nesse horário.',
      detail: message,
      consequence: 'A nova aula não foi criada e os demais dados continuam preenchidos.',
      actor: 'STAFF',
      actionHint: 'Troque o horário ou escolha outro veículo.',
    };
  }
  if (normalized.includes('matrícula não está disponível') || normalized.includes('aluno e matrícula ativos')) {
    return {
      kind: 'PAUSED',
      title: 'Esta matrícula não está disponível para novas aulas.',
      detail: message,
      consequence: 'Nenhum horário foi criado.',
      actor: 'STAFF',
      actionHint: 'Abra o aluno e verifique a situação da matrícula antes de continuar.',
    };
  }
  if (normalized.includes('instrutor não está ativo') || normalized.includes('autorizado para esta categoria')) {
    return {
      kind: 'MISSING_DEPENDENCY',
      title: 'O instrutor escolhido não pode atender esta categoria.',
      detail: message,
      consequence: 'A aula não foi criada.',
      actor: 'STAFF',
      actionHint: 'Escolha um instrutor autorizado para a categoria.',
    };
  }
  if (normalized.includes('veículo não está ativo') || normalized.includes('não pertence à categoria')) {
    return {
      kind: 'MISSING_DEPENDENCY',
      title: 'O veículo escolhido não pode ser usado nesta aula.',
      detail: message,
      consequence: 'A aula não foi criada.',
      actor: 'STAFF',
      actionHint: 'Escolha um veículo ativo da mesma categoria.',
    };
  }
  if (normalized.includes('categoria da aula não é compatível')) {
    return {
      kind: 'MISSING_DEPENDENCY',
      title: 'A categoria escolhida não pertence a esta matrícula.',
      detail: message,
      consequence: 'A aula não foi criada.',
      actor: 'STAFF',
      actionHint: 'Use uma categoria permitida pela matrícula.',
    };
  }

  return {
    kind: 'MISSING_DEPENDENCY',
    title: 'Não foi possível manter esta combinação.',
    detail: message,
    consequence: 'Nenhuma alteração foi feita.',
    actor: 'STAFF',
    actionHint: 'Revise o horário, o instrutor e o veículo e tente novamente.',
  };
}

export function accessExceptionGuidance(message: string): ExceptionGuidance {
  const normalized = message.toLocaleLowerCase('pt-BR');
  if (normalized.includes('bloque') || normalized.includes('locked')) {
    return {
      kind: 'ACCESS_BLOCKED',
      title: 'As tentativas de entrada estão temporariamente bloqueadas.',
      detail: message,
      actor: 'STUDENT',
      actionHint: 'Aguarde o horário informado antes de tentar novamente.',
    };
  }
  if (normalized.includes('desativ') || normalized.includes('disabled')) {
    return {
      kind: 'ACCESS_BLOCKED',
      title: 'Seu acesso precisa ser liberado pela escola.',
      detail: message,
      actor: 'STUDENT',
      actionHint: 'Entre em contato com a escola para recuperar o acesso.',
    };
  }
  return {
    kind: 'STALE_REFERENCE',
    title: 'Este QR não está mais disponível.',
    detail: 'Ele pode ter sido substituído ou desativado.',
    actor: 'STUDENT',
    actionHint: 'Se você já criou sua senha, entre com seu ID Centro. Caso contrário, peça o QR atual à escola.',
  };
}
