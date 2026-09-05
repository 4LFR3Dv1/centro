import type pg from 'pg';
import type { EnrollmentProcessView, PersistentMilestoneCode, ProcessMilestoneCode } from '../process/resolver.js';
import { resolveStudentProcesses } from '../process/resolver.js';
import { getOpenTheoryExamAttempt } from '../theory-exams/admin.js';

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

function processHref(studentId: string): string {
  return `/admin/alunos/${studentId}#processo`;
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
    const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Abrir processo', href: processHref(studentId) };
    return { ...common, code: 'ENROLLMENT_PAUSED', title: 'Matrícula pausada', detail: 'O processo não pode avançar enquanto a matrícula estiver pausada.', severity: 'BLOCKING', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
  }

  if (!process.modeled) {
    return { ...common, code: 'UNMODELED_SERVICE', title: 'Serviço ainda não modelado', detail: 'Este tipo de matrícula ainda não possui orientação processual institucional admitida.', severity: 'WAITING', primaryCommand: null, secondaryCommands: [], actionLabel: null, href: null };
  }

  if (process.currentState.code === 'COMPLETE') {
    const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Ver processo', href: processHref(studentId) };
    return { ...common, code: 'PROCESS_COMPLETE', title: 'Processo concluído', detail: 'Nenhuma ação operacional está pendente nesta matrícula.', severity: 'COMPLETE', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
  }

  switch (process.currentState.code as ProcessMilestoneCode) {
    case 'REGISTRATION_DONE': {
      const primaryCommand = milestoneCommand('REGISTRATION_DONE', 'Registrar conclusão', 'Concluir cadastro e biometria', 'Confirme somente quando houver evidência institucional suficiente de que RENACH/cadastro e biometria foram resolvidos.');
      return { ...common, code: 'REGISTER_REGISTRATION_DONE', title: 'Concluir cadastro e biometria', detail: 'A escola precisa registrar a conclusão institucional desta etapa quando houver evidência suficiente.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
    case 'HEALTH_DONE': {
      const primaryCommand = milestoneCommand('HEALTH_DONE', 'Registrar conclusão', 'Concluir avaliações de saúde', 'Confirme somente quando as avaliações psicológica e de aptidão física/mental aplicáveis estiverem concluídas.');
      return { ...common, code: 'REGISTER_HEALTH_DONE', title: 'Concluir avaliações de saúde', detail: 'A próxima ação da escola é admitir a conclusão das avaliações aplicáveis quando o resultado estiver disponível.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
    case 'THEORY_PASSED': {
      const attempt = await getOpenTheoryExamAttempt(pool, process.enrollment.id);
      if (!attempt) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'SCHEDULE_THEORY_EXAM', label: 'Agendar prova' };
        return { ...common, code: 'SCHEDULE_THEORY_EXAM', title: 'Agendar prova teórica', detail: 'Nenhuma tentativa de prova teórica está aberta para esta matrícula.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      const primaryCommand: SchoolOperationalCommand = {
        kind: 'MANAGE_THEORY_EXAM',
        label: attempt.attendanceStatus === 'PENDING' ? 'Gerenciar prova' : attempt.observedResult === 'PENDING' ? 'Registrar resultado' : 'Reconciliar resultado',
        attemptId: attempt.id,
        scheduledFor: attempt.scheduledFor,
        attendanceStatus: attempt.attendanceStatus === 'ABSENT' ? 'PENDING' : attempt.attendanceStatus,
        observedResult: attempt.observedResult,
        officialResult: attempt.officialResult,
      };
      if (attempt.attendanceStatus === 'PENDING') {
        return { ...common, code: 'THEORY_EXAM_SCHEDULED', title: 'Prova teórica agendada', detail: `Tentativa registrada para ${attempt.scheduledFor.toISOString()}. A escola ainda precisa registrar presença ou ausência.`, severity: 'SCHEDULED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      if (attempt.observedResult === 'PENDING') {
        return { ...common, code: 'THEORY_EXAM_RESULT_REQUIRED', title: 'Registrar resultado observado da prova teórica', detail: 'A presença já foi registrada. Falta registrar o resultado observado pela escola.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      return { ...common, code: 'THEORY_EXAM_RECONCILIATION_REQUIRED', title: 'Reconciliar resultado oficial da prova teórica', detail: `Resultado observado: ${attempt.observedResult}. O processo só avança depois da reconciliação oficial.`, severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
    case 'PRACTICE_DONE': {
      const completePractice = milestoneCommand('PRACTICE_DONE', 'Registrar prática concluída', 'Concluir preparação prática', `O Centro registrou ${process.progress.completedLessons} aula(s) e ${process.progress.completedMinutes} minuto(s). A conclusão não é inferida automaticamente; confirme somente com evidência institucional suficiente.`);
      if (process.progress.nextLessonAt) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Abrir agenda', href: '/admin/agenda' };
        return { ...common, code: 'LESSON_ALREADY_SCHEDULED', title: 'Próxima aula prática já agendada', detail: `Existe aula futura em ${process.progress.nextLessonAt.toISOString()}.`, severity: 'SCHEDULED', primaryCommand, secondaryCommands: [completePractice], ...compat(primaryCommand) };
      }
      const primaryCommand: SchoolOperationalCommand = { kind: 'SCHEDULE_LESSON', label: 'Agendar aula' };
      return { ...common, code: process.progress.completedLessons > 0 ? 'SCHEDULE_NEXT_LESSON' : 'SCHEDULE_FIRST_LESSON', title: process.progress.completedLessons > 0 ? 'Agendar próxima aula prática' : 'Agendar primeira aula prática', detail: process.progress.completedLessons > 0 ? `${process.progress.completedLessons} aula(s) concluída(s), ${process.progress.completedMinutes} minuto(s) registrados e nenhuma aula futura.` : 'A preparação prática está aberta e nenhuma aula futura está registrada.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [completePractice], ...compat(primaryCommand) };
    }
    case 'PRACTICAL_EXAM_PASSED': {
      const candidate = await loadOpenPracticalCandidate(pool, process.enrollment.id);
      if (!candidate) {
        const primaryCommand: SchoolOperationalCommand = { kind: 'ADD_TO_PRACTICAL_EXAM', label: 'Encaminhar para exame' };
        return { ...common, code: 'SCHEDULE_PRACTICAL_EXAM', title: 'Encaminhar para exame prático', detail: 'A preparação prática está concluída e não existe candidato aberto em uma lista de exame.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      if (candidate.attendance_status === 'ABSENT') {
        const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Abrir lista de exame', href: '/admin/exames' };
        return { ...common, code: 'PRACTICAL_EXAM_ABSENCE_RECORDED', title: 'Ausência registrada no exame prático', detail: 'A ausência já está preservada na lista atual. Encerre ou resolva essa lista antes de encaminhar o aluno para uma nova tentativa.', severity: 'WAITING', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      const primaryCommand: SchoolOperationalCommand = { kind: 'MANAGE_PRACTICAL_EXAM', label: candidate.attendance_status === 'PENDING' ? 'Gerenciar exame' : candidate.observed_result === 'PENDING' ? 'Registrar resultado' : 'Reconciliar resultado', sessionId: candidate.session_id, candidateId: candidate.id, officialScheduledFor: candidate.official_scheduled_for, attendanceStatus: candidate.attendance_status, observedResult: candidate.observed_result, officialResult: candidate.official_result };
      if (candidate.attendance_status === 'PENDING') {
        return { ...common, code: 'PRACTICAL_EXAM_SCHEDULED', title: 'Exame prático já agendado', detail: `Horário oficial: ${candidate.official_scheduled_for.toISOString()}. A escola ainda precisa registrar presença ou ausência.`, severity: 'SCHEDULED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      if (candidate.observed_result === 'PENDING') {
        return { ...common, code: 'PRACTICAL_EXAM_RESULT_REQUIRED', title: 'Registrar resultado observado do exame prático', detail: 'A presença já foi registrada. Falta registrar o resultado observado pela escola.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
      }
      return { ...common, code: 'PRACTICAL_EXAM_RECONCILIATION_REQUIRED', title: 'Reconciliar resultado oficial do exame prático', detail: `Resultado observado: ${candidate.observed_result}. O processo só avança depois da reconciliação oficial.`, severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
    case 'LICENSE_AVAILABLE': {
      const primaryCommand = milestoneCommand('LICENSE_AVAILABLE', 'Registrar disponibilidade', 'Confirmar CNH disponível', 'Confirme somente quando houver evidência de que a habilitação foi emitida/disponibilizada ao aluno.');
      return { ...common, code: 'CONFIRM_LICENSE_AVAILABLE', title: 'Confirmar disponibilidade da CNH', detail: 'O exame prático foi aprovado. O processo conclui quando a disponibilização da habilitação for confirmada.', severity: 'ACTION_REQUIRED', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
    case 'PROCESS_STARTED': {
      const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Abrir processo', href: processHref(studentId) };
      return { ...common, code: 'PROCESS_START_PENDING', title: 'Confirmar início operacional', detail: 'A matrícula ainda não produziu uma próxima etapa institucional operável.', severity: 'BLOCKING', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
    }
  }

  const primaryCommand: SchoolOperationalCommand = { kind: 'OPEN_URL', label: 'Abrir processo', href: processHref(studentId) };
  return { ...common, code: 'PROCESS_STATE_UNAVAILABLE', title: 'Estado processual sem projeção operacional', detail: 'O Process Kernel derivou um estado que ainda não possui orientação específica para a escola.', severity: 'WAITING', primaryCommand, secondaryCommands: [], ...compat(primaryCommand) };
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
