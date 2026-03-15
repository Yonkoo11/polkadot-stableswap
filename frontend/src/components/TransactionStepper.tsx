export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export interface TxStep {
  label: string;
  status: StepStatus;
}

interface TransactionStepperProps {
  steps: TxStep[];
  onRetry?: () => void;
}

export function TransactionStepper({ steps, onRetry }: TransactionStepperProps) {
  return (
    <div className="tx-stepper">
      {steps.map((step, i) => (
        <div key={i} className="tx-step-wrapper">
          <div className={`tx-step ${step.status}`}>
            <div className="tx-step-circle">
              {step.status === 'done' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : step.status === 'error' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : step.status === 'active' ? (
                <Spinner />
              ) : (
                <span className="tx-step-num">{i + 1}</span>
              )}
            </div>
            <span className="tx-step-label">{step.label}</span>
            {step.status === 'error' && onRetry && (
              <button className="tx-step-retry" onClick={onRetry}>Retry</button>
            )}
          </div>
          {i < steps.length - 1 && (
            <div className={`tx-step-line ${step.status === 'done' ? 'done' : ''}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="tx-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
