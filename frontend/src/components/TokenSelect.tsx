import { useState, useRef, useEffect } from 'react';
import { TOKENS } from '../config/contracts';
import type { TokenInfo } from '../config/contracts';

interface TokenSelectProps {
  selected: string;
  onChange: (symbol: string) => void;
  exclude?: string;
  label: string;
}

const TOKEN_COLORS: Record<string, string> = {
  USDC: '#2775ca',
  USDT: '#26a17b',
  DOT: '#e6007a',
};

function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const color = TOKEN_COLORS[symbol] || '#6b7280';
  return (
    <div
      className="token-icon"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
      }}
    >
      {symbol.charAt(0)}
    </div>
  );
}

export { TokenIcon };

export function TokenSelect({ selected, onChange, exclude, label }: TokenSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const tokenList = Object.values(TOKENS).filter(
    (t: TokenInfo) => t.symbol !== exclude
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="token-select" ref={ref}>
      <label className="token-label">{label}</label>
      <button
        className="token-selector-btn"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <TokenIcon symbol={selected} size={22} />
        <span className="token-selector-symbol">{selected}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="token-dropdown-menu">
          {tokenList.map((token: TokenInfo) => (
            <button
              key={token.symbol}
              className={`token-dropdown-item ${token.symbol === selected ? 'selected' : ''}`}
              onClick={() => { onChange(token.symbol); setOpen(false); }}
              type="button"
            >
              <TokenIcon symbol={token.symbol} size={28} />
              <div className="token-dropdown-info">
                <span className="token-dropdown-symbol">{token.symbol}</span>
                <span className="token-dropdown-name">{token.name}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
