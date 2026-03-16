// Contract addresses — deployed on Polkadot Hub TestNet (chain 420420417)
export const CONTRACTS = {
  ROUTER: '0x6c70b98613Cc567e3c1FeE9248aE58d291e3AfFA',
  FACTORY: '0x9A6d36A0487EA52df43E7704a97F47844C4Eac4E',
  STABLE_POOL_USDC_USDT: '0xDeA0792cEc959CE6893C24dEeFc6FE9B047a3Ea3',
  VOLATILE_POOL_DOT_USDC: '0x0000000000000000000000000000000000000000',
} as const;

// Token addresses — Mock ERC-20 tokens deployed on testnet
// Native asset precompiles (asset IDs 1337/1984) don't exist on testnet,
// so we deploy our own ERC-20 tokens to demonstrate the protocol.
export const TOKENS: Record<string, TokenInfo> = {
  USDC: {
    address: '0xf9e5a9E147856D9B26aB04202D79C2c3dA4a326B',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  USDT: {
    address: '0xb8F4546e24e437779bC09c3b70ce70Ff9542bdD4',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
};

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const POLKADOT_HUB_TESTNET = {
  chainId: 420420417,
  chainIdHex: '0x190f1b41',
  name: 'Polkadot Hub TestNet',
  rpc: 'https://eth-rpc-testnet.polkadot.io/',
  blockExplorer: 'https://blockscout-testnet.polkadot.io',
  nativeCurrency: {
    name: 'DOT',
    symbol: 'DOT',
    decimals: 18,
  },
};

// Pool type enum matching the contract
export const PoolType = {
  Stable: 0,
  Volatile: 1,
} as const;

export type PoolType = (typeof PoolType)[keyof typeof PoolType];

export interface Route {
  tokenIn: string;
  tokenOut: string;
  poolType: PoolType;
}

// Pool definitions for the UI
export interface PoolConfig {
  address: string;
  type: PoolType;
  token0Symbol: string;
  token1Symbol: string;
  name: string;
}

export const POOLS: PoolConfig[] = [
  {
    address: CONTRACTS.STABLE_POOL_USDC_USDT,
    type: PoolType.Stable,
    token0Symbol: 'USDC',
    token1Symbol: 'USDT',
    name: 'USDC/USDT (Stable)',
  },
];

export const isZeroAddress = (addr: string) =>
  addr === '0x0000000000000000000000000000000000000000';

// ERC20 minimal ABI for balance/approve
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];
