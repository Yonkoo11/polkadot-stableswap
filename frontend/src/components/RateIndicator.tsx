/**
 * StableSwap vs Constant Product curve comparison.
 * Static SVG - no trading data needed (testnet).
 */
export function RateIndicator() {
  // StableSwap curve points (flatter near 1:1)
  const stablePath = "M 30,170 C 40,165 60,148 80,135 C 100,122 120,112 140,106 C 160,101 180,99 200,98 C 220,97 240,97 260,98 C 280,101 300,106 320,115 C 340,128 360,148 370,170";

  // Constant product (x*y=k) curve - more curved
  const cpPath = "M 30,170 C 40,155 60,125 80,105 C 100,90 120,80 140,74 C 160,70 180,68 200,68 C 220,68 240,70 260,74 C 280,80 300,90 320,110 C 340,135 360,155 370,170";

  return (
    <div className="rate-indicator">
      <div className="rate-indicator-header">
        <span className="rate-indicator-title">Why StableSwap?</span>
      </div>
      <svg viewBox="0 0 400 200" className="rate-indicator-svg">
        {/* Grid lines */}
        <line x1="30" y1="170" x2="370" y2="170" stroke="var(--border)" strokeWidth="1" />
        <line x1="200" y1="50" x2="200" y2="175" stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />

        {/* 1:1 label */}
        <text x="200" y="190" fill="var(--text-dim)" fontSize="10" textAnchor="middle">1:1 peg</text>

        {/* Constant product curve (background) */}
        <path d={cpPath} fill="none" stroke="var(--text-dim)" strokeWidth="2" opacity="0.4" strokeDasharray="6,4" />

        {/* StableSwap curve (foreground) */}
        <path d={stablePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />

        {/* Slippage comparison arrows */}
        <g opacity="0.7">
          {/* Arrow showing less slippage on StableSwap */}
          <line x1="260" y1="98" x2="260" y2="74" stroke="var(--yellow)" strokeWidth="1.5" markerEnd="url(#arrowY)" />
          <text x="270" y="86" fill="var(--yellow)" fontSize="9">less slippage</text>
        </g>

        {/* Arrow marker */}
        <defs>
          <marker id="arrowY" markerWidth="6" markerHeight="4" refX="3" refY="2" orient="auto">
            <path d="M0,0 L6,2 L0,4" fill="var(--yellow)" />
          </marker>
        </defs>

        {/* Legend */}
        <line x1="40" y1="45" x2="60" y2="45" stroke="var(--accent)" strokeWidth="2.5" />
        <text x="65" y="48" fill="var(--accent)" fontSize="10" fontWeight="600">StableSwap (this DEX)</text>

        <line x1="40" y1="60" x2="60" y2="60" stroke="var(--text-dim)" strokeWidth="2" strokeDasharray="6,4" opacity="0.4" />
        <text x="65" y="63" fill="var(--text-dim)" fontSize="10">x*y=k (Uniswap V2)</text>
      </svg>
      <p className="rate-indicator-caption">
        The StableSwap curve concentrates liquidity around the 1:1 price, giving 10-100x less slippage for pegged assets like USDC/USDT.
      </p>
    </div>
  );
}
