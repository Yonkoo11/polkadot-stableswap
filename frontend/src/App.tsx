import { useState, useEffect } from 'react';
import { useWallet } from './hooks/useWallet';
import { useContracts } from './hooks/useContracts';
import { Header } from './components/Header';
import { SwapPanel } from './components/SwapPanel';
import { LiquidityPanel } from './components/LiquidityPanel';
import { Dashboard } from './components/Dashboard';
import './App.css';

type Tab = 'swap' | 'liquidity' | 'dashboard';

function App() {
  const wallet = useWallet();
  const { router, readProvider } = useContracts(wallet.provider);
  const [activeTab, setActiveTab] = useState<Tab>('swap');

  // Mouse-reactive background orbs
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      document.documentElement.style.setProperty('--mx', String(x));
      document.documentElement.style.setProperty('--my', String(y));
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  return (
    <div className="app">
      <div className="bg-aurora" aria-hidden="true">
        <div className="bg-orb bg-orb--1" />
        <div className="bg-orb bg-orb--2" />
        <div className="bg-orb bg-orb--3" />
        <div className="bg-orb bg-orb--4" />
      </div>
      <Header
        account={wallet.account}
        chainId={wallet.chainId}
        isCorrectNetwork={wallet.isCorrectNetwork}
        isConnecting={wallet.isConnecting}
        onConnect={wallet.connect}
        onDisconnect={wallet.disconnect}
        onSwitchNetwork={wallet.switchNetwork}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {wallet.error && (
        <div className="global-error">{wallet.error}</div>
      )}

      <main className={`main${activeTab === 'dashboard' ? ' main--dashboard' : ''}`}>
        {activeTab === 'swap' && (
          <SwapPanel
            signer={wallet.signer}
            account={wallet.account}
            router={router}
          />
        )}
        {activeTab === 'liquidity' && (
          <LiquidityPanel
            signer={wallet.signer}
            account={wallet.account}
            readProvider={readProvider}
          />
        )}
        {activeTab === 'dashboard' && (
          <Dashboard
            readProvider={readProvider}
            account={wallet.account}
            signer={wallet.signer}
          />
        )}
      </main>

      <footer className="footer">
        <div>
          <span>StableSwap on Polkadot Hub</span>
          <div className="footer-built">First native StableSwap on Polkadot Hub</div>
        </div>
        <div className="footer-links">
          <a href="https://blockscout-testnet.polkadot.io/address/0x6c70b98613Cc567e3c1FeE9248aE58d291e3AfFA" target="_blank" rel="noopener noreferrer">Contracts</a>
          <span className="footer-sep">|</span>
          <a href="https://github.com/Yonkoo11/polkadot-stableswap" target="_blank" rel="noopener noreferrer">GitHub</a>
          <span className="footer-sep">|</span>
          <span className="footer-dot">Polkadot Solidity Hackathon 2026</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
