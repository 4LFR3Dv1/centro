import type pg from 'pg';
import type { EnrollmentProcessView, PersistentMilestoneCode, ProcessMilestoneCode } from '../process/resolver.js';
import { resolveStudentProcesses } from '../process/resolver.js';
import { getOpenTheoryExamAttempt, listTheoryExamAttempts } from '../theory-exams/admin.js';

export type SchoolOperationalSeverity = 'BLOCKING' | 'ACTION_REQUIRED' | 'SCHEDULED' | 'WAITING' | 'COMPLETE';

export type SchoolOperationalCommand =
  | {
      kind: 'ACHIEVE_MILESTONE';
      label: string;
      milestoneCode: PersistentMilestoneCode;
      confirmationTitle: string;
      confirmationDetail: string;
    }
  | { kind: 'SCHEDULE_THEORY_EXAM'; label: string }
  | {
      kind: 'MANAGE_THEORY_EXAM';
      label: string;
      attemptId: string;
      scheduledFor: Date;
      attendanceStatus: 'PENDING' | 'PRESENT';
      observedResult: 'PENDING' | 'APPROVED' | 'FAILED';
      officialResult: 'PENDING' | 'APPROVED' | 'FAILED';
    }
  | { kind: 'SCHEDULE_LESSON'; label: string }
  | { kind: 'ADD_TO_PRACTICAL_EXAM'; label: string }
  | {
      kind: 'MANAGE_PRACTICAL_EXAM';
      label: string;
      sessionId: string;
      candidateId: string;
      officialScheduledFor: Date;
      attendanceStatus: 'PENDING' | 'PRESENT' | 'ABSENT';
      observedResult: 'PENDING' | 'APPROVED' | 'FAILED';
      officialResult: 'PENDING' | 'APPROVED' | 'FAILED';
    }
  | { kind: 'OPEN_URL'; label: string; href: string };

export type SchoolOperationalAction = {
  enrollmentId: string;
  serviceType: EnrollmentProcessView['enrollment']['serviceType'];
  category: EnrollmentProcessView['enrollment']['category'];
  processStateCode: EnrollmentProcessView['currentState']['code'];
  code: string;
  title: string;
  detail: string;
  severity: SchoolOperationalSeverity;
  primaryCommand: SchoolOperationalCommand | null;
  secondaryCommands: SchoolOperationalCommand[];
  actionLabel: string | null;
  href: string | null;
};

export type StudentOperationalContext = {
  studentId: string;
  primaryAction: SchoolOperationalAction | null;
  actions: SchoolOperationalAction[];
};

const severityRank: Record<SchoolOperationalSeverity, number> = {
  BLOCKING: 0,
  ACTION_REQUIRED: 1,
  SCHEDULED: 2,
  WAITING: 3,
  COMPLETE: 4,
};

const resultLabels = {
  APPROVED: 'aprovado',
  FAILED: 'reprovado',
  PENDING: 'pendente',
} as const;

function processHref(studentId: string): string {
  return `/admin/alunos/${studentId}#processo`;
}

