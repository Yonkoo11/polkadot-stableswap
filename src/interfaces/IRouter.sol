// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRouter {
    enum PoolType { Stable, Volatile }

    struct Route {
        address tokenIn;
        address tokenOut;
        PoolType poolType;
    }

    function swapExactIn(
        Route[] calldata routes,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);

    function getAmountsOut(
        Route[] calldata routes,
        uint256 amountIn
    ) external view returns (uint256[] memory amounts);
}
