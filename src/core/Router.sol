// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IRouter} from "../interfaces/IRouter.sol";
import {IPoolFactory} from "../interfaces/IPoolFactory.sol";
import {IStablePool} from "../interfaces/IStablePool.sol";
import {IVolatilePool} from "../interfaces/IVolatilePool.sol";

/// @title Router
/// @notice Routes swaps across StablePool and VolatilePool instances
/// @dev Supports multi-hop swaps: e.g. DOT -> USDC (volatile) -> USDT (stable)
contract Router is IRouter {
    using SafeERC20 for IERC20;

    IPoolFactory public immutable factory;

    constructor(address _factory) {
        require(_factory != address(0), "Router: zero factory");
        factory = IPoolFactory(_factory);
    }

    /// @notice Execute a multi-hop swap
    /// @param routes Array of Route structs defining the swap path
    /// @param amountIn Amount of input token
    /// @param minAmountOut Minimum output (slippage protection)
    /// @param to Recipient address
    /// @param deadline Transaction deadline
    function swapExactIn(
        Route[] calldata routes,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountOut) {
        require(routes.length > 0, "Router: empty route");
        require(to != address(0), "Router: zero address");

        // Transfer initial tokens from user to router
        IERC20(routes[0].tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i < routes.length; i++) {
            Route calldata route = routes[i];
            address pool = _getPool(route.tokenIn, route.tokenOut, route.poolType);
            require(pool != address(0), "Router: no pool");

            // Approve pool to spend tokens
            IERC20(route.tokenIn).forceApprove(pool, currentAmount);

            bool isLastHop = (i == routes.length - 1);
            address recipient = isLastHop ? to : address(this);

            if (route.poolType == PoolType.Stable) {
                currentAmount = _swapStable(pool, route.tokenIn, route.tokenOut, currentAmount, recipient, deadline);
            } else {
                currentAmount = _swapVolatile(pool, route.tokenIn, currentAmount, recipient, deadline);
            }
        }

        amountOut = currentAmount;
        require(amountOut >= minAmountOut, "Router: slippage");
    }

    /// @notice Preview output amounts for a multi-hop swap
    function getAmountsOut(
        Route[] calldata routes,
        uint256 amountIn
    ) external view override returns (uint256[] memory amounts) {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < routes.length; i++) {
            Route calldata route = routes[i];
            address pool = _getPool(route.tokenIn, route.tokenOut, route.poolType);
            require(pool != address(0), "Router: no pool");

            if (route.poolType == PoolType.Stable) {
                (uint256 idxIn, uint256 idxOut) = _getStableIndices(pool, route.tokenIn, route.tokenOut);
                amounts[i + 1] = IStablePool(pool).getDy(idxIn, idxOut, amounts[i]);
            } else {
                amounts[i + 1] = IVolatilePool(pool).getAmountOut(route.tokenIn, amounts[i]);
            }
        }
    }

    // ========== INTERNAL ==========

    function _swapStable(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address to,
        uint256 deadline
    ) internal returns (uint256) {
        (uint256 idxIn, uint256 idxOut) = _getStableIndices(pool, tokenIn, tokenOut);
        return IStablePool(pool).swap(idxIn, idxOut, amountIn, 0, to, deadline);
    }

    function _swapVolatile(
        address pool,
        address tokenIn,
        uint256 amountIn,
        address to,
        uint256 deadline
    ) internal returns (uint256) {
        return IVolatilePool(pool).swap(tokenIn, amountIn, 0, to, deadline);
    }

    function _getPool(address tokenIn, address tokenOut, PoolType poolType) internal view returns (address) {
        if (poolType == PoolType.Stable) {
            return factory.getStablePool(tokenIn, tokenOut);
        }
        return factory.getVolatilePool(tokenIn, tokenOut);
    }

    function _getStableIndices(
        address pool,
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256 idxIn, uint256 idxOut) {
        address t0 = IStablePool(pool).getToken(0);
        if (tokenIn == t0) {
            idxIn = 0;
            idxOut = 1;
        } else {
            idxIn = 1;
            idxOut = 0;
        }
    }
}