function operationalDate(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function compat(command: SchoolOperationalCommand | null): Pick<SchoolOperationalAction, 'actionLabel' | 'href'> {
  if (!command) return { actionLabel: null, href: null };
  if (command.kind === 'OPEN_URL') return { actionLabel: command.label, href: command.href };
  return { actionLabel: command.label, href: null };
}

async function loadOpenPracticalCandidate(pool: pg.Pool, enrollmentId: string) {
  const result = await pool.query<{
    id: string;
    session_id: string;
    official_scheduled_for: Date;
    attendance_status: 'PENDING' | 'PRESENT' | 'ABSENT';
    observed_result: 'PENDING' | 'APPROVED' | 'FAILED';
    official_result: 'PENDING' | 'APPROVED' | 'FAILED';
  }>(
    `SELECT c.id, c.session_id, c.official_scheduled_for, c.attendance_status, c.observed_result, c.official_result
     FROM practical_exam_candidates c
     JOIN practical_exam_sessions s ON s.id = c.session_id
     WHERE c.enrollment_id = $1
       AND c.official_result = 'PENDING'
       AND s.status IN ('PLANNED', 'CONFIRMED')
     ORDER BY c.official_scheduled_for ASC
     LIMIT 1`,
    [enrollmentId],
  );
  return result.rows[0] ?? null;
}

async function loadLatestPracticalCandidate(pool: pg.Pool, enrollmentId: string) {
  const result = await pool.query<{
    official_scheduled_for: Date;
    attendance_status: 'PENDING' | 'PRESENT' | 'ABSENT';
    observed_result: 'PENDING' | 'APPROVED' | 'FAILED';
    official_result: 'PENDING' | 'APPROVED' | 'FAILED';
  }>(
    `SELECT official_scheduled_for, attendance_status, observed_result, official_result
     FROM practical_exam_candidates
     WHERE enrollment_id = $1
     ORDER BY official_scheduled_for DESC, created_at DESC
     LIMIT 1`,
    [enrollmentId],
  );
  return result.rows[0] ?? null;
}

async function loadLatestLesson(pool: pg.Pool, enrollmentId: string) {
  const result = await pool.query<{
    status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
    starts_at: Date;
    resolved_at: Date | null;
  }>(
    `SELECT status, starts_at, resolved_at
     FROM lessons
     WHERE enrollment_id = $1
     ORDER BY starts_at DESC
     LIMIT 1`,
    [enrollmentId],
  );
  return result.rows[0] ?? null;
}

function milestoneCommand(
  milestoneCode: PersistentMilestoneCode,
  label: string,
  confirmationTitle: string,
  confirmationDetail: string,
): SchoolOperationalCommand {
  return { kind: 'ACHIEVE_MILESTONE', milestoneCode, label, confirmationTitle, confirmationDetail };
}

async function actionForProcess(pool: pg.Pool, studentId: string, process: EnrollmentProcessView): Promise<SchoolOperationalAction> {
  const common = {
    enrollmentId: process.enrollment.id,
    serviceType: process.enrollment.serviceType,
    category: process.enrollment.category,
    processStateCode: process.currentState.code,
  };

  if (process.enrollment.status === 'PAUSED') {
    const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Revisar matrícula', href: processHref(studentId) };
    return {
      ...common,
      code: 'ENROLLMENT_PAUSED',
      title: 'Matrícula pausada',
      detail: 'Nenhuma etapa pode avançar enquanto a matrícula estiver pausada. A escola precisa revisar a matrícula e reativá-la pelo procedimento autorizado antes de continuar.',
      severity: 'BLOCKING',
      primaryCommand,
      secondaryCommands: [],
      ...compat(primaryCommand),
    };
  }

  if (!process.modeled) {
    return {
      ...common,
      code: 'UNMODELED_SERVICE',
      title: 'Acompanhamento ainda não disponível',
      detail: 'O Centro ainda não orienta automaticamente este tipo de matrícula. Nenhuma ação será feita por conta própria.',
      severity: 'WAITING',
      primaryCommand: null,
      secondaryCommands: [],
      actionLabel: null,
      href: null,
    };
  }

  if (process.currentState.code === 'COMPLETE') {
    const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Ver histórico', href: processHref(studentId) };
    return {
      ...common,
      code: 'PROCESS_COMPLETE',
      title: 'Matrícula sem pendências',
      detail: 'Todas as etapas acompanhadas pelo Centro estão concluídas. Nenhuma ação é necessária agora.',
      severity: 'COMPLETE',
      primaryCommand,
      secondaryCommands: [],
      ...compat(primaryCommand),
    };
  }

  switch (process.currentState.code as ProcessMilestoneCode) {
    case 'REGISTRATION_DONE': {
      const primaryCommand = milestoneCommand(
        'REGISTRATION_DONE',
        'Registrar conclusão',
        'Concluir cadastro e biometria',
        'Confirme apenas quando RENACH, cadastro e biometria estiverem concluídos e você conseguir comprovar essa informação.',
      );
      return {
        ...common,
        code: 'REGISTER_REGISTRATION_DONE',
        title: 'Confirmar cadastro e biometria',
        detail: 'Quando cadastro, RENACH e biometria estiverem resolvidos, registre a conclusão para liberar a próxima etapa.',
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
    case 'HEALTH_DONE': {
      const primaryCommand = milestoneCommand(
        'HEALTH_DONE',
        'Registrar conclusão',
        'Concluir avaliações de saúde',
        'Confirme apenas quando as avaliações psicológica e de aptidão física e mental aplicáveis estiverem concluídas.',
      );
      return {
        ...common,
        code: 'REGISTER_HEALTH_DONE',
        title: 'Confirmar avaliações de saúde',
        detail: 'Quando as avaliações aplicáveis estiverem concluídas, registre essa informação para liberar a próxima etapa.',
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
    case 'THEORY_PASSED': {
      const attempt = await getOpenTheoryExamAttempt(pool, process.enrollment.id);
      if (!attempt) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'SCHEDULE_THEORY_EXAM', label: 'Agendar nova prova' };
        const latestAttempt = (await listTheoryExamAttempts(pool, process.enrollment.id))[0] ?? null;
        if (latestAttempt?.attendanceStatus === 'ABSENT') {
          return {
            ...common,
            code: 'THEORY_EXAM_ABSENCE_RECOVERY',
            title: 'A última prova teórica terminou como ausência',
            detail: 'A tentativa anterior foi encerrada porque o aluno não compareceu. Ela não conta como aprovação e uma nova prova precisa ser marcada para continuar.',
            severity: 'ACTION_REQUIRED',
            primaryCommand,
            secondaryCommands: [],
            ...compat(primaryCommand),
          };
        }
        if (latestAttempt?.officialResult === 'FAILED') {
          return {
            ...common,
            code: 'THEORY_EXAM_FAILED_RECOVERY',
            title: 'A última prova teórica terminou como reprovada',
            detail: 'O resultado oficial da tentativa anterior foi reprovação. Quando houver uma nova data, marque outra tentativa para o aluno continuar.',
            severity: 'ACTION_REQUIRED',
            primaryCommand,
            secondaryCommands: [],
            ...compat(primaryCommand),
          };
        }
        primaryCommand.label = 'Agendar prova';
        return {
          ...common,
          code: 'SCHEDULE_THEORY_EXAM',
          title: 'Aluno pronto para a prova teórica',
          detail: 'Ainda não há uma prova teórica marcada para esta matrícula.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      const primaryCommand: SchoolOperationalCommand = {
        kind: 'MANAGE_THEORY_EXAM',
        label: attempt.attendanceStatus === 'PENDING'
          ? 'Registrar presença'
          : attempt.observedResult === 'PENDING'
            ? 'Registrar resultado'
            : 'Confirmar resultado oficial',
        attemptId: attempt.id,
        scheduledFor: attempt.scheduledFor,
        attendanceStatus: attempt.attendanceStatus === 'ABSENT' ? 'PENDING' : attempt.attendanceStatus,
        observedResult: attempt.observedResult,
        officialResult: attempt.officialResult,
      };
      if (attempt.attendanceStatus === 'PENDING') {
        return {
          ...common,
          code: 'THEORY_EXAM_SCHEDULED',
          title: 'Prova teórica marcada',
          detail: `Prova marcada para ${operationalDate(attempt.scheduledFor)}. Depois da prova, registre presença ou ausência.`,
          severity: 'SCHEDULED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      if (attempt.observedResult === 'PENDING') {
        return {
          ...common,
          code: 'THEORY_EXAM_RESULT_REQUIRED',
          title: 'Falta registrar o resultado da prova teórica',
          detail: 'A presença já foi registrada. Informe o resultado recebido pela escola.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      return {
        ...common,
        code: 'THEORY_EXAM_RECONCILIATION_REQUIRED',
        title: 'Falta confirmar o resultado oficial da prova teórica',
        detail: `A escola registrou o aluno como ${resultLabels[attempt.observedResult]}. Agora falta confirmar o resultado oficial.`,
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
    case 'PRACTICE_DONE': {
      const completePractice = milestoneCommand(
        'PRACTICE_DONE',
        'Concluir aulas práticas',
        'Concluir aulas práticas',
        `O Centro registra ${process.progress.completedLessons} aula(s) concluída(s), somando ${process.progress.completedMinutes} minuto(s). Confirme apenas quando a preparação prática realmente estiver concluída.`,
      );
      if (process.progress.nextLessonAt) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Ver agenda', href: '/admin/agenda' };
        return {
          ...common,
          code: 'LESSON_ALREADY_SCHEDULED',
          title: 'Aula prática já agendada',
          detail: `Próxima aula em ${operationalDate(process.progress.nextLessonAt)}. Nenhuma ação de agendamento é necessária agora.`,
          severity: 'SCHEDULED',
          primaryCommand,
          secondaryCommands: [completePractice],
          ...compat(primaryCommand),
        };
      }

      const latestLesson = await loadLatestLesson(pool, process.enrollment.id);
      const primaryCommand: SchoolOperationalCommand = { kind: 'SCHEDULE_LESSON', label: 'Agendar nova aula' };
      if (latestLesson?.status === 'NO_SHOW') {
        return {
          ...common,
          code: 'LESSON_NO_SHOW_RECOVERY',
          title: 'A última aula terminou como falta',
          detail: 'Essa aula não conta como concluída e não há outra aula futura marcada. O aluno precisa de um novo horário para continuar.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [completePractice],
          ...compat(primaryCommand),
        };
      }
      if (latestLesson?.status === 'CANCELLED') {
        return {
          ...common,
          code: 'LESSON_CANCELLED_RECOVERY',
          title: 'A última aula foi cancelada',
          detail: 'O horário cancelado não está mais comprometido e não há outra aula futura marcada. Agende um novo horário se o aluno ainda precisa continuar a prática.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [completePractice],
          ...compat(primaryCommand),
        };
      }

      primaryCommand.label = 'Agendar aula';
      return {
        ...common,
        code: process.progress.completedLessons > 0 ? 'SCHEDULE_NEXT_LESSON' : 'SCHEDULE_FIRST_LESSON',
        title: process.progress.completedLessons > 0 ? 'Agendar próxima aula prática' : 'Agendar primeira aula prática',
        detail: process.progress.completedLessons > 0
          ? `${process.progress.completedLessons} aula(s) concluída(s). Não há nenhuma aula futura marcada.`
          : 'O aluno já pode iniciar as aulas práticas e ainda não há aula futura marcada.',
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [completePractice],
        ...compat(primaryCommand),
      };
    }
    case 'PRACTICAL_EXAM_PASSED': {
      const candidate = await loadOpenPracticalCandidate(pool, process.enrollment.id);
      if (!candidate) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'ADD_TO_PRACTICAL_EXAM', label: 'Marcar novo exame prático' };
        const latestCandidate = await loadLatestPracticalCandidate(pool, process.enrollment.id);
        if (latestCandidate?.attendance_status === 'ABSENT') {
          return {
            ...common,
            code: 'PRACTICAL_EXAM_ABSENCE_RECOVERY',
            title: 'A última tentativa prática terminou como ausência',
            detail: 'O aluno não compareceu à tentativa anterior. Quando houver uma nova data compatível, marque outra tentativa para continuar.',
            severity: 'ACTION_REQUIRED',
            primaryCommand,
            secondaryCommands: [],
            ...compat(primaryCommand),
          };
        }
        if (latestCandidate?.official_result === 'FAILED') {
          return {
            ...common,
            code: 'PRACTICAL_EXAM_FAILED_RECOVERY',
            title: 'O último exame prático terminou como reprovado',
            detail: 'O resultado oficial da tentativa anterior foi reprovação. Quando houver uma nova lista compatível, marque outra tentativa.',
            severity: 'ACTION_REQUIRED',
            primaryCommand,
            secondaryCommands: [],
            ...compat(primaryCommand),
          };
        }
        primaryCommand.label = 'Marcar exame prático';
        return {
          ...common,
          code: 'SCHEDULE_PRACTICAL_EXAM',
          title: 'Aluno pronto para o exame prático',
          detail: 'As aulas práticas estão concluídas e ainda não há exame prático marcado.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      if (candidate.attendance_status === 'ABSENT') {
        const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Ver lista de exame', href: '/admin/exames' };
        return {
          ...common,
          code: 'PRACTICAL_EXAM_ABSENCE_RECORDED',
          title: 'Ausência registrada no exame prático',
          detail: 'A tentativa atual está encerrada como ausência. Finalize a lista de exame; depois disso, uma nova tentativa poderá ser marcada.',
          severity: 'WAITING',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      const primaryCommand: SchoolOperationalCommand = {
        kind: 'MANAGE_PRACTICAL_EXAM',
        label: candidate.attendance_status === 'PENDING'
          ? 'Registrar presença'
          : candidate.observed_result === 'PENDING'
            ? 'Registrar resultado'
            : 'Confirmar resultado oficial',
        sessionId: candidate.session_id,
        candidateId: candidate.id,
        officialScheduledFor: candidate.official_scheduled_for,
        attendanceStatus: candidate.attendance_status,
        observedResult: candidate.observed_result,
        officialResult: candidate.official_result,
      };
      if (candidate.attendance_status === 'PENDING') {
        return {
          ...common,
          code: 'PRACTICAL_EXAM_SCHEDULED',
          title: 'Exame prático marcado',
          detail: `Exame marcado para ${operationalDate(candidate.official_scheduled_for)}. Depois do exame, registre presença ou ausência.`,
          severity: 'SCHEDULED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      if (candidate.observed_result === 'PENDING') {
        return {
          ...common,
          code: 'PRACTICAL_EXAM_RESULT_REQUIRED',
          title: 'Falta registrar o resultado do exame prático',
          detail: 'A presença já foi registrada. Informe o resultado recebido pela escola.',
          severity: 'ACTION_REQUIRED',
          primaryCommand,
          secondaryCommands: [],
          ...compat(primaryCommand),
        };
      }
      return {
        ...common,
        code: 'PRACTICAL_EXAM_RECONCILIATION_REQUIRED',
        title: 'Falta confirmar o resultado oficial do exame prático',
        detail: `A escola registrou o aluno como ${resultLabels[candidate.observed_result]}. Agora falta confirmar o resultado oficial.`,
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
    case 'LICENSE_AVAILABLE': {
      const primaryCommand = milestoneCommand(
        'LICENSE_AVAILABLE',
        'Confirmar CNH disponível',
        'Confirmar CNH disponível',
        'Confirme apenas quando a habilitação tiver sido emitida ou disponibilizada ao aluno.',
      );
      return {
        ...common,
        code: 'CONFIRM_LICENSE_AVAILABLE',
        title: 'Confirmar que a CNH está disponível',
        detail: 'O aluno foi aprovado no exame prático. Confirme quando a habilitação estiver disponível para concluir o acompanhamento.',
        severity: 'ACTION_REQUIRED',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
    case 'PROCESS_STARTED': {
      const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Revisar matrícula', href: processHref(studentId) };
      return {
        ...common,
        code: 'PROCESS_START_PENDING',
        title: 'Falta informação para indicar o próximo passo',
        detail: 'Revise os dados da matrícula para confirmar em que ponto o aluno está.',
        severity: 'BLOCKING',
        primaryCommand,
        secondaryCommands: [],
        ...compat(primaryCommand),
      };
    }
  }

  const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Revisar situação', href: processHref(studentId) };
  return {
    ...common,
    code: 'PROCESS_STATE_UNAVAILABLE',
    title: 'Próximo passo indisponível',
    detail: 'O Centro ainda não consegue indicar uma ação para esta situação. Revise os dados do aluno antes de continuar.',
    severity: 'WAITING',
    primaryCommand,
    secondaryCommands: [],
    ...compat(primaryCommand),
  };
}

export async function resolveStudentOperationalContext(pool: pg.Pool, studentId: string): Promise<StudentOperationalContext> {
  const processes = await resolveStudentProcesses(pool, studentId);
  const actions = await Promise.all(processes.map((process) => actionForProcess(pool, studentId, process)));
  actions.sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity];
    if (severity !== 0) return severity;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
  return { studentId, primaryAction: actions[0] ?? null, actions };
}
