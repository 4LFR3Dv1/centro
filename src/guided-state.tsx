import type { ReactNode } from 'react';
import './guided-state.css';

export type GuidedStateKind = 'READY' | 'WAITING' | 'BLOCKED' | 'DONE';

export type GuidedAction = {
  label: string;
  onClick: () => void;
};

export type GuidedState = {
  kind: GuidedStateKind;
  eyebrow?: string;
  title: string;
  detail?: string;
  consequence?: string;
  primaryAction?: GuidedAction | null;
  secondaryActions?: GuidedAction[];
};

const stateLabels: Record<GuidedStateKind, string> = {
  READY: 'PRECISA DE AÇÃO',
  WAITING: 'AGUARDANDO',
  BLOCKED: 'PRECISA RESOLVER',
  DONE: 'CONCLUÍDO',
};

export function GuidedStateCard({ state, compact = false, className = '', footer }: {
  state: GuidedState;
  compact?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <section
      className={`guided-state guided-state-${state.kind.toLowerCase()} ${compact ? 'guided-state-compact' : ''} ${className}`.trim()}
      aria-live="polite"
    >
      <div className="guided-state-copy">
        <div className="guided-state-kicker">
          <span>{state.eyebrow || 'PRÓXIMO PASSO'}</span>
          <strong>{stateLabels[state.kind]}</strong>
        </div>
        <h2>{state.title}</h2>
        {state.detail && <p>{state.detail}</p>}
        {state.consequence && <small>{state.consequence}</small>}
        {!!state.secondaryActions?.length && (
          <div className="guided-state-actions guided-state-secondary-actions">
            {state.secondaryActions.map((action) => (
              <button key={action.label} className="guided-state-secondary" type="button" onClick={action.onClick}>{action.label}</button>
            ))}
          </div>
        )}
        {footer}
      </div>
      {state.primaryAction && (
        <button className="guided-state-primary" type="button" onClick={state.primaryAction.onClick}>{state.primaryAction.label}</button>
      )}
    </section>
  );
}
