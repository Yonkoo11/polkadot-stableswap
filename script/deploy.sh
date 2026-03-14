#!/bin/bash
# Deploy StableSwap DEX to Polkadot Hub TestNet
# Prerequisites:
# 1. Set PRIVATE_KEY env var (export PRIVATE_KEY=0x...)
# 2. Ensure wallet has PAS tokens from https://faucet.polkadot.io/

set -e

RPC_URL="https://services.polkadothub-rpc.com/testnet"
VERIFY_URL="https://blockscout-testnet.polkadot.io/api?"

echo "Deploying to Polkadot Hub TestNet..."
echo "RPC: $RPC_URL"
echo ""

# Deploy
forge script script/Deploy.s.sol:DeployScript \
    --rpc-url $RPC_URL \
    --broadcast \
    --verify \
    --verifier blockscout \
    --verifier-url $VERIFY_URL \
    -vvv

echo ""
echo "Deployment complete! Update frontend/src/config/contracts.ts with the deployed addresses."
