import { useState, useEffect, useCallback } from 'react';
import { Contract, parseUnits, formatUnits, JsonRpcSigner, JsonRpcProvider } from 'ethers';
import { TOKENS, POOLS, PoolType, POLKADOT_HUB_TESTNET, isZeroAddress, ERC20_ABI } from '../config/contracts';
import type { PoolConfig } from '../config/contracts';
import { TokenIcon } from './TokenSelect';
import { TransactionStepper } from './TransactionStepper';
import { useTransactionSteps } from '../hooks/useTransactionSteps';
import StablePoolABI from '../abi/StablePool.json';
import VolatilePoolABI from '../abi/VolatilePool.json';

interface LiquidityPanelProps {
  signer: JsonRpcSigner | null;
  account: string | null;
  readProvider: JsonRpcProvider;
}

export function LiquidityPanel({ signer, account, readProvider }: LiquidityPanelProps) {
  const [selectedPool, setSelectedPool] = useState<PoolConfig>(POOLS[0]);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [lpAmount, setLpAmount] = useState('');
  const [balance0, setBalance0] = useState('0');
  const [balance1, setBalance1] = useState('0');
  const [lpBalance, setLpBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastHash, setToastHash] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [poolStats, setPoolStats] = useState<{
    reserve0: string;
    reserve1: string;
    virtualPrice?: string;
    fee?: string;
    ampFactor?: string;
  } | null>(null);

  const addStepper = useTransactionSteps(['Approve Token A', 'Approve Token B', 'Add Liquidity', 'Done']);
  const removeStepper = useTransactionSteps(['Approve LP', 'Remove Liquidity', 'Done']);

  const token0 = TOKENS[selectedPool.token0Symbol];
  const token1 = TOKENS[selectedPool.token1Symbol];
  const poolDeployed = !isZeroAddress(selectedPool.address);

  // Fetch pool stats (uses readProvider so stats are visible without wallet)
  const fetchPoolStats = useCallback(async () => {
    if (!poolDeployed || !readProvider) return;

    try {
      if (selectedPool.type === PoolType.Stable) {
        const pool = new Contract(selectedPool.address, StablePoolABI, readProvider);
        const [b0, b1, vp, fee, a] = await Promise.all([
          pool.getTokenBalance(0),
          pool.getTokenBalance(1),
          pool.getVirtualPrice().catch(() => 0n),
          pool.fee(),
          pool.getA().then((v: bigint) => v / (2n * 10n ** 18n)),
        ]);
        setPoolStats({
          reserve0: formatUnits(b0, token0.decimals),
          reserve1: formatUnits(b1, token1.decimals),
          virtualPrice: formatUnits(vp, 18),
          fee: (Number(fee) / 1e8).toFixed(4),
          ampFactor: Number(a).toString(),
        });
      } else {
        const pool = new Contract(selectedPool.address, VolatilePoolABI, readProvider);
        const [reserves, fee] = await Promise.all([
          pool.getReserves(),
          pool.fee(),
        ]);
        setPoolStats({
          reserve0: formatUnits(reserves[0], token0.decimals),
          reserve1: formatUnits(reserves[1], token1.decimals),
          fee: (Number(fee) / 1e8).toFixed(4),
        });
      }
    } catch (err) {
      console.error('Failed to fetch pool stats:', err);
      setPoolStats(null);
    }
  }, [selectedPool, readProvider, poolDeployed, token0.decimals, token1.decimals]);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!account || !signer) return;

    for (const [token, setter] of [
      [token0, setBalance0],
      [token1, setBalance1],
    ] as [typeof token0, React.Dispatch<React.SetStateAction<string>>][]) {
      if (isZeroAddress(token.address)) {
        setter('0');
        continue;
      }
      try {
        const erc20 = new Contract(token.address, ERC20_ABI, signer);
        const bal = await erc20.balanceOf(account);
        setter(formatUnits(bal, token.decimals));
      } catch {
        setter('0');
      }
    }

    // LP balance
    if (poolDeployed) {
      try {
        const poolAbi = selectedPool.type === PoolType.Stable ? StablePoolABI : VolatilePoolABI;
        const pool = new Contract(selectedPool.address, poolAbi, signer);
        const lpAddr = await pool.lpToken();
        if (!isZeroAddress(lpAddr)) {
          const lp = new Contract(lpAddr, ERC20_ABI, signer);
          const bal = await lp.balanceOf(account);
          setLpBalance(formatUnits(bal, 18));
        }
      } catch {
        setLpBalance('0');
      }
    }
  }, [account, signer, token0, token1, selectedPool, poolDeployed]);

  useEffect(() => {
    fetchBalances();
    fetchPoolStats();
  }, [fetchBalances, fetchPoolStats]);

  const handleAddLiquidity = async () => {
    if (!signer || !account || !poolDeployed) return;

    setLoading(true);
    setTxError(null);
    addStepper.start();

    try {
      const amt0 = parseUnits(amount0 || '0', token0.decimals);
      const amt1 = parseUnits(amount1 || '0', token1.decimals);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Approve token 0
      if (amt0 > 0n && !isZeroAddress(token0.address)) {
        const erc20 = new Contract(token0.address, ERC20_ABI, signer);
        const allowance = await erc20.allowance(account, selectedPool.address);
        if (allowance < amt0) {
          const tx = await erc20.approve(selectedPool.address, amt0 * 1000n);
          await tx.wait(1);
        }
      }

      addStepper.advance(); // Token A -> Token B

      // Approve token 1
      if (amt1 > 0n && !isZeroAddress(token1.address)) {
        const erc20 = new Contract(token1.address, ERC20_ABI, signer);
        const allowance = await erc20.allowance(account, selectedPool.address);
        if (allowance < amt1) {
          const tx = await erc20.approve(selectedPool.address, amt1 * 1000n);
          await tx.wait(1);
        }
      }

      addStepper.advance(); // Token B -> Add Liquidity

      let hash = '';
      if (selectedPool.type === PoolType.Stable) {
        const pool = new Contract(selectedPool.address, StablePoolABI, signer);
        const tx = await pool.addLiquidity([amt0, amt1], 0n, deadline);
        hash = tx.hash;
        await tx.wait(1);
      } else {
        const pool = new Contract(selectedPool.address, VolatilePoolABI, signer);
        const tx = await pool.addLiquidity(amt0, amt1, 0n, 0n, account, deadline);
        hash = tx.hash;
        await tx.wait(1);
      }

      addStepper.complete();
      setAmount0('');
      setAmount1('');
      fetchBalances();
      fetchPoolStats();

      // Success toast
      setToastMessage('Liquidity added!');
      setToastHash(hash);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 6000);
      setTimeout(() => { addStepper.reset();}, 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      const userRejected = message.includes('user rejected') || message.includes('ACTION_REJECTED');
      setTxError(userRejected ? 'Transaction rejected by user' : message);
      addStepper.fail();
      setTimeout(() => { addStepper.reset(); setTxError(null); }, 6000);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!signer || !account || !poolDeployed || !lpAmount) return;

    setLoading(true);
    setTxError(null);
    removeStepper.start();

    try {
      const parsedLp = parseUnits(lpAmount, 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Approve LP token to pool
      const poolAbi = selectedPool.type === PoolType.Stable ? StablePoolABI : VolatilePoolABI;
      const pool = new Contract(selectedPool.address, poolAbi, signer);
      const lpAddr = await pool.lpToken();
      const lp = new Contract(lpAddr, ERC20_ABI, signer);
      const allowance = await lp.allowance(account, selectedPool.address);
      if (allowance < parsedLp) {
        const tx = await lp.approve(selectedPool.address, parsedLp * 1000n);
        await tx.wait(1);
      }

      removeStepper.advance(); // Approve -> Remove

      let hash = '';
      if (selectedPool.type === PoolType.Stable) {
        const tx = await pool.removeLiquidity(parsedLp, [0n, 0n], deadline);
        hash = tx.hash;
        await tx.wait(1);
      } else {
        const tx = await pool.removeLiquidity(parsedLp, 0n, 0n, account, deadline);
        hash = tx.hash;
        await tx.wait(1);
      }

      removeStepper.complete();
      setLpAmount('');
      fetchBalances();
      fetchPoolStats();

      // Success toast
      setToastMessage('Liquidity removed!');
      setToastHash(hash);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 6000);
      setTimeout(() => { removeStepper.reset();}, 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      const userRejected = message.includes('user rejected') || message.includes('ACTION_REJECTED');
      setTxError(userRejected ? 'Transaction rejected by user' : message);
      removeStepper.fail();
      setTimeout(() => { removeStepper.reset(); setTxError(null); }, 6000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Liquidity</h2>
      </div>

      <div className="pool-selector">
        <label className="token-label" htmlFor="pool-select">Pool</label>
        <select
          id="pool-select"
          className="token-dropdown"
          value={POOLS.indexOf(selectedPool)}
          onChange={(e) => setSelectedPool(POOLS[parseInt(e.target.value)])}
          disabled={loading}
        >
          {POOLS.map((pool, i) => (
            <option key={i} value={i}>{pool.name}</option>
          ))}
        </select>
      </div>

      <div className="mode-toggle">
        <button
          className={`mode-btn ${mode === 'add' ? 'active' : ''}`}
          onClick={() => setMode('add')}
          disabled={loading}
        >
          Add
        </button>
        <button
          className={`mode-btn ${mode === 'remove' ? 'active' : ''}`}
          onClick={() => setMode('remove')}
          disabled={loading}
        >
          Remove
        </button>
      </div>

      {!poolDeployed && (
        <div className="notice">
          This pool is not deployed yet. Update addresses in config/contracts.ts after deployment.
        </div>
      )}

      {poolDeployed && !account && (
        <div className="notice">
          Provide USDC and USDT to earn swap fees. You'll receive LP tokens representing your share of the pool.
        </div>
      )}

      {mode === 'add' ? (
        <>
          <div className="input-group">
            <div className="input-row">
              <div className="token-select">
                <label className="token-label">{token0.symbol}</label>
                <span className="token-badge"><TokenIcon symbol={token0.symbol} size={22} />{token0.symbol}</span>
              </div>
              <div className="input-amount">
                <input
                  type="number"
                  placeholder="0.0"
                  value={amount0}
                  onChange={(e) => setAmount0(e.target.value)}
                  min="0"
                  step="any"
                  disabled={loading}
                />
                {account && (
                  <div className="balance-row">
                    <span className="balance">Balance: {parseFloat(balance0).toFixed(4)}</span>
                    <button className="btn-max" onClick={() => setAmount0(balance0)}>MAX</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="input-group">
            <div className="input-row">
              <div className="token-select">
                <label className="token-label">{token1.symbol}</label>
                <span className="token-badge"><TokenIcon symbol={token1.symbol} size={22} />{token1.symbol}</span>
              </div>
              <div className="input-amount">
                <input
                  type="number"
                  placeholder="0.0"
                  value={amount1}
                  onChange={(e) => setAmount1(e.target.value)}
                  min="0"
                  step="any"
                  disabled={loading}
                />
                {account && (
                  <div className="balance-row">
                    <span className="balance">Balance: {parseFloat(balance1).toFixed(4)}</span>
                    <button className="btn-max" onClick={() => setAmount1(balance1)}>MAX</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stepper */}
          {addStepper.active && (
            <TransactionStepper steps={addStepper.steps} onRetry={handleAddLiquidity} />
          )}

          {!account ? (
            <button className="btn btn-primary btn-full" disabled>Connect wallet</button>
          ) : !poolDeployed ? (
            <button className="btn btn-primary btn-full" disabled>Pool not deployed</button>
          ) : (
            <button
              className={`btn btn-primary btn-full${loading ? ' btn-loading' : ''}`}
              onClick={handleAddLiquidity}
              disabled={loading || (!amount0 && !amount1)}
            >
              {loading ? (
                <>
                  <svg className="btn-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Adding Liquidity...
                </>
              ) : 'Add Liquidity'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="input-group">
            <div className="input-row">
              <div className="token-select">
                <label className="token-label">LP Tokens</label>
                <span className="token-badge">
                  <span className="lp-icon-stack">
                    <TokenIcon symbol={token0.symbol} size={22} />
                    <span style={{ marginLeft: -8 }}><TokenIcon symbol={token1.symbol} size={22} /></span>
                  </span>
                  LP
                </span>
              </div>
              <div className="input-amount">
                <input
                  type="number"
                  placeholder="0.0"
                  value={lpAmount}
                  onChange={(e) => setLpAmount(e.target.value)}
                  min="0"
                  step="any"
                  disabled={loading}
                />
                {account && (
                  <div className="balance-row">
                    <span className="balance">Balance: {parseFloat(lpBalance).toFixed(6)}</span>
                    <button className="btn-max" onClick={() => setLpAmount(lpBalance)}>MAX</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stepper */}
          {removeStepper.active && (
            <TransactionStepper steps={removeStepper.steps} onRetry={handleRemoveLiquidity} />
          )}

          {!account ? (
            <button className="btn btn-primary btn-full" disabled>Connect wallet</button>
          ) : !poolDeployed ? (
            <button className="btn btn-primary btn-full" disabled>Pool not deployed</button>
          ) : (
            <button
              className={`btn btn-primary btn-full${loading ? ' btn-loading' : ''}`}
              onClick={handleRemoveLiquidity}
              disabled={loading || !lpAmount}
            >
              {loading ? (
                <>
                  <svg className="btn-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Removing Liquidity...
                </>
              ) : 'Remove Liquidity'}
            </button>
          )}
        </>
      )}

      {/* Transaction error */}
      {txError && (
        <div className="notice notice-error">{txError}</div>
      )}

      {/* Success toast */}
      {showToast && (
        <div className="toast toast-success">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{toastMessage}</span>
          {toastHash && (
            <a
              href={`${POLKADOT_HUB_TESTNET.blockExplorer}/tx/${toastHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="toast-link"
            >
              View on Explorer
            </a>
          )}
        </div>
      )}

      {/* Pool Stats */}
      {poolDeployed && poolStats && (
        <div className="pool-stats">
          <h3>Pool Info</h3>
          <div className="stat-row">
            <span>{token0.symbol} Reserve</span>
            <span>{parseFloat(poolStats.reserve0).toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span>{token1.symbol} Reserve</span>
            <span>{parseFloat(poolStats.reserve1).toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span>TVL (est.)</span>
            <span>
              ${(parseFloat(poolStats.reserve0) + parseFloat(poolStats.reserve1)).toLocaleString()}
            </span>
          </div>
          {poolStats.fee && (
            <div className="stat-row">
              <span>Swap Fee</span>
              <span>{poolStats.fee}%</span>
            </div>
          )}
          {poolStats.virtualPrice && (
            <div className="stat-row">
              <span>Virtual Price</span>
              <span>{parseFloat(poolStats.virtualPrice).toFixed(6)}</span>
            </div>
          )}
          {poolStats.ampFactor && (
            <div className="stat-row">
              <span>Amplification (A)</span>
              <span>{poolStats.ampFactor}</span>
            </div>
          )}
          {selectedPool.type === PoolType.Stable && poolStats.ampFactor && (
            <div className="stableswap-info">
              <span className="stableswap-info-label">StableSwap Advantage</span>
              <span className="stableswap-info-text">
                A={poolStats.ampFactor} concentrates liquidity around 1:1, giving 10-100x less slippage than constant-product (x*y=k) for pegged assets.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
