import { useMemo } from 'react';
import { Contract, BrowserProvider, JsonRpcProvider } from 'ethers';
import { CONTRACTS, POLKADOT_HUB_TESTNET, isZeroAddress } from '../config/contracts';
import RouterABI from '../abi/Router.json';

export function useContracts(provider: BrowserProvider | null) {
  const readProvider = useMemo(
    () => new JsonRpcProvider(POLKADOT_HUB_TESTNET.rpc),
    []
  );

  const router = useMemo(() => {
    if (isZeroAddress(CONTRACTS.ROUTER)) return null;
    const p = provider ?? readProvider;
    return new Contract(CONTRACTS.ROUTER, RouterABI, p);
  }, [provider, readProvider]);

  return { router, readProvider };
}
