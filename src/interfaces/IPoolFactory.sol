// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPoolFactory
/// @notice Interface for the pool registry
/// @dev Pools are deployed externally and registered here to stay under EIP-170
interface IPoolFactory {
    event StablePoolCreated(
        address indexed token0,
        address indexed token1,
        address pool,
        uint256 amp,
        uint256 fee
    );

    event VolatilePoolCreated(
        address indexed token0,
        address indexed token1,
        address pool,
        uint256 fee
    );

    /// @notice Register an externally-deployed stable pool
    function registerStablePool(
        address tokenA,
        address tokenB,
        address pool
    ) external;

    /// @notice Register an externally-deployed volatile pool
    function registerVolatilePool(
        address tokenA,
        address tokenB,
        address pool
    ) external;

    /// @notice Legacy create functions - revert with guidance to use register*
    function createStablePool(
        address tokenA,
        address tokenB,
        uint256 amp,
        uint256 fee
    ) external returns (address pool);

    function createVolatilePool(
        address tokenA,
        address tokenB,
        uint256 fee
    ) external returns (address pool);

    function getPool(address tokenA, address tokenB) external view returns (address);
    function getStablePool(address tokenA, address tokenB) external view returns (address);
    function getVolatilePool(address tokenA, address tokenB) external view returns (address);
    function isPool(address pool) external view returns (bool);
    function allPools() external view returns (address[] memory);
    function allPoolsLength() external view returns (uint256);
}
