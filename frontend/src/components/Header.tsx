import { POLKADOT_HUB_TESTNET } from '../config/contracts';

type Tab = 'swap' | 'liquidity' | 'dashboard';

interface HeaderProps {
  account: string | null;
  chainId: number | null;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchNetwork: () => void;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export function Header({
  account,
  chainId,
  isCorrectNetwork,
  isConnecting,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  activeTab,
  onTabChange,
}: HeaderProps) {
  const shortAddress = account
    ? `${account.slice(0, 6)}...${account.slice(-4)}`
    : '';

  return (
    <>
    <header className="header">
      <div className="header-left">
        <div className="logo-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 12 Q12 6 16 12 Q12 18 8 12Z" fill="currentColor" opacity="0.3" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </div>
        <span className="logo-text">StableSwap</span>
        <nav className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'swap' ? 'active' : ''}`}
            onClick={() => onTabChange('swap')}
          >
            Swap
          </button>
          <button
            className={`nav-tab ${activeTab === 'liquidity' ? 'active' : ''}`}
            onClick={() => onTabChange('liquidity')}
          >
            Liquidity
          </button>
          <button
            className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onTabChange('dashboard')}
          >
            Pool
          </button>
        </nav>
      </div>
      <div className="header-right">
        {account && chainId && !isCorrectNetwork && (
          <button className="btn btn-warning" onClick={onSwitchNetwork}>
            Switch to {POLKADOT_HUB_TESTNET.name}
          </button>
        )}
        {account && isCorrectNetwork && (
          <span className="network-badge">
            <span className="network-dot" />
            {POLKADOT_HUB_TESTNET.name}
          </span>
        )}
        {account ? (
          <button className="btn btn-secondary" onClick={onDisconnect}>
            {shortAddress}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onConnect} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </header>
    <div className="testnet-banner">
      Polkadot Hub TestNet
    </div>
    </>
  );
}
