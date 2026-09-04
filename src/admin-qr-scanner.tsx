import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';

async function lookupQr(value: string) {
  const response = await fetch('/api/admin/student-access/lookup', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: string;
    student?: { id: string; publicId: string; fullName: string };
    qr?: { active: boolean; revokedAt: string | null };
  };
  if (!response.ok || !body.student || !body.qr) throw new Error(body.error || 'QR não reconhecido.');
  return { student: body.student, qr: body.qr };
}

export function AdminQrScanner({ onResolved, onClose }: {
  onResolved: (studentId: string, meta: { active: boolean; publicId: string; fullName: string }) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const busyRef = useRef(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'unavailable'>('starting');

  async function resolve(valueToResolve: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      const result = await lookupQr(valueToResolve);
      controlsRef.current?.stop();
      onResolved(result.student.id, {
        active: result.qr.active,
        publicId: result.student.publicId,
        fullName: result.student.fullName,
      });
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : 'Não foi possível ler o QR.');
    } finally {
      busyRef.current = false;
    }
  }

  useEffect(() => {
    let disposed = false;
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return () => undefined;
    }

    void reader.decodeFromVideoDevice(undefined, video, (result) => {
      if (disposed || !result) return;
      void resolve(result.getText());
    }).then((controls) => {
      if (disposed) controls.stop();
      else {
        controlsRef.current = controls;
        setCameraState('active');
      }
    }).catch(() => {
      if (!disposed) setCameraState('unavailable');
    });

    return () => {
      disposed = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
    // resolve is deliberately stable for the lifetime of the scanner dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void resolve(value);
  }

  return (
    <div className="admin-qr-backdrop" role="presentation">
      <section className="admin-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-qr-title">
        <div className="admin-card-title">
          <div><span>BUSCA INTERNA</span><h2 id="admin-qr-title">Ler QR do aluno</h2></div>
          <button type="button" className="admin-qr-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="admin-qr-camera">
          <video ref={videoRef} muted playsInline />
          {cameraState === 'starting' && <p>Iniciando câmera…</p>}
          {cameraState === 'unavailable' && <p>Câmera indisponível. Cole o link ou código abaixo.</p>}
        </div>
        <p className="admin-qr-help">Aponte para o cartão do aluno. O QR localiza o cadastro; ele não autentica ninguém.</p>
        <form className="admin-qr-paste" onSubmit={submit}>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Cole o link /aluno/acesso/... ou o código" />
          <button className="admin-primary" type="submit" disabled={!value.trim()}>Localizar</button>
        </form>
        {error && <p className="admin-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
