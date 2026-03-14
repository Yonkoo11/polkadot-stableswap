import { useState, useEffect, useCallback } from 'react';
import { Contract, parseUnits, formatUnits, JsonRpcSigner } from 'ethers';
import { TOKENS, POOLS, PoolType, POLKADOT_HUB_TESTNET, isZeroAddress, ERC20_ABI } from '../config/contracts';
import type { PoolConfig } from '../config/contracts';
import { TokenIcon } from './TokenSelect';
import StablePoolABI from '../abi/StablePool.json';
import VolatilePoolABI from '../abi/VolatilePool.json';

interface LiquidityPanelProps {
  signer: JsonRpcSigner | null;
  account: string | null;
}

export function LiquidityPanel({ signer, account }: LiquidityPanelProps) {
  const [selectedPool, setSelectedPool] = useState<PoolConfig>(POOLS[0]);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [lpAmount, setLpAmount] = useState('');
  const [balance0, setBalance0] = useState('0');
  const [balance1, setBalance1] = useState('0');
  const [lpBalance, setLpBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [poolStats, setPoolStats] = useState<{
    reserve0: string;
    reserve1: string;
    virtualPrice?: string;
    fee?: string;
    ampFactor?: string;
  } | null>(null);

  const token0 = TOKENS[selectedPool.token0Symbol];
  const token1 = TOKENS[selectedPool.token1Symbol];
  const poolDeployed = !isZeroAddress(selectedPool.address);

  // Fetch pool stats
  const fetchPoolStats = useCallback(async () => {
    if (!poolDeployed || !signer) return;

    try {
      if (selectedPool.type === PoolType.Stable) {
        const pool = new Contract(selectedPool.address, StablePoolABI, signer);
        const [b0, b1, vp, fee, a] = await Promise.all([
          pool.getTokenBalance(0),
          pool.getTokenBalance(1),
          pool.getVirtualPrice().catch(() => 0n),
          pool.fee(),
          pool.getA(),
        ]);
        setPoolStats({
          reserve0: formatUnits(b0, token0.decimals),
          reserve1: formatUnits(b1, token1.decimals),
          virtualPrice: formatUnits(vp, 18),
          fee: (Number(fee) / 1e8).toFixed(4),
          ampFactor: a.toString(),
        });
      } else {
        const pool = new Contract(selectedPool.address, VolatilePoolABI, signer);
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
  }, [selectedPool, signer, poolDeployed, token0.decimals, token1.decimals]);

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
    setTxStatus('Approving tokens...');

    try {
      const amt0 = parseUnits(amount0 || '0', token0.decimals);
      const amt1 = parseUnits(amount1 || '0', token1.decimals);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      // Approve both tokens
      for (const [token, amt] of [[token0, amt0], [token1, amt1]] as [typeof token0, bigint][]) {
        if (amt > 0n && !isZeroAddress(token.address)) {
          const erc20 = new Contract(token.address, ERC20_ABI, signer);
          const allowance = await erc20.allowance(account, selectedPool.address);
          if (allowance < amt) {
            const tx = await erc20.approve(selectedPool.address, amt * 1000n);
            await tx.wait(1);
          }
        }
      }

      setTxStatus('Adding liquidity...');

      if (selectedPool.type === PoolType.Stable) {
        const pool = new Contract(selectedPool.address, StablePoolABI, signer);
        const tx = await pool.addLiquidity([amt0, amt1], 0n, deadline);
        setTxHash(tx.hash);
        setTxStatus('Waiting for confirmation...');
        await tx.wait(1);
      } else {
        const pool = new Contract(selectedPool.address, VolatilePoolABI, signer);
        const tx = await pool.addLiquidity(amt0, amt1, 0n, 0n, account, deadline);
        setTxHash(tx.hash);
        setTxStatus('Waiting for confirmation...');
        await tx.wait(1);
      }

      setTxStatus('Liquidity added!');
      setAmount0('');
      setAmount1('');
      fetchBalances();
      fetchPoolStats();
      setTimeout(() => { setTxStatus(null); setTxHash(null); }, 8000);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Transaction failed';
      const message = raw.includes('user rejected') || raw.includes('ACTION_REJECTED')
        ? 'Transaction rejected by user'
        : raw.includes('insufficient funds')
          ? 'Insufficient gas (DOT) for transaction'
          : raw.slice(0, 120);
      setTxStatus(`Error: ${message}`);
      setTimeout(() => setTxStatus(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!signer || !account || !poolDeployed || !lpAmount) return;

    setLoading(true);
    setTxStatus('Approving LP token...');

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

      setTxStatus('Removing liquidity...');

      if (selectedPool.type === PoolType.Stable) {
        const tx = await pool.removeLiquidity(parsedLp, [0n, 0n], deadline);
        setTxHash(tx.hash);
        setTxStatus('Waiting for confirmation...');
        await tx.wait(1);
      } else {
        const tx = await pool.removeLiquidity(parsedLp, 0n, 0n, account, deadline);
        setTxHash(tx.hash);
        setTxStatus('Waiting for confirmation...');
        await tx.wait(1);
      }

      setTxStatus('Liquidity removed!');
      setLpAmount('');
      fetchBalances();
      fetchPoolStats();
      setTimeout(() => { setTxStatus(null); setTxHash(null); }, 8000);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Transaction failed';
      const message = raw.includes('user rejected') || raw.includes('ACTION_REJECTED')
        ? 'Transaction rejected by user'
        : raw.includes('insufficient funds')
          ? 'Insufficient gas (DOT) for transaction'
          : raw.slice(0, 120);
      setTxStatus(`Error: ${message}`);
      setTimeout(() => setTxStatus(null), 5000);
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
        <label className="token-label">Pool</label>
        <select
          className="token-dropdown"
          value={POOLS.indexOf(selectedPool)}
          onChange={(e) => setSelectedPool(POOLS[parseInt(e.target.value)])}
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
        >
          Add
        </button>
        <button
          className={`mode-btn ${mode === 'remove' ? 'active' : ''}`}
          onClick={() => setMode('remove')}
        >
          Remove
        </button>
      </div>

      {!poolDeployed && (
        <div className="notice">
          This pool is not deployed yet. Update addresses in config/contracts.ts after deployment.
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

          {!account ? (
            <button className="btn btn-primary btn-full" disabled>Connect wallet</button>
          ) : !poolDeployed ? (
            <button className="btn btn-primary btn-full" disabled>Pool not deployed</button>
          ) : (
            <button
              className="btn btn-primary btn-full"
              onClick={handleAddLiquidity}
              disabled={loading || (!amount0 && !amount1)}
            >
              {loading ? txStatus || 'Processing...' : 'Add Liquidity'}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="input-group">
            <div className="input-row">
              <div className="token-select">
                <label className="token-label">LP Tokens</label>
                <span className="token-badge">LP</span>
              </div>
              <div className="input-amount">
                <input
                  type="number"
                  placeholder="0.0"
                  value={lpAmount}
                  onChange={(e) => setLpAmount(e.target.value)}
                  min="0"
                  step="any"
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

          {!account ? (
            <button className="btn btn-primary btn-full" disabled>Connect wallet</button>
          ) : !poolDeployed ? (
            <button className="btn btn-primary btn-full" disabled>Pool not deployed</button>
          ) : (
            <button
              className="btn btn-primary btn-full"
              onClick={handleRemoveLiquidity}
              disabled={loading || !lpAmount}
            >
              {loading ? txStatus || 'Processing...' : 'Remove Liquidity'}
            </button>
          )}
        </>
      )}

      {txStatus && !loading && (
        <div className={`tx-status ${txStatus.startsWith('Error') ? 'tx-error' : 'tx-success'}`}>
          {txStatus}
          {txHash && (
            <a
              href={`${POLKADOT_HUB_TESTNET.blockExplorer}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tx-link"
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
