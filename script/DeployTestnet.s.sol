// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PoolFactory} from "../src/core/PoolFactory.sol";
import {Router} from "../src/core/Router.sol";
import {StablePool} from "../src/core/StablePool.sol";
import {VolatilePool} from "../src/core/VolatilePool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployTestnet
/// @notice Full testnet deployment: mock tokens + pools + factory + router + seed liquidity
/// @dev Native asset precompiles (asset IDs 1337/1984) don't exist on testnet,
///      so we deploy our own ERC-20 tokens to demonstrate the protocol.
contract DeployTestnetScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);

        // ========== 1. Deploy Mock Tokens ==========
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        console.log("USDC (Mock):", address(usdc));

        MockERC20 usdt = new MockERC20("Tether USD", "USDT", 6);
        console.log("USDT (Mock):", address(usdt));

        // ========== 2. Deploy Factory ==========
        PoolFactory factory = new PoolFactory();
        console.log("PoolFactory:", address(factory));

        // ========== 3. Deploy Router ==========
        Router router = new Router(address(factory));
        console.log("Router:", address(router));

        // ========== 4. Deploy StablePool (USDC/USDT) ==========
        StablePool stablePool = new StablePool(
            address(usdc),
            address(usdt),
            85, // A = 85
            4e6, // fee = 0.04%
            5e9, // adminFee = 50%
            "USDC-USDT StableSwap LP",
            "ssLP"
        );
        console.log("StablePool:", address(stablePool));

        // ========== 5. Register pool in factory ==========
        factory.registerStablePool(address(usdc), address(usdt), address(stablePool));

        // ========== 6. Mint tokens and seed liquidity ==========
        // Mint 100,000 USDC and 100,000 USDT for the deployer
        usdc.mint(deployer, 100_000e6);
        usdt.mint(deployer, 100_000e6);

        // Approve and seed 10,000 of each into the stable pool
        usdc.approve(address(stablePool), type(uint256).max);
        usdt.approve(address(stablePool), type(uint256).max);
        stablePool.addLiquidity([uint256(10_000e6), uint256(10_000e6)], 0, block.timestamp + 3600);
        console.log("Seeded StablePool with 10,000 USDC + 10,000 USDT");

        // Log remaining balances for the deployer (for demo swaps)
        console.log("Deployer USDC balance:", usdc.balanceOf(deployer));
        console.log("Deployer USDT balance:", usdt.balanceOf(deployer));

        vm.stopBroadcast();

        // ========== Summary ==========
        console.log("");
        console.log("=== DEPLOYMENT SUMMARY ===");
        console.log("USDC:       ", address(usdc));
        console.log("USDT:       ", address(usdt));
        console.log("PoolFactory:", address(factory));
        console.log("Router:     ", address(router));
        console.log("StablePool: ", address(stablePool));
        console.log("Liquidity:   10,000 USDC + 10,000 USDT");
        console.log("==========================");
    }
}
