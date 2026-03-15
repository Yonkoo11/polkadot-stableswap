import { useState, useEffect, useCallback } from 'react';
import { Contract, parseUnits, formatUnits, JsonRpcSigner } from 'ethers';
import { TOKENS, CONTRACTS, POLKADOT_HUB_TESTNET, isZeroAddress, ERC20_ABI, PoolType } from '../config/contracts';
import { TokenSelect } from './TokenSelect';
import { Settings } from './Settings';
import { TransactionStepper } from './TransactionStepper';
import { useTransactionSteps } from '../hooks/useTransactionSteps';
import { RateIndicator } from './RateIndicator';
import RouterABI from '../abi/Router.json';

interface SwapPanelProps {
  signer: JsonRpcSigner | null;
  account: string | null;
  router: Contract | null;
}

function getPriceImpactTier(impact: number): { className: string; level: string } {
  if (impact < 0.1) return { className: 'impact-excellent', level: 'excellent' };
  if (impact < 0.5) return { className: 'impact-normal', level: 'normal' };
  if (impact < 1) return { className: 'impact-caution', level: 'caution' };
  if (impact < 3) return { className: 'impact-high', level: 'high' };
  return { className: 'impact-dangerous', level: 'dangerous' };
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
  const [priceImpact, setPriceImpact] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastHash, setToastHash] = useState<string | null>(null);
  const [confirmHighImpact, setConfirmHighImpact] = useState(false);

  const stepper = useTransactionSteps(['Approve', 'Swap', 'Done']);
  const contractsDeployed = !isZeroAddress(CONTRACTS.ROUTER);

  const impactVal = priceImpact ? parseFloat(priceImpact) : 0;
  const impactTier = getPriceImpactTier(impactVal);
  const insufficientBalance = amountIn && parseFloat(amountIn) > parseFloat(balanceIn);
  const needsHighImpactConfirm = impactVal > 5 && !confirmHighImpact;

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

        const inVal = parseFloat(amountIn);
        const outVal = parseFloat(formatUnits(outputAmount, tokenOutInfo.decimals));
        if (inVal > 0 && outVal > 0) {
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

  // Reset high impact confirm when inputs change
  useEffect(() => {
    setConfirmHighImpact(false);
  }, [amountIn, tokenIn, tokenOut]);

  const handleSwap = async () => {
    if (!signer || !account || !amountIn || !amountOut) return;
    if (isZeroAddress(CONTRACTS.ROUTER)) return;

    setLoading(true);
    stepper.start();

    try {
      const tokenInInfo = TOKENS[tokenIn];
      const tokenOutInfo = TOKENS[tokenOut];
      const parsedAmountIn = parseUnits(amountIn, tokenInInfo.decimals);
      const parsedAmountOut = parseUnits(amountOut, tokenOutInfo.decimals);
      const minOut = parsedAmountOut * BigInt(Math.floor((1 - slippage / 100) * 10000)) / 10000n;

      // Approve token
      const erc20 = new Contract(tokenInInfo.address, ERC20_ABI, signer);
      const allowance = await erc20.allowance(account, CONTRACTS.ROUTER);
      if (allowance < parsedAmountIn) {
        const approveAmount = parsedAmountIn * 1000n;
        const approveTx = await erc20.approve(CONTRACTS.ROUTER, approveAmount);
        await approveTx.wait(1);
      }

      stepper.advance(); // Approve -> Swap

      // Execute swap
      const routerWithSigner = new Contract(CONTRACTS.ROUTER, RouterABI, signer);
      const routes = [{
        tokenIn: tokenInInfo.address,
        tokenOut: tokenOutInfo.address,
        poolType: getPoolType(),
      }];
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

      const tx = await routerWithSigner.swapExactIn(
        routes,
        parsedAmountIn,
        minOut,
        account,
        deadline
      );
      await tx.wait(1);

      stepper.complete(); // All done

      setAmountIn('');
      setAmountOut('');
      fetchBalances();

      // Show success toast
      setToastHash(tx.hash);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 6000);

      setTimeout(() => {
        stepper.reset();
      }, 3000);
    } catch {
      stepper.fail();
      // Show error briefly, then reset
      setTimeout(() => {
        stepper.reset();
      }, 4000);
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

  const poolType = getPoolType();
  const feePercent = poolType === PoolType.Stable ? '0.04' : '0.30';
  const rate = amountIn && amountOut && parseFloat(amountIn) > 0
    ? (parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6)
    : null;

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

      {/* Input: You pay */}
      <div className={`input-group${insufficientBalance ? ' input-error' : ''}`}>
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
              className={insufficientBalance ? 'input-text-error' : ''}
              disabled={loading}
            />
            {account && (
              <div className="balance-row">
                <span className="balance">Balance: {parseFloat(balanceIn).toFixed(4)}</span>
                <button className="btn-max" onClick={handleMaxIn}>MAX</button>
              </div>
            )}
            {insufficientBalance && (
              <span className="inline-error">Insufficient {tokenIn} balance</span>
            )}
          </div>
        </div>
      </div>

      <div className="flip-container">
        <button className="btn-flip" onClick={handleFlip} title="Swap direction" disabled={loading}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* Output: You receive */}
      <div className="input-group">
        <div className="input-row">
          <TokenSelect
            selected={tokenOut}
            onChange={setTokenOut}
            exclude={tokenIn}
            label="You receive"
          />
          <div className="input-amount">
            {quoting ? (
              <div className="shimmer-wrapper">
                <div className="shimmer-box" />
                <span className="shimmer-label">Fetching quote...</span>
              </div>
            ) : (
              <input
                type="text"
                placeholder="0.0"
                value={amountOut}
                readOnly
              />
            )}
            {account && (
              <div className="balance-row">
                <span className="balance">Balance: {parseFloat(balanceOut).toFixed(4)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible swap details (Uniswap-style) */}
      {rate && (
        <div className="swap-details-accordion">
          <button className="swap-details-header" onClick={() => setDetailsOpen(!detailsOpen)}>
            <span className="swap-rate-preview">
              1 {tokenIn} = {rate} {tokenOut}
            </span>
            <svg className={`chevron ${detailsOpen ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {detailsOpen && (
            <div className="swap-details-body">
              <div className="swap-detail">
                <span>Route</span>
                <span>{tokenIn} → {tokenOut} via {poolType === PoolType.Stable ? 'StablePool' : 'VolatilePool'} ({feePercent}% fee)</span>
              </div>

              {priceImpact && (
                <div className="swap-detail">
                  <span>Price Impact</span>
                  <span className={impactTier.className}>
                    {(impactTier.level === 'caution' || impactTier.level === 'high' || impactTier.level === 'dangerous') && (
                      <svg className="warning-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    )}
                    {priceImpact}%
                  </span>
                </div>
              )}

              <div className="swap-detail">
                <span>Min. received ({slippage}% slippage)</span>
                <span>{(parseFloat(amountOut) * (1 - slippage / 100)).toFixed(6)} {tokenOut}</span>
              </div>

              <div className="swap-detail">
                <span>Network fee</span>
                <span>~0.001 DOT</span>
              </div>

              <div className="swap-detail">
                <span>LP fee</span>
                <span>{feePercent}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* High price impact warning banner */}
      {impactVal > 3 && amountOut && (
        <div className="impact-warning-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>Price impact is very high ({priceImpact}%). You may receive significantly fewer tokens.</span>
        </div>
      )}

      {/* Transaction stepper */}
      {stepper.active && (
        <TransactionStepper steps={stepper.steps} onRetry={handleSwap} />
      )}

      {/* Action button */}
      {!account ? (
        <>
          <div className="notice" style={{ textAlign: 'center', lineHeight: 1.6 }}>
            Direct stablecoin swaps on Polkadot Hub with near-zero slippage.
            The built-in pallet can't swap USDC for USDT directly. We fixed that.
          </div>
          <button className="btn btn-primary btn-full" disabled>
            Connect wallet to swap
          </button>
          <RateIndicator />
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
      ) : insufficientBalance ? (
        <button className="btn btn-primary btn-full btn-error-disabled" disabled>
          Insufficient {tokenIn} balance
        </button>
      ) : needsHighImpactConfirm ? (
        <button
          className="btn btn-full btn-danger"
          onClick={() => setConfirmHighImpact(true)}
        >
          Swap Anyway (High Impact)
        </button>
      ) : (
        <button
          className={`btn btn-primary btn-full${loading ? ' btn-loading' : ''}`}
          onClick={handleSwap}
          disabled={loading || !amountOut}
        >
          {loading ? (
            <>
              <svg className="btn-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Processing...
            </>
          ) : `Swap ${parseFloat(amountIn).toFixed(2)} ${tokenIn} for ~${parseFloat(amountOut).toFixed(2)} ${tokenOut}`}
        </button>
      )}

      {/* Success toast */}
      {showToast && (
        <div className="toast toast-success">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Swap successful!</span>
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
    </div>
  );
}
