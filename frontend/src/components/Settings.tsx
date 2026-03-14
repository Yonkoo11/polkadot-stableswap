interface SettingsProps {
  slippage: number;
  onSlippageChange: (value: number) => void;
  onClose: () => void;
}

const PRESETS = [0.1, 0.5, 1.0];

export function Settings({ slippage, onSlippageChange, onClose }: SettingsProps) {
  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>Slippage Tolerance</span>
        <button className="btn-icon" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="slippage-options">
        {PRESETS.map((val) => (
          <button
            key={val}
            className={`slippage-btn ${slippage === val ? 'active' : ''}`}
            onClick={() => onSlippageChange(val)}
          >
            {val}%
          </button>
        ))}
        <div className="slippage-custom">
          <input
            type="number"
            value={slippage}
            onChange={(e) => onSlippageChange(parseFloat(e.target.value) || 0.5)}
            min="0.01"
            max="50"
            step="0.1"
          />
          <span>%</span>
        </div>
      </div>
      {slippage > 5 && (
        <div className="notice notice-warning">High slippage may result in an unfavorable trade.</div>
      )}
    </div>
  );
}
