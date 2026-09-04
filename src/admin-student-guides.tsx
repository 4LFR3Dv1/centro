import { useEffect, useMemo, useState } from 'react';
import {
  printStudentGuide,
  StudentGuideDocument,
  type StudentGuidePayload,
  type StudentGuideSnapshot,
} from './student-guide-document';

type EnrollmentOption = {
  id: string;
  serviceType: 'FIRST_LICENSE' | 'CATEGORY_ADDITION' | 'CATEGORY_CHANGE' | 'LICENSED_TRAINING';
  category: 'A' | 'B' | 'AB' | 'D';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
  openedAt: string;
};

type PreviewPayload = {
  template: {
    id: string;
    version: number;
    snapshotSchema: 'CENTRO_STUDENT_GUIDE_SNAPSHOT_V1';
  };
  snapshot: StudentGuideSnapshot;
};

type GeneratePayload = {
  receipt: {
    guideId: string;
    templateId: string;
    templateVersion: number;
    contentSha256: string;
    generatedAt: string;
  };
  guide: StudentGuidePayload;
};

const serviceLabels: Record<EnrollmentOption['serviceType'], string> = {
  FIRST_LICENSE: 'Primeira habilitação',
  CATEGORY_ADDITION: 'Adição de categoria',
  CATEGORY_CHANGE: 'Mudança de categoria',
  LICENSED_TRAINING: 'Treinamento para habilitado',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação do guia.');
  return body;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export function AdminStudentGuides({
  studentId,
  enrollments,
}: {
  studentId: string;
  enrollments: EnrollmentOption[];
}) {
  const defaultEnrollment = useMemo(
    () => enrollments.find((item) => item.status === 'ACTIVE') ?? enrollments[0] ?? null,
    [enrollments],
  );
  const [enrollmentId, setEnrollmentId] = useState(defaultEnrollment?.id ?? '');
  const [guides, setGuides] = useState<StudentGuidePayload[]>([]);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [selected, setSelected] = useState<StudentGuidePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<GeneratePayload['receipt'] | null>(null);

  useEffect(() => {
    if (!defaultEnrollment) return;
    if (!enrollments.some((item) => item.id === enrollmentId)) setEnrollmentId(defaultEnrollment.id);
  }, [defaultEnrollment, enrollmentId, enrollments]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void request<{ guides: StudentGuidePayload[] }>(`/api/admin/guides?studentId=${encodeURIComponent(studentId)}`)
      .then((value) => {
        if (!alive) return;
        setGuides(value.guides);
        setSelected((current) => current ?? value.guides[0] ?? null);
      })
      .catch((candidate) => { if (alive) setError(candidate instanceof Error ? candidate.message : 'Não foi possível carregar os guias.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  async function loadPreview() {
    if (!enrollmentId) return;
    setPreviewing(true);
    setError('');
    setReceipt(null);
    try {
      const value = await request<PreviewPayload>(
        `/api/admin/guides/preview?studentId=${encodeURIComponent(studentId)}&enrollmentId=${encodeURIComponent(enrollmentId)}`,
      );
      setPreview(value);
      setSelected(null);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível gerar a prévia.');
    } finally {
      setPreviewing(false);
    }
  }

  async function generate() {
    if (!enrollmentId) return;
    setGenerating(true);
    setError('');
    try {
      const value = await request<GeneratePayload>('/api/admin/guides', {
        method: 'POST',
        body: JSON.stringify({ studentId, enrollmentId }),
      });
      setReceipt(value.receipt);
      setGuides((current) => [value.guide, ...current.filter((item) => item.id !== value.guide.id)]);
      setSelected(value.guide);
      setPreview(null);
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível gerar o guia.');
    } finally {
      setGenerating(false);
    }
  }

  const display = selected
    ? {
        snapshot: selected.snapshot,
        templateId: selected.template.id,
        templateVersion: selected.template.version,
        generatedAt: selected.generatedAt,
        contentSha256: selected.contentSha256,
        preview: false,
      }
    : preview
      ? {
          snapshot: preview.snapshot,
          templateId: preview.template.id,
          templateVersion: preview.template.version,
          generatedAt: null,
          contentSha256: null,
          preview: true,
        }
      : null;

  if (enrollments.length === 0) {
    return (
      <div className="admin-detail-card">
        <div className="admin-card-title"><span>GUIA DO ALUNO</span><strong>Sem matrícula</strong></div>
        <p>O guia só pode existir quando há uma matrícula institucional para fotografar.</p>
      </div>
    );
  }

  return (
    <section className="admin-guide-workspace">
      <div className="admin-detail-card admin-guide-control">
        <div className="admin-card-title"><span>GUIA DO ALUNO</span><strong>{guides.length} versão(ões)</strong></div>
        <p>Pré-visualize o estado atual ou gere uma versão imutável para entrega e impressão.</p>

        <label className="admin-guide-enrollment">
          Matrícula
          <select value={enrollmentId} onChange={(event) => {
            setEnrollmentId(event.target.value);
            setPreview(null);
            setSelected(null);
            setReceipt(null);
          }}>
            {enrollments.map((enrollment) => (
              <option value={enrollment.id} key={enrollment.id}>
                {serviceLabels[enrollment.serviceType]} · {enrollment.category} · {enrollment.status}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-guide-actions">
          <button className="admin-secondary" type="button" disabled={previewing || generating} onClick={() => void loadPreview()}>
            {previewing ? 'Montando prévia…' : 'Pré-visualizar'}
          </button>
          <button className="admin-primary" type="button" disabled={generating || previewing} onClick={() => void generate()}>
            {generating ? 'Gerando…' : 'Gerar nova versão'}
          </button>
          {display && <button className="admin-secondary" type="button" onClick={printStudentGuide}>Imprimir</button>}
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        {receipt && (
          <div className="admin-guide-receipt" role="status">
            <strong>Versão gerada e auditada.</strong>
            <span>{receipt.templateId}@{receipt.templateVersion} · {dateTime(receipt.generatedAt)}</span>
            <code>{receipt.contentSha256}</code>
          </div>
        )}

        <div className="admin-guide-history">
          <strong>Histórico de versões</strong>
          {loading ? <span>Carregando…</span> : guides.length === 0 ? <span>Nenhum guia gerado.</span> : guides.map((guide) => (
            <button key={guide.id} type="button" className={selected?.id === guide.id ? 'is-active' : ''} onClick={() => {
              setSelected(guide);
              setPreview(null);
              setReceipt(null);
            }}>
              <span>{dateTime(guide.generatedAt)}</span>
              <small>{guide.template.id}@{guide.template.version} · {guide.contentSha256.slice(0, 12)}…</small>
            </button>
          ))}
        </div>
      </div>

      {display && (
        <div className="admin-guide-preview student-guide-print-root">
          <StudentGuideDocument {...display} />
        </div>
      )}
    </section>
  );
}
