import './student-guide.css';

export type StudentGuideLesson = {
  id: string;
  category: 'A' | 'B' | 'D';
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  instructorName: string;
  vehicleLabel: string;
  notes: string | null;
};

export type StudentGuideSnapshot = {
  schema: 'CENTRO_STUDENT_GUIDE_SNAPSHOT_V1';
  student: {
    id: string;
    publicId: string;
    fullName: string;
  };
  enrollment: {
    id: string;
    serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
    category: 'A' | 'B' | 'AB' | 'D';
    status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
    openedAt: string;
  };
  process: {
    modeled: boolean;
    modelId: 'FIRST_LICENSE_V1' | null;
    currentState: {
      code: string;
      label: string;
      index: number;
      total: number;
      percent: number;
    };
    milestones: Array<{
      code: string;
      label: string;
      description: string;
      achieved: boolean;
      achievedAt: string | null;
      scheduledFor: string | null;
    }>;
    progress: {
      completedLessons: number;
      completedMinutes: number;
      noShows: number;
      scheduledLessons: number;
      nextLessonAt: string | null;
    };
    nextAction: {
      code: string;
      title: string;
      detail: string;
      milestoneCode: string | null;
    } | null;
  };
  agenda: {
    upcoming: StudentGuideLesson[];
    recent: StudentGuideLesson[];
  };
};

export type StudentGuidePayload = {
  id: string;
  studentId: string;
  enrollmentId: string;
  template: {
    id: string;
    version: number;
  };
  contentSha256: string;
  generatedAt: string;
  snapshot: StudentGuideSnapshot;
};

const serviceLabels: Record<StudentGuideSnapshot['enrollment']['serviceType'], string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

const lessonStatusLabels: Record<StudentGuideLesson['status'], string> = {
  SCHEDULED: 'Agendada',
  COMPLETED: 'Concluída',
  NO_SHOW: 'Falta',
  CANCELLED: 'Cancelada',
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function dateOnly(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(value));
}

export function printStudentGuide(): void {
  document.body.classList.add('student-guide-printing');
  const cleanup = () => document.body.classList.remove('student-guide-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1500);
}

function AgendaRows({ lessons, empty }: { lessons: StudentGuideLesson[]; empty: string }) {
  if (lessons.length === 0) return <p className="student-guide-empty">{empty}</p>;
  return (
    <div className="student-guide-lessons">
      {lessons.map((lesson) => (
        <article key={lesson.id}>
          <div className="student-guide-lesson-time">
            <strong>{dateTime(lesson.startsAt)}</strong>
            <span>{lessonStatusLabels[lesson.status]} · Categoria {lesson.category}</span>
          </div>
          <div>
            <strong>{lesson.instructorName}</strong>
            <span>{lesson.vehicleLabel}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function StudentGuideDocument({
  snapshot,
  templateId,
  templateVersion,
  generatedAt,
  contentSha256,
  preview = false,
}: {
  snapshot: StudentGuideSnapshot;
  templateId: string;
  templateVersion: number;
  generatedAt?: string | null;
  contentSha256?: string | null;
  preview?: boolean;
}) {
  const { student, enrollment, process, agenda } = snapshot;

  return (
    <article className="student-guide-document" aria-label={`Guia de ${student.fullName}`}>
      <header className="student-guide-cover">
        <div className="student-guide-brand">
          <strong>CENTRO</strong>
          <span>Auto Escola Centro</span>
        </div>
        <div className={`student-guide-badge ${preview ? 'is-preview' : ''}`}>
          {preview ? 'PRÉVIA' : 'GUIA DO ALUNO'}
        </div>
        <p>Suas etapas, sua agenda e o que acontece em seguida.</p>
        <h1>{student.fullName}</h1>
        <div className="student-guide-cover-facts">
          <div><span>ID DO ALUNO</span><strong>{student.publicId}</strong></div>
          <div><span>SERVIÇO</span><strong>{serviceLabels[enrollment.serviceType]}</strong></div>
          <div><span>CATEGORIA</span><strong>{enrollment.category}</strong></div>
          <div><span>MATRÍCULA DESDE</span><strong>{dateOnly(enrollment.openedAt)}</strong></div>
        </div>
      </header>

      <section className="student-guide-section">
        <div className="student-guide-section-head">
          <span>01</span>
          <div><small>MINHAS ETAPAS</small><h2>{process.currentState.label}</h2></div>
          {process.modeled && <strong>{process.currentState.percent}%</strong>}
        </div>

        {process.modeled ? (
          <>
            <div className="student-guide-progress"><span style={{ width: `${process.currentState.percent}%` }} /></div>
            <ol className="student-guide-milestones">
              {process.milestones.map((milestone) => (
                <li key={milestone.code} className={milestone.achieved ? 'is-done' : process.currentState.code === milestone.code ? 'is-current' : ''}>
                  <span>{milestone.achieved ? '✓' : '•'}</span>
                  <div>
                    <strong>{milestone.label}</strong>
                    <small>
                      {milestone.achievedAt
                        ? `Concluído em ${dateOnly(milestone.achievedAt)}`
                        : milestone.scheduledFor
                          ? `Marcado para ${dateTime(milestone.scheduledFor)}`
                          : process.currentState.code === milestone.code
                            ? 'Etapa atual'
                            : 'Etapa futura'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="student-guide-empty">Este tipo de matrícula ainda não tem acompanhamento passo a passo disponível no Centro.</p>
        )}
      </section>

      <section className="student-guide-section student-guide-next">
        <div className="student-guide-section-head">
          <span>02</span>
          <div><small>AGORA</small><h2>{process.nextAction?.title ?? 'Nenhuma ação pendente'}</h2></div>
        </div>
        <p>{process.nextAction?.detail ?? 'Você não precisa fazer nada agora.'}</p>
        {process.currentState.code === 'PRACTICE_DONE' && (
          <div className="student-guide-practice">
            <div><span>Aulas concluídas</span><strong>{process.progress.completedLessons}</strong></div>
            <div><span>Tempo registrado</span><strong>{process.progress.completedMinutes} min</strong></div>
            <div><span>Faltas</span><strong>{process.progress.noShows}</strong></div>
          </div>
        )}
      </section>

      <section className="student-guide-section">
        <div className="student-guide-section-head">
          <span>03</span>
          <div><small>AGENDA</small><h2>Próximas aulas</h2></div>
          <strong>{agenda.upcoming.length}</strong>
        </div>
        <AgendaRows lessons={agenda.upcoming} empty="Nenhuma aula futura estava marcada quando este guia foi preparado." />
      </section>

      {agenda.recent.length > 0 && (
        <section className="student-guide-section student-guide-recent">
          <div className="student-guide-section-head">
            <span>04</span>
            <div><small>HISTÓRICO</small><h2>Aulas recentes</h2></div>
          </div>
          <AgendaRows lessons={agenda.recent} empty="Nenhuma aula recente." />
        </section>
      )}

      <footer className="student-guide-footer">
        <div>
          <strong>{generatedAt ? `Guia preparado em ${dateTime(generatedAt)}` : 'Prévia do guia'}</strong>
          <span>Se alguma informação mudar, consulte sua área do aluno para ver o estado mais recente.</span>
        </div>
        <details>
          <summary>Informações do documento</summary>
          <small>{templateId}@{templateVersion}</small>
          {contentSha256 && <code>{contentSha256}</code>}
        </details>
        <p>Este guia registra as informações disponíveis no momento em que foi preparado. Mudanças posteriores aparecem em uma nova versão e na sua área do aluno.</p>
      </footer>
    </article>
  );
}
