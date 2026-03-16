/**
 * StableSwap vs Constant Product curve comparison.
 * Animated SVG with gradient savings zone and concrete trade annotation.
 */
export function RateIndicator() {
  // StableSwap curve (flatter near 1:1)
  const stablePath =
    'M 30,170 C 40,165 60,148 80,135 C 100,122 120,112 140,106 C 160,101 180,99 200,98 C 220,97 240,97 260,98 C 280,101 300,106 320,115 C 340,128 360,148 370,170';

  // Constant product (x*y=k) curve
  const cpPath =
    'M 30,170 C 40,155 60,125 80,105 C 100,90 120,80 140,74 C 160,70 180,68 200,68 C 220,68 240,70 260,74 C 280,80 300,90 320,110 C 340,135 360,155 370,170';

  // Closed path for the savings zone fill (area between curves)
  const fillPath =
    'M 30,170 C 40,165 60,148 80,135 C 100,122 120,112 140,106 C 160,101 180,99 200,98 C 220,97 240,97 260,98 C 280,101 300,106 320,115 C 340,128 360,148 370,170 L 370,170 C 360,155 340,135 320,110 C 300,90 280,80 260,74 C 240,70 220,68 200,68 C 180,68 160,70 140,74 C 120,80 100,90 80,105 C 60,125 40,155 30,170 Z';

  return (
    <div className="rate-indicator">
      <div className="rate-indicator-header">
        <span className="rate-indicator-title">Why StableSwap?</span>
      </div>
      <svg viewBox="0 0 400 210" className="rate-indicator-svg">
        <defs>
          {/* Glow filter for StableSwap curve */}
          <filter id="curveGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>

          {/* Gradient for savings zone fill */}
          <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(120, 80, 200, 0.25)" />
            <stop offset="100%" stopColor="rgba(120, 80, 200, 0.02)" />
          </linearGradient>
        </defs>

        {/* Grid */}
        <line x1="30" y1="170" x2="370" y2="170" stroke="var(--border)" strokeWidth="1" />
        <line x1="200" y1="55" x2="200" y2="175" stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />

        {/* Savings zone fill (area between curves) */}
        <path d={fillPath} fill="url(#savingsGrad)" className="rate-indicator-fill" />

        {/* CP curve (background, dashed) */}
        <path
          d={cpPath}
          fill="none"
          stroke="var(--text-dim)"
          strokeWidth="2"
          opacity="0.35"
          strokeDasharray="6,4"
          pathLength="1"
          className="rate-indicator-curve rate-indicator-curve--delayed"
        />

        {/* StableSwap curve (foreground, glowing) */}
        <path
          d={stablePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          pathLength="1"
          filter="url(#curveGlow)"
          className="rate-indicator-curve"
        />

        {/* Trade annotation */}
        <g className="rate-indicator-fill">
          {/* Annotation line from savings zone to callout */}
          <line x1="260" y1="86" x2="310" y2="62" stroke="rgba(160, 120, 255, 0.4)" strokeWidth="1" />
          <circle cx="260" cy="86" r="2.5" fill="rgba(160, 120, 255, 0.6)" />

          {/* Callout box */}
          <rect x="280" y="40" width="108" height="38" rx="4" fill="rgba(20, 15, 40, 0.85)" stroke="rgba(120, 80, 200, 0.25)" strokeWidth="0.5" />
          <text x="290" y="54" fill="var(--accent)" fontSize="10" fontWeight="600">
            1,000 USDC → 999.6
          </text>
          <text x="290" y="68" fill="var(--text-dim)" fontSize="9">
            vs 997 on typical AMM
          </text>
        </g>

        {/* Axis label */}
        <text x="200" y="198" fill="var(--text-dim)" fontSize="10" textAnchor="middle">
          Price ratio
        </text>
        <text x="200" y="186" fill="var(--text-dim)" fontSize="9" textAnchor="middle" opacity="0.6">
          1:1 peg
        </text>

        {/* Legend */}
        <line x1="40" y1="48" x2="58" y2="48" stroke="var(--accent)" strokeWidth="3" />
        <text x="63" y="51" fill="var(--accent)" fontSize="11" fontWeight="600">StableSwap</text>

        <line x1="40" y1="63" x2="58" y2="63" stroke="var(--text-dim)" strokeWidth="2" strokeDasharray="6,4" opacity="0.4" />
        <text x="63" y="66" fill="var(--text-dim)" fontSize="11">x*y=k (Uniswap)</text>
      </svg>
      <p className="rate-indicator-caption">
        Near 1:1, StableSwap gives 10-100x less slippage than constant-product AMMs.
      </p>
    </div>
  );
}
