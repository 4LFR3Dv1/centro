import type pg from 'pg';
import type { EnrollmentProcessView, ProcessMilestoneCode } from '../process/resolver.js';
import { resolveStudentProcesses } from '../process/resolver.js';

export type SchoolOperationalSeverity = 'BLOCKING' | 'ACTION_REQUIRED' | 'SCHEDULED' | 'WAITING' | 'COMPLETE';

export type SchoolOperationalAction = {
  enrollmentId: string;
  serviceType: EnrollmentProcessView['enrollment']['serviceType'];
  category: EnrollmentProcessView['enrollment']['category'];
  processStateCode: EnrollmentProcessView['currentState']['code'];
  code: string;
  title: string;
  detail: string;
  severity: SchoolOperationalSeverity;
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

function scheduleLessonHref(enrollmentId: string): string {
  return `/admin/agenda?new=1&enrollmentId=${encodeURIComponent(enrollmentId)}`;
}

function actionForProcess(studentId: string, process: EnrollmentProcessView): SchoolOperationalAction {
  const common = {
    enrollmentId: process.enrollment.id,
    serviceType: process.enrollment.serviceType,
    category: process.enrollment.category,
    processStateCode: process.currentState.code,
  };

  if (process.enrollment.status === 'PAUSED') {
    return {
      ...common,
      code: 'ENROLLMENT_PAUSED',
      title: 'Matrícula pausada',
      detail: 'O processo não pode avançar enquanto a matrícula estiver pausada.',
      severity: 'BLOCKING',
      actionLabel: 'Abrir processo',
      href: processHref(studentId),
    };
  }

  if (!process.modeled) {
    return {
      ...common,
      code: 'UNMODELED_SERVICE',
      title: 'Serviço ainda não modelado',
      detail: 'Este tipo de matrícula ainda não possui orientação processual institucional admitida.',
      severity: 'WAITING',
      actionLabel: null,
      href: null,
    };
  }

  if (process.currentState.code === 'COMPLETE') {
    return {
      ...common,
      code: 'PROCESS_COMPLETE',
      title: 'Processo concluído',
      detail: 'Nenhuma ação operacional está pendente nesta matrícula.',
      severity: 'COMPLETE',
      actionLabel: 'Ver processo',
      href: processHref(studentId),
    };
  }

  switch (process.currentState.code as ProcessMilestoneCode) {
    case 'REGISTRATION_DONE':
      return {
        ...common,
        code: 'REGISTER_REGISTRATION_DONE',
        title: 'Concluir cadastro e biometria',
        detail: 'A escola precisa registrar a conclusão institucional desta etapa quando houver evidência suficiente.',
        severity: 'ACTION_REQUIRED',
        actionLabel: 'Registrar conclusão',
        href: processHref(studentId),
      };
    case 'HEALTH_DONE':
      return {
        ...common,
        code: 'REGISTER_HEALTH_DONE',
        title: 'Concluir avaliações de saúde',
        detail: 'A próxima ação da escola é admitir a conclusão das avaliações aplicáveis quando o resultado estiver disponível.',
        severity: 'ACTION_REQUIRED',
        actionLabel: 'Registrar conclusão',
        href: processHref(studentId),
      };
    case 'THEORY_PASSED': {
      const milestone = process.milestones.find((item) => item.code === 'THEORY_PASSED');
      if (milestone?.scheduledFor) {
        return {
          ...common,
          code: 'THEORY_EXAM_SCHEDULED',
          title: 'Prova teórica já agendada',
          detail: `A escola aguarda o resultado da prova registrada para ${milestone.scheduledFor.toISOString()}.`,
          severity: 'SCHEDULED',
          actionLabel: 'Abrir processo',
          href: processHref(studentId),
        };
      }
      return {
        ...common,
        code: 'SCHEDULE_THEORY_EXAM',
        title: 'Agendar prova teórica',
        detail: 'Nenhuma data de prova teórica está registrada para esta matrícula.',
        severity: 'ACTION_REQUIRED',
        actionLabel: 'Registrar agendamento',
        href: processHref(studentId),
      };
    }
    case 'PRACTICE_DONE':
      if (process.progress.nextLessonAt) {
        return {
          ...common,
          code: 'LESSON_ALREADY_SCHEDULED',
          title: 'Próxima aula prática já agendada',
          detail: `Nenhuma intervenção imediata: existe aula futura em ${process.progress.nextLessonAt.toISOString()}.`,
          severity: 'SCHEDULED',
          actionLabel: 'Abrir agenda',
          href: '/admin/agenda',
        };
      }
      return {
        ...common,
        code: process.progress.completedLessons > 0 ? 'SCHEDULE_NEXT_LESSON' : 'SCHEDULE_FIRST_LESSON',
        title: process.progress.completedLessons > 0 ? 'Agendar próxima aula prática' : 'Agendar primeira aula prática',
        detail: process.progress.completedLessons > 0
          ? `${process.progress.completedLessons} aula(s) concluída(s), ${process.progress.completedMinutes} minuto(s) registrados e nenhuma aula futura.`
          : 'A preparação prática está aberta e nenhuma aula futura está registrada.',
        severity: 'ACTION_REQUIRED',
        actionLabel: 'Agendar aula',
        href: scheduleLessonHref(process.enrollment.id),
      };
    case 'PRACTICAL_EXAM_PASSED': {
      const milestone = process.milestones.find((item) => item.code === 'PRACTICAL_EXAM_PASSED');
      if (milestone?.scheduledFor) {
        return {
          ...common,
          code: 'PRACTICAL_EXAM_SCHEDULED',
          title: 'Exame prático já agendado',
          detail: `A escola aguarda o resultado do exame registrado para ${milestone.scheduledFor.toISOString()}.`,
          severity: 'SCHEDULED',
          actionLabel: 'Abrir exames',
          href: '/admin/exames',
        };
      }
      return {
        ...common,
        code: 'SCHEDULE_PRACTICAL_EXAM',
        title: 'Organizar exame prático',
        detail: 'Nenhuma data de exame prático está registrada para esta matrícula.',
        severity: 'ACTION_REQUIRED',
        actionLabel: 'Abrir exames',
        href: '/admin/exames',
      };
    }
    case 'LICENSE_AVAILABLE':
      return {
        ...common,
        code: 'WAIT_FOR_LICENSE',
        title: 'Acompanhar emissão da CNH',
        detail: 'A escola aguarda a confirmação de disponibilização da habilitação.',
        severity: 'WAITING',
        actionLabel: 'Abrir processo',
        href: processHref(studentId),
      };
    case 'PROCESS_STARTED':
      return {
        ...common,
        code: 'PROCESS_START_PENDING',
        title: 'Confirmar início operacional',
        detail: 'A matrícula ainda não produziu uma próxima etapa institucional operável.',
        severity: 'BLOCKING',
        actionLabel: 'Abrir processo',
        href: processHref(studentId),
      };
  }
}

export async function resolveStudentOperationalContext(
  pool: pg.Pool,
  studentId: string,
): Promise<StudentOperationalContext> {
  const processes = await resolveStudentProcesses(pool, studentId);
  const actions = processes
    .map((process) => actionForProcess(studentId, process))
    .sort((a, b) => {
      const severity = severityRank[a.severity] - severityRank[b.severity];
      if (severity !== 0) return severity;
      return a.title.localeCompare(b.title, 'pt-BR');
    });

  return {
    studentId,
    primaryAction: actions[0] ?? null,
    actions,
  };
}
