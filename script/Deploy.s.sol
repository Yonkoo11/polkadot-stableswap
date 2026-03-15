// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PoolFactory} from "../src/core/PoolFactory.sol";
import {Router} from "../src/core/Router.sol";
import {StablePool} from "../src/core/StablePool.sol";

contract DeployScript is Script {
    // Polkadot Hub native asset ERC-20 precompile addresses
    address constant USDC = 0x0000053900000000000000000000000001200000;
    address constant USDT = 0x000007c000000000000000000000000001200000;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Factory (registry only, no embedded pool bytecode)
        PoolFactory factory = new PoolFactory();
        console.log("PoolFactory:", address(factory));

        // 2. Deploy Router
        Router router = new Router(address(factory));
        console.log("Router:", address(router));

        // 3. Deploy USDC/USDT StablePool directly
        StablePool stablePool = new StablePool(
            USDC,
            USDT,
            85, // A = 85
            4e6, // fee = 0.04%
            5e9, // adminFee = 50%
            "USDC-USDT StableSwap LP",
            "ssLP"
        );
        console.log("StablePool:", address(stablePool));

        // 4. Register pool in factory
        factory.registerStablePool(USDC, USDT, address(stablePool));

        vm.stopBroadcast();
    }
}
