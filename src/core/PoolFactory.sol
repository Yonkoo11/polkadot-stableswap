// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";

/// @title PoolFactory
/// @notice Registry for StableSwap and constant-product pools
/// @dev Pools are deployed externally and registered here to stay under EIP-170 size limit.
contract PoolFactory is IPoolFactory, Ownable {
    mapping(bytes32 => address) public stablePools;
    mapping(bytes32 => address) public volatilePools;
    mapping(address => bool) public override isPool;
    address[] private _allPools;

    constructor() Ownable(msg.sender) {}

    // ========== POOL REGISTRATION ==========

    function registerStablePool(
        address tokenA,
        address tokenB,
        address pool
    ) external override onlyOwner {
        require(pool != address(0), "Factory: zero pool");
        bytes32 key = _pairKey(tokenA, tokenB);
        require(stablePools[key] == address(0), "Factory: pool exists");

        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        stablePools[key] = pool;
        isPool[pool] = true;
        _allPools.push(pool);

        emit StablePoolCreated(t0, t1, pool, 0, 0);
    }

    function registerVolatilePool(
        address tokenA,
        address tokenB,
        address pool
    ) external override onlyOwner {
        require(pool != address(0), "Factory: zero pool");
        bytes32 key = _pairKey(tokenA, tokenB);
        require(volatilePools[key] == address(0), "Factory: pool exists");

        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        volatilePools[key] = pool;
        isPool[pool] = true;
        _allPools.push(pool);

        emit VolatilePoolCreated(t0, t1, pool, 0);
    }

    // Keep interface compatibility (revert - use register functions instead)
    function createStablePool(address, address, uint256, uint256) external pure override returns (address) {
        revert("Factory: use registerStablePool");
    }

    function createVolatilePool(address, address, uint256) external pure override returns (address) {
        revert("Factory: use registerVolatilePool");
    }

    // ========== VIEW FUNCTIONS ==========

    function getPool(address tokenA, address tokenB) external view override returns (address) {
        bytes32 key = _pairKey(tokenA, tokenB);
        address stable = stablePools[key];
        if (stable != address(0)) return stable;
        return volatilePools[key];
    }

    function getStablePool(address tokenA, address tokenB) external view override returns (address) {
        return stablePools[_pairKey(tokenA, tokenB)];
    }

    function getVolatilePool(address tokenA, address tokenB) external view override returns (address) {
        return volatilePools[_pairKey(tokenA, tokenB)];
    }

    function allPools() external view override returns (address[] memory) {
        return _allPools;
    }

    function allPoolsLength() external view override returns (uint256) {
        return _allPools.length;
    }

    // ========== INTERNAL ==========

    function _pairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }
}
