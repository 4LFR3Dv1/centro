import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './student-exams.css';

type StudentExam = {
  candidateId: string;
  sessionId: string;
  enrollmentId: string;
  category: 'A' | 'B' | 'D';
  locationLabel: string;
  sessionStartsAt: string;
  sessionEndsAt: string;
  officialScheduledFor: string;
  sessionStatus: 'PLANNED' | 'CONFIRMED' | 'CLOSED' | 'CANCELLED';
  bookingSource: 'SELF' | 'SCHOOL';
  protocol: string | null;
  renach: string | null;
  feeStatus: 'UNKNOWN' | 'PENDING' | 'PAID';
  ladvStatus: 'UNKNOWN' | 'READY';
  attendanceStatus: 'PENDING' | 'PRESENT' | 'ABSENT';
  observedResult: 'PENDING' | 'APPROVED' | 'FAILED';
  officialResult: 'PENDING' | 'APPROVED' | 'FAILED';
  resultReconciledAt: string | null;
  instructorName: string;
  vehicleLabel: string;
  vehiclePlate: string;
};

async function examApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar seu exame.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function resultLabel(value: StudentExam['officialResult']): string {
  if (value === 'APPROVED') return 'Aprovado';
  if (value === 'FAILED') return 'Reprovado';
  return 'Aguardando';
}

function observedLabel(value: StudentExam['observedResult']): string {
  if (value === 'APPROVED') return 'Aprovado informado';
  if (value === 'FAILED') return 'Reprovado informado';
  return 'Sem resultado informado';
}

function ExamCard({ exam, onOpen }: { exam: StudentExam; onOpen: () => void }) {
  const future = new Date(exam.officialScheduledFor).getTime() >= Date.now();
  return (
    <button className="student-exam-card" type="button" onClick={onOpen}>
      <span className="student-exam-date"><strong>{dateTime(exam.officialScheduledFor)}</strong><small>{exam.locationLabel}</small></span>
      <span><strong>Categoria {exam.category}</strong><small>{exam.instructorName} · {exam.vehicleLabel}</small></span>
      <span className={`student-exam-state is-${exam.officialResult.toLowerCase()}`}>{exam.officialResult === 'PENDING' ? (future ? 'AGENDADO' : 'AGUARDANDO RESULTADO') : resultLabel(exam.officialResult).toUpperCase()}</span>
      <span>→</span>
    </button>
  );
}

export function StudentExams() {
  const navigate = useNavigate();
  const [exams, setExams] = useState<StudentExam[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void examApi<{ exams: StudentExam[] }>('/api/student/exams')
      .then((value) => { if (alive) setExams(value.exams); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar seus exames.'); });
    return () => { alive = false; };
  }, []);

  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (!exams) return <section className="student-panel"><p>Carregando seus exames…</p></section>;

  const upcoming = exams.filter((exam) => exam.officialResult === 'PENDING' && new Date(exam.officialScheduledFor).getTime() >= Date.now());
  const history = exams.filter((exam) => !upcoming.includes(exam));

  return (
    <div className="student-exams-page">
      <section className="student-exams-hero"><p className="student-eyebrow">EXAME PRÁTICO</p><h1>Seu exame.</h1><p>Horário, local, veículo e resultado vêm da mesma lista operacional usada pela escola.</p></section>
      <section className="student-panel">
        <div className="student-panel-head"><div><p className="student-eyebrow">PRÓXIMOS</p><h2>Agendamentos</h2></div><span>{upcoming.length}</span></div>
        <div className="student-exam-list">{upcoming.length ? upcoming.map((exam) => <ExamCard key={exam.candidateId} exam={exam} onOpen={() => navigate(`/aluno/exame/${exam.candidateId}`)} />) : <div className="student-exam-empty"><strong>Nenhum exame futuro.</strong><span>Quando sua matrícula entrar em uma lista de exame, ela aparecerá aqui.</span></div>}</div>
      </section>
      {history.length > 0 && <section className="student-panel"><div className="student-panel-head"><div><p className="student-eyebrow">HISTÓRICO</p><h2>Exames anteriores</h2></div><span>{history.length}</span></div><div className="student-exam-list">{history.map((exam) => <ExamCard key={exam.candidateId} exam={exam} onOpen={() => navigate(`/aluno/exame/${exam.candidateId}`)} />)}</div></section>}
    </div>
  );
}

export function StudentExamDetail({ candidateId }: { candidateId: string }) {
  const navigate = useNavigate();
  const [exam, setExam] = useState<StudentExam | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void examApi<{ exam: StudentExam }>(`/api/student/exams/${candidateId}`)
      .then((value) => { if (alive) setExam(value.exam); })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível abrir seu exame.'); });
    return () => { alive = false; };
  }, [candidateId]);

  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p><button className="student-secondary" type="button" onClick={() => navigate('/aluno/exame')}>Voltar</button></section>;
  if (!exam) return <section className="student-panel"><p>Abrindo exame…</p></section>;

  return (
    <div className="student-exam-detail">
      <button className="student-back" type="button" onClick={() => navigate('/aluno/exame')}>← Meus exames</button>
      <section className="student-exam-detail-hero">
        <p className="student-eyebrow">EXAME PRÁTICO · CATEGORIA {exam.category}</p>
        <h1>{dateTime(exam.officialScheduledFor)}</h1>
        <p>{exam.locationLabel}</p>
      </section>

      <section className="student-exam-facts">
        <div><span>Instrutor responsável</span><strong>{exam.instructorName}</strong></div>
        <div><span>Veículo</span><strong>{exam.vehicleLabel} · {exam.vehiclePlate}</strong></div>
        <div><span>Agendamento</span><strong>{exam.bookingSource === 'SELF' ? 'Feito pelo aluno' : 'Feito pela escola'}</strong></div>
        <div><span>Protocolo</span><strong>{exam.protocol || 'Não informado'}</strong></div>
        <div><span>LADV</span><strong>{exam.ladvStatus === 'READY' ? 'Pronta' : 'A confirmar'}</strong></div>
        <div><span>Taxa</span><strong>{exam.feeStatus === 'PAID' ? 'Paga' : exam.feeStatus === 'PENDING' ? 'Pendente' : 'A confirmar'}</strong></div>
      </section>

      <section className="student-exam-results">
        <div><span>RESULTADO INFORMADO</span><strong>{observedLabel(exam.observedResult)}</strong><p>É uma observação operacional até existir reconciliação oficial.</p></div>
        <div className={exam.officialResult === 'PENDING' ? '' : `is-${exam.officialResult.toLowerCase()}`}><span>RESULTADO OFICIAL</span><strong>{resultLabel(exam.officialResult)}</strong><p>{exam.resultReconciledAt ? `Confirmado em ${dateTime(exam.resultReconciledAt)}` : 'Aguardando confirmação institucional.'}</p></div>
      </section>

      <section className="student-exam-checklist">
        <p className="student-eyebrow">ANTES DE SAIR</p>
        <div><span>Documento oficial com foto</span><strong>Levar</strong></div>
        <div><span>LADV</span><strong>{exam.ladvStatus === 'READY' ? 'Confirmada' : 'Confirme com a escola'}</strong></div>
        <div><span>Horário</span><strong>{new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(exam.officialScheduledFor))}</strong></div>
      </section>
    </div>
  );
}
