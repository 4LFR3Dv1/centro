import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import './access-qr.css';

export function studentAccessUrl(publicToken: string): string {
  if (typeof window === 'undefined') return `/aluno/acesso/${publicToken}`;
  return `${window.location.origin}/aluno/acesso/${publicToken}`;
}

export function AccessQr({ publicToken, size = 220, label = 'QR de acesso do aluno' }: {
  publicToken: string;
  size?: number;
  label?: string;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setSrc('');
    setError('');
    void QRCode.toDataURL(studentAccessUrl(publicToken), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: size,
    }).then((value) => { if (alive) setSrc(value); })
      .catch(() => { if (alive) setError('Não foi possível renderizar o QR.'); });
    return () => { alive = false; };
  }, [publicToken, size]);

  if (error) return <div className="access-qr access-qr-error">{error}</div>;
  if (!src) return <div className="access-qr access-qr-loading" aria-label="Gerando QR" />;
  return <img className="access-qr" src={src} width={size} height={size} alt={label} />;
}
