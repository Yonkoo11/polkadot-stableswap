import { useState } from 'react';
import type { StepStatus, TxStep } from '../components/TransactionStepper';

export function useTransactionSteps(initialLabels: string[]) {
  const [steps, setSteps] = useState<TxStep[]>(
    initialLabels.map(label => ({ label, status: 'pending' as StepStatus }))
  );
  const [active, setActive] = useState(false);

  const start = () => {
    setSteps(prev => prev.map((s, i) => ({ ...s, status: i === 0 ? 'active' : 'pending' })));
    setActive(true);
  };

  const advance = () => {
    setSteps(prev => {
      const activeIdx = prev.findIndex(s => s.status === 'active');
      if (activeIdx === -1) return prev;
      return prev.map((s, i) => {
        if (i === activeIdx) return { ...s, status: 'done' as StepStatus };
        if (i === activeIdx + 1) return { ...s, status: 'active' as StepStatus };
        return s;
      });
    });
  };

  const complete = () => {
    setSteps(prev => prev.map(s => ({ ...s, status: 'done' as StepStatus })));
    setActive(true);
  };

  const fail = () => {
    setSteps(prev => prev.map(s =>
      s.status === 'active' ? { ...s, status: 'error' as StepStatus } : s
    ));
  };

  const reset = () => {
    setSteps(initialLabels.map(label => ({ label, status: 'pending' as StepStatus })));
    setActive(false);
  };

  return { steps, active, start, advance, complete, fail, reset };
}
