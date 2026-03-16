import { useState, useEffect, useCallback } from 'react';
import { Contract, formatUnits, JsonRpcProvider } from 'ethers';
import { CONTRACTS, TOKENS, POLKADOT_HUB_TESTNET } from '../config/contracts';
import StablePoolABI from '../abi/StablePool.json';

const LP_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

interface DashboardProps {
  readProvider: JsonRpcProvider;
  account: string | null;
}

interface PoolStats {
  reserve0: number;
  reserve1: number;
  tvl: number;
  virtualPrice: number;
  fee: number;
  ampFactor: number;
  lpTotalSupply: number;
}

interface SwapEvent {
  from: string;
  to: string;
  amountIn: string;
  amountOut: string;
  trader: string;
  blockNumber: number;
}

interface UserPosition {
  lpBalance: number;
  sharePercent: number;
  usdcValue: number;
  usdtValue: number;
}

export function Dashboard({ readProvider, account }: DashboardProps) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [recentSwaps, setRecentSwaps] = useState<SwapEvent[]>([]);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const pool = new Contract(CONTRACTS.STABLE_POOL_USDC_USDT, StablePoolABI, readProvider);

      const [b0, b1, vp, fee, a, lpAddr] = await Promise.all([
        pool.getTokenBalance(0),
        pool.getTokenBalance(1),
        pool.getVirtualPrice().catch(() => 0n),
        pool.fee(),
        pool.getA().then((v: bigint) => v / (2n * 10n ** 18n)),
        pool.lpToken(),
      ]);

      const reserve0 = parseFloat(formatUnits(b0, TOKENS.USDC.decimals));
      const reserve1 = parseFloat(formatUnits(b1, TOKENS.USDT.decimals));
      const lp = new Contract(lpAddr, LP_ABI, readProvider);
      const totalSupply = parseFloat(formatUnits(await lp.totalSupply(), 18));

      const poolStats: PoolStats = {
        reserve0,
        reserve1,
        tvl: reserve0 + reserve1,
        virtualPrice: parseFloat(formatUnits(vp, 18)),
        fee: Number(fee) / 1e8,
        ampFactor: Number(a),
        lpTotalSupply: totalSupply,
      };

      setStats(poolStats);

      // User position
      if (account) {
        const userBal = parseFloat(formatUnits(await lp.balanceOf(account), 18));
        if (userBal > 0 && totalSupply > 0) {
          const share = userBal / totalSupply;
          setUserPosition({
            lpBalance: userBal,
            sharePercent: share * 100,
            usdcValue: reserve0 * share,
            usdtValue: reserve1 * share,
          });
        } else {
          setUserPosition(null);
        }
      }
    } catch (err) {
      console.error('Dashboard fetch failed:', err);
    }
  }, [readProvider, account]);

  const fetchRecentSwaps = useCallback(async () => {
    try {
      const pool = new Contract(CONTRACTS.STABLE_POOL_USDC_USDT, StablePoolABI, readProvider);
      const currentBlock = await readProvider.getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 500);

      const swapFilter = pool.filters.Swap?.();
      if (!swapFilter) return;

      const events = await pool.queryFilter(swapFilter, fromBlock, currentBlock);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recent = events.slice(-10).reverse().map((e: Record<string, any>) => {
        const args = e.args;
        const tokenInIdx = Number(args.tokenIn);
        return {
          from: tokenInIdx === 0 ? 'USDC' : 'USDT',
          to: tokenInIdx === 0 ? 'USDT' : 'USDC',
          amountIn: parseFloat(formatUnits(args.amountIn, 6)).toFixed(2),
          amountOut: parseFloat(formatUnits(args.amountOut, 6)).toFixed(2),
          trader: args.sender as string,
          blockNumber: e.blockNumber,
        };
      });
      setRecentSwaps(recent);
    } catch {
      setRecentSwaps([]);
    }
  }, [readProvider]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchRecentSwaps()]).finally(() => setLoading(false));
  }, [fetchStats, fetchRecentSwaps]);

  // Auto-refresh every 30 seconds (silent, no skeleton)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchRecentSwaps();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchRecentSwaps]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchStats(), fetchRecentSwaps()]);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-hero">
          <h1>USDC / USDT StablePool</h1>
          <p>Loading pool data...</p>
        </div>
        <div className="bento-grid">
          {[...Array(6)].map((_, i) => (
            <div key={i} className={`bento-card${i === 0 ? ' bento-card--wide' : ''}`}>
              <div className="dashboard-skeleton" style={{ height: 12, width: '40%', marginBottom: 12 }} />
              <div className="dashboard-skeleton" style={{ height: 32, width: '60%', marginBottom: 8 }} />
              <div className="dashboard-skeleton" style={{ height: 10, width: '50%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="dashboard">
        <div className="dashboard-hero">
          <h1>USDC / USDT StablePool</h1>
          <p>Failed to load pool data. Check RPC connection.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <h1>USDC / USDT StablePool</h1>
        <p>
          First native StableSwap on Polkadot Hub. Near-zero slippage for pegged assets.
          <button className={`refresh-btn${refreshing ? ' refreshing' : ''}`} onClick={handleRefresh} title="Refresh data">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </p>
      </div>

      <div className="bento-grid">
        {/* TVL - wide card */}
        <div className="bento-card bento-card--wide">
          <div className="bento-label">Total Value Locked</div>
          <div className="bento-value bento-value--accent">
            ${stats.tvl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          <div className="bento-subvalue">USDC + USDT liquidity</div>

          <div className="composition-bar-wrapper">
            <div className="composition-bar">
              <div
                className="composition-bar-usdc"
                style={{ width: stats.tvl > 0 ? `${(stats.reserve0 / stats.tvl) * 100}%` : '50%' }}
              />
              <div className="composition-bar-usdt" />
            </div>
            <div className="composition-legend">
              <div className="composition-legend-item">
                <div className="composition-dot" style={{ background: '#2775ca' }} />
                <span>USDC {stats.tvl > 0 ? (stats.reserve0 / stats.tvl * 100).toFixed(1) : '50.0'}%</span>
                <span style={{ color: 'var(--text-bright)', marginLeft: 4 }}>
                  ${stats.reserve0.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="composition-legend-item">
                <div className="composition-dot" style={{ background: '#26a17b' }} />
                <span>USDT {stats.tvl > 0 ? (stats.reserve1 / stats.tvl * 100).toFixed(1) : '50.0'}%</span>
                <span style={{ color: 'var(--text-bright)', marginLeft: 4 }}>
                  ${stats.reserve1.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Virtual Price */}
        <div className="bento-card">
          <div className="bento-label">Virtual Price</div>
          <div className="bento-value">{stats.virtualPrice.toFixed(6)}</div>
          <div className="bento-subvalue">LP token value (target: 1.000)</div>
        </div>

        {/* A Factor */}
        <div className="bento-card">
          <div className="bento-label">Amplification (A)</div>
          <div className="bento-value bento-value--accent">{stats.ampFactor}</div>
          <div className="bento-subvalue">Curve concentration factor</div>
        </div>

        {/* Fee Rate */}
        <div className="bento-card">
          <div className="bento-label">Swap Fee</div>
          <div className="bento-value">{stats.fee.toFixed(2)}%</div>
          <div className="bento-subvalue">Per swap, goes to LPs</div>
        </div>

        {/* LP Supply */}
        <div className="bento-card">
          <div className="bento-label">LP Token Supply</div>
          <div className="bento-value" style={{ fontSize: 20 }}>
            {stats.lpTotalSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })} LP
          </div>
          <div className="bento-subvalue">Total LP tokens issued</div>
        </div>

        {/* StableSwap advantage - wide to fill row */}
        <div className="bento-card bento-card--wide">
          <div className="bento-label">Slippage Advantage</div>
          <div className="bento-value bento-value--accent">10-100x</div>
          <div className="bento-subvalue">vs Uniswap V2 for stablecoins. Curve-style invariant (A=85) concentrates liquidity around the peg.</div>
        </div>

        {/* Network card */}
        <div className="bento-card">
          <div className="bento-label">Network</div>
          <div className="bento-value" style={{ fontSize: 18 }}>Polkadot Hub</div>
          <div className="bento-subvalue">
            Chain ID 420420417 &middot;{' '}
            <a href={POLKADOT_HUB_TESTNET.blockExplorer} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              Blockscout
            </a>
          </div>
        </div>
      </div>

      {/* User Position */}
      {account && userPosition && (
        <div className="bento-card position-card" style={{ marginTop: 12 }}>
          <div className="bento-label">Your Position</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 8 }}>
            <div>
              <div className="bento-subvalue">LP Balance</div>
              <div style={{ color: 'var(--text-bright)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {userPosition.lpBalance.toFixed(4)}
              </div>
            </div>
            <div>
              <div className="bento-subvalue">Pool Share</div>
              <div style={{ color: 'var(--text-bright)', fontWeight: 600 }}>
                {userPosition.sharePercent.toFixed(4)}%
              </div>
            </div>
            <div>
              <div className="bento-subvalue">USDC Value</div>
              <div style={{ color: '#3d8ee0', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                ${userPosition.usdcValue.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="bento-subvalue">USDT Value</div>
              <div style={{ color: '#2db88a', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                ${userPosition.usdtValue.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Swaps - always visible */}
      <div className="bento-card bento-card--full" style={{ marginTop: 12 }}>
        <div className="bento-label">Recent Swaps</div>
        {recentSwaps.length > 0 ? (
          <table className="swaps-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Amount In</th>
                <th>Amount Out</th>
                <th>Trader</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {recentSwaps.map((swap, i) => (
                <tr key={i}>
                  <td className="swap-direction-in">{swap.from}</td>
                  <td className="swap-direction-out">{swap.to}</td>
                  <td>{swap.amountIn}</td>
                  <td>{swap.amountOut}</td>
                  <td>
                    <a
                      href={`${POLKADOT_HUB_TESTNET.blockExplorer}/address/${swap.trader}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--text-dim)', textDecoration: 'none' }}
                    >
                      {swap.trader.slice(0, 6)}...{swap.trader.slice(-4)}
                    </a>
                  </td>
                  <td>
                    <a
                      href={`${POLKADOT_HUB_TESTNET.blockExplorer}/block/${swap.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--text-dim)', textDecoration: 'none' }}
                    >
                      {swap.blockNumber}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="swaps-empty">No recent swaps in the last 500 blocks</div>
        )}
      </div>
    </div>
  );
}
