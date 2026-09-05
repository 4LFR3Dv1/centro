import { useEffect, useState } from 'react';
import {
  printStudentGuide,
  StudentGuideDocument,
  type StudentGuidePayload,
} from './student-guide-document';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível carregar seus guias.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function StudentGuides() {
  const [guides, setGuides] = useState<StudentGuidePayload[]>([]);
  const [selected, setSelected] = useState<StudentGuidePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void get<{ guides: StudentGuidePayload[] }>('/api/student/guides')
      .then((value) => {
        if (!alive) return;
        setGuides(value.guides);
        setSelected(value.guides[0] ?? null);
      })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar seus guias.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <section className="student-panel"><p aria-live="polite">Carregando seus guias…</p></section>;
  if (error) return <section className="student-panel"><p className="student-error" role="alert">{error}</p></section>;
  if (guides.length === 0) {
    return (
      <section className="student-panel student-guide-empty-state">
        <p className="student-eyebrow">GUIA DO ALUNO</p>
        <h1>Seu guia ainda não foi entregue.</h1>
        <p>Quando a escola preparar seu guia, ele aparecerá aqui com as informações daquele momento.</p>
      </section>
    );
  }

  return (
    <section className="student-guides-page" aria-labelledby="student-guides-title">
      <div className="student-guides-heading">
        <div>
          <p className="student-eyebrow">GUIA DO ALUNO</p>
          <h1 id="student-guides-title">Seus guias.</h1>
          <p>Cada versão mostra as informações que estavam confirmadas quando a escola preparou o documento.</p>
        </div>
        {selected && <button className="student-primary" type="button" onClick={printStudentGuide}>Imprimir guia</button>}
      </div>

      <div className="student-guides-layout">
        <aside className="student-guides-history" aria-label="Histórico de guias">
          {guides.map((guide, index) => (
            <button
              key={guide.id}
              type="button"
              className={selected?.id === guide.id ? 'is-active' : ''}
              onClick={() => setSelected(guide)}
              aria-label={`Ver guia de ${dateTime(guide.generatedAt)}`}
            >
              <strong>{index === 0 ? 'Mais recente' : `Versão ${guides.length - index}`}</strong>
              <span>{dateTime(guide.generatedAt)}</span>
            </button>
          ))}
        </aside>

        {selected && (
          <div className="student-guide-portal-document student-guide-print-root">
            <StudentGuideDocument
              snapshot={selected.snapshot}
              templateId={selected.template.id}
              templateVersion={selected.template.version}
              generatedAt={selected.generatedAt}
              contentSha256={selected.contentSha256}
            />
          </div>
        )}
      </div>
    </section>
  );
}
