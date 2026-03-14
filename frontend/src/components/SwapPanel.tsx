import { useState, useEffect, useCallback } from 'react';
import { Contract, parseUnits, formatUnits, JsonRpcSigner } from 'ethers';
import { TOKENS, CONTRACTS, POLKADOT_HUB_TESTNET, isZeroAddress, ERC20_ABI, PoolType } from '../config/contracts';
import { TokenSelect } from './TokenSelect';
import { Settings } from './Settings';
import RouterABI from '../abi/Router.json';

interface SwapPanelProps {
  signer: JsonRpcSigner | null;
  account: string | null;
  router: Contract | null;
}

export function SwapPanel({ signer, account, router }: SwapPanelProps) {
  const [tokenIn, setTokenIn] = useState('USDC');
  const [tokenOut, setTokenOut] = useState('USDT');
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [balanceIn, setBalanceIn] = useState('0');
  const [balanceOut, setBalanceOut] = useState('0');
  const [slippage, setSlippage] = useState(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [priceImpact, setPriceImpact] = useState<string | null>(null);

  const contractsDeployed = !isZeroAddress(CONTRACTS.ROUTER);

  // Fetch balances
  const fetchBalances = useCallback(async () => {
    if (!account || !signer) return;

    for (const [symbol, setBalance] of [
      [tokenIn, setBalanceIn],
      [tokenOut, setBalanceOut],
    ] as [string, React.Dispatch<React.SetStateAction<string>>][]) {
      const token = TOKENS[symbol];
      if (isZeroAddress(token.address)) {
        setBalance('0');
        continue;
      }
      try {
        const erc20 = new Contract(token.address, ERC20_ABI, signer);
        const bal = await erc20.balanceOf(account);
        setBalance(formatUnits(bal, token.decimals));
      } catch {
        setBalance('0');
      }
    }
  }, [account, signer, tokenIn, tokenOut]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // Determine pool type for this pair
  const getPoolType = useCallback((): PoolType => {
    // Stablecoins swap via stable pool
    const stables = ['USDC', 'USDT'];
    if (stables.includes(tokenIn) && stables.includes(tokenOut)) {
      return PoolType.Stable;
    }
    return PoolType.Volatile;
  }, [tokenIn, tokenOut]);

  // Get quote
  useEffect(() => {
    const getQuote = async () => {
      if (!amountIn || !router || parseFloat(amountIn) === 0) {
        setAmountOut('');
        setPriceImpact(null);
        return;
      }

      setQuoting(true);
      try {
        const tokenInInfo = TOKENS[tokenIn];
        const tokenOutInfo = TOKENS[tokenOut];
        const parsedAmount = parseUnits(amountIn, tokenInInfo.decimals);

        const routes = [{
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          poolType: getPoolType(),
        }];

        const amounts = await router.getAmountsOut(routes, parsedAmount);
        const outputAmount = amounts[amounts.length - 1];
        setAmountOut(formatUnits(outputAmount, tokenOutInfo.decimals));

        // Simple price impact estimate
        const inVal = parseFloat(amountIn);
        const outVal = parseFloat(formatUnits(outputAmount, tokenOutInfo.decimals));
        if (inVal > 0 && outVal > 0) {
          // For stable pairs, impact = deviation from 1:1
          // For volatile pairs, this is just a rough indicator
          const poolType = getPoolType();
          if (poolType === PoolType.Stable) {
            const impact = Math.abs(1 - outVal / inVal) * 100;
            setPriceImpact(impact.toFixed(3));
          } else {
            setPriceImpact(null);
          }
        }
      } catch (err) {
        console.error('Quote failed:', err);
        setAmountOut('');
        setPriceImpact(null);
      } finally {
        setQuoting(false);
      }
    };

    const timer = setTimeout(getQuote, 600);
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn, tokenOut, router, getPoolType]);

  const handleSwap = async () => {
    if (!signer || !account || !amountIn || !amountOut) return;
    if (isZeroAddress(CONTRACTS.ROUTER)) return;

    setLoading(true);
    setTxStatus('Approving token...');

    try {
      const tokenInInfo = TOKENS[tokenIn];
      const tokenOutInfo = TOKENS[tokenOut];
      const parsedAmountIn = parseUnits(amountIn, tokenInInfo.decimals);
      const parsedAmountOut = parseUnits(amountOut, tokenOutInfo.decimals);

      // Calculate min amount out with slippage
      const minOut = parsedAmountOut * BigInt(Math.floor((1 - slippage / 100) * 10000)) / 10000n;

      // Approve token
      const erc20 = new Contract(tokenInInfo.address, ERC20_ABI, signer);
      const allowance = await erc20.allowance(account, CONTRACTS.ROUTER);
      if (allowance < parsedAmountIn) {
        const approveAmount = parsedAmountIn * 1000n; // approve 1000x to avoid re-approving
        const approveTx = await erc20.approve(CONTRACTS.ROUTER, approveAmount);
        setTxStatus('Waiting for approval confirmation...');
        await approveTx.wait(1);
      }

      // Execute swap
      setTxStatus('Swapping...');
      const routerWithSigner = new Contract(CONTRACTS.ROUTER, RouterABI, signer);
      const routes = [{
        tokenIn: tokenInInfo.address,
        tokenOut: tokenOutInfo.address,
        poolType: getPoolType(),
      }];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

      const tx = await routerWithSigner.swapExactIn(
        routes,
        parsedAmountIn,
        minOut,
        account,
        deadline
      );
      setTxHash(tx.hash);
      setTxStatus('Waiting for confirmation...');
      await tx.wait(1);

      setTxStatus('Swap successful!');
      setAmountIn('');
      setAmountOut('');
      fetchBalances();

      setTimeout(() => { setTxStatus(null); setTxHash(null); }, 8000);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Swap failed';
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

  const handleFlip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut);
    setAmountOut('');
  };

  const handleMaxIn = () => {
    setAmountIn(balanceIn);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Swap</h2>
        <button
          className="btn-icon"
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {showSettings && (
        <Settings slippage={slippage} onSlippageChange={setSlippage} onClose={() => setShowSettings(false)} />
      )}

      {!contractsDeployed && (
        <div className="notice">
          Contracts not deployed yet. Update addresses in config/contracts.ts after deployment.
        </div>
      )}

      <div className="input-group">
        <div className="input-row">
          <TokenSelect
            selected={tokenIn}
            onChange={setTokenIn}
            exclude={tokenOut}
            label="You pay"
          />
          <div className="input-amount">
            <input
              type="number"
              placeholder="0.0"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              min="0"
              step="any"
            />
            {account && (
              <div className="balance-row">
                <span className="balance">Balance: {parseFloat(balanceIn).toFixed(4)}</span>
                <button className="btn-max" onClick={handleMaxIn}>MAX</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flip-container">
        <button className="btn-flip" onClick={handleFlip} title="Swap direction">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      <div className="input-group">
        <div className="input-row">
          <TokenSelect
            selected={tokenOut}
            onChange={setTokenOut}
            exclude={tokenIn}
            label="You receive"
          />
          <div className="input-amount">
            <input
              type="text"
              placeholder="0.0"
              value={quoting ? '...' : amountOut}
              readOnly
            />
            {account && (
              <div className="balance-row">
                <span className="balance">Balance: {parseFloat(balanceOut).toFixed(4)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {priceImpact && (
        <div className="swap-detail">
          <span>Price Impact</span>
          <span className={parseFloat(priceImpact) > 1 ? 'text-warning' : ''}>{priceImpact}%</span>
        </div>
      )}

      {amountIn && amountOut && (
        <div className="swap-detail">
          <span>Rate</span>
          <span>1 {tokenIn} = {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6)} {tokenOut}</span>
        </div>
      )}

      {amountIn && amountOut && (
        <div className="swap-detail">
          <span>Min. received ({slippage}% slippage)</span>
          <span>{(parseFloat(amountOut) * (1 - slippage / 100)).toFixed(6)} {tokenOut}</span>
        </div>
      )}

      {!account ? (
        <>
          <div className="notice" style={{ textAlign: 'center', lineHeight: 1.6 }}>
            Direct stablecoin swaps on Polkadot Hub with near-zero slippage.
            The built-in pallet can't swap USDC for USDT directly. We fixed that.
          </div>
          <button className="btn btn-primary btn-full" disabled>
            Connect wallet to swap
          </button>
          <div className="stableswap-info" style={{ marginTop: 4 }}>
            <span className="stableswap-info-label">Curve-style StableSwap</span>
            <span className="stableswap-info-text">
              Uses the StableSwap invariant (A=85) for 10-100x less slippage than Uniswap V2 on pegged assets. First native StableSwap on Polkadot Hub.
            </span>
          </div>
        </>
      ) : !contractsDeployed ? (
        <button className="btn btn-primary btn-full" disabled>
          Contracts not deployed
        </button>
      ) : !amountIn || parseFloat(amountIn) === 0 ? (
        <button className="btn btn-primary btn-full" disabled>
          Enter an amount
        </button>
      ) : parseFloat(amountIn) > parseFloat(balanceIn) ? (
        <button className="btn btn-primary btn-full" disabled>
          Insufficient {tokenIn} balance
        </button>
      ) : (
        <button
          className="btn btn-primary btn-full"
          onClick={handleSwap}
          disabled={loading || !amountOut}
        >
          {loading ? txStatus || 'Processing...' : `Swap ${tokenIn} for ${tokenOut}`}
        </button>
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
    </div>
  );
}
