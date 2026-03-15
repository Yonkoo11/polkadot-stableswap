import { useState, useCallback, useEffect } from 'react';
import { BrowserProvider, JsonRpcSigner } from 'ethers';
import { POLKADOT_HUB_TESTNET } from '../config/contracts';

interface WalletState {
  account: string | null;
  chainId: number | null;
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    account: null,
    chainId: null,
    provider: null,
    signer: null,
    isCorrectNetwork: false,
    isConnecting: false,
    error: null,
  });

  const updateChainState = useCallback(async (provider: BrowserProvider) => {
    try {
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      const signer = await provider.getSigner();
      const account = await signer.getAddress();
      setState(prev => ({
        ...prev,
        account,
        chainId,
        provider,
        signer,
        isCorrectNetwork: chainId === POLKADOT_HUB_TESTNET.chainId,
        error: null,
      }));
    } catch (err) {
      console.error('Failed to update chain state:', err);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setState(prev => ({ ...prev, error: 'MetaMask not detected. Please install MetaMask.' }));
      return;
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      await updateChainState(provider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      setState(prev => ({ ...prev, error: message }));
    } finally {
      setState(prev => ({ ...prev, isConnecting: false }));
    }
  }, [updateChainState]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;

    const chainParams = {
      chainId: POLKADOT_HUB_TESTNET.chainIdHex,
      chainName: POLKADOT_HUB_TESTNET.name,
      rpcUrls: [POLKADOT_HUB_TESTNET.rpc],
      nativeCurrency: POLKADOT_HUB_TESTNET.nativeCurrency,
      blockExplorerUrls: [POLKADOT_HUB_TESTNET.blockExplorer],
    };

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainParams.chainId }],
      });
    } catch {
      // Chain not added yet - try adding it regardless of error code
      // (MetaMask uses 4902, but other wallets may differ)
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [chainParams],
        });
      } catch (addError) {
        console.error('Failed to add network:', addError);
        setState(prev => ({ ...prev, error: 'Failed to add Polkadot Hub TestNet. Please add it manually in MetaMask.' }));
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      account: null,
      chainId: null,
      provider: null,
      signer: null,
      isCorrectNetwork: false,
      isConnecting: false,
      error: null,
    });
  }, []);

  // Listen for account and chain changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        disconnect();
      } else if (state.provider) {
        updateChainState(state.provider);
      }
    };

    const handleChainChanged = () => {
      if (state.account) {
        const provider = new BrowserProvider(window.ethereum!);
        updateChainState(provider);
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [state.provider, state.account, disconnect, updateChainState]);

  // Auto-connect if already connected
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((result: unknown) => {
        const accounts = result as string[];
        if (accounts.length > 0) {
          const provider = new BrowserProvider(window.ethereum!);
          updateChainState(provider);
        }
      });
    }
  }, [updateChainState]);

  return {
    ...state,
    connect,
    disconnect,
    switchNetwork,
  };
}

// Extend Window for MetaMask
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
