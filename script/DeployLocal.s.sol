// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PoolFactory} from "../src/core/PoolFactory.sol";
import {Router} from "../src/core/Router.sol";
import {StablePool} from "../src/core/StablePool.sol";
import {VolatilePool} from "../src/core/VolatilePool.sol";

/// @notice Deploy script for local testing (Anvil) with mock tokens
contract DeployLocalScript is Script {
    function run() external {
        vm.startBroadcast();

        // Deploy mock tokens
        MockToken usdc = new MockToken("USD Coin", "USDC", 6);
        MockToken usdt = new MockToken("Tether USD", "USDT", 6);
        MockToken dot = new MockToken("Polkadot", "DOT", 18);

        console.log("USDC:", address(usdc));
        console.log("USDT:", address(usdt));
        console.log("DOT:", address(dot));

        // Deploy factory and router
        PoolFactory factory = new PoolFactory();
        Router router = new Router(address(factory));
        console.log("Factory:", address(factory));
        console.log("Router:", address(router));

        // Create pools
        address stablePool = factory.createStablePool(address(usdc), address(usdt), 85, 4e6);
        address volPoolDotUsdc = factory.createVolatilePool(address(dot), address(usdc), 30);
        address volPoolDotUsdt = factory.createVolatilePool(address(dot), address(usdt), 30);

        console.log("USDC/USDT StablePool:", stablePool);
        console.log("DOT/USDC VolatilePool:", volPoolDotUsdc);
        console.log("DOT/USDT VolatilePool:", volPoolDotUsdt);

        // Mint tokens for deployer
        usdc.mint(msg.sender, 10_000_000e6);
        usdt.mint(msg.sender, 10_000_000e6);
        dot.mint(msg.sender, 1_000_000e18);

        vm.stopBroadcast();
    }
}

contract MockToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
