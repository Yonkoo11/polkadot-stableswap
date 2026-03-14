// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ConstantProductMath
/// @notice Implements x*y=k AMM math for volatile token pairs
library ConstantProductMath {
    /// @notice Calculate output amount for a constant-product swap
    /// @param amountIn Input amount (with fees already deducted)
    /// @param reserveIn Reserve of the input token
    /// @param reserveOut Reserve of the output token
    /// @return amountOut Output amount
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "CPMath: zero input");
        require(reserveIn > 0 && reserveOut > 0, "CPMath: no liquidity");

        // amountOut = reserveOut * amountIn / (reserveIn + amountIn)
        uint256 numerator = reserveOut * amountIn;
        uint256 denominator = reserveIn + amountIn;
        amountOut = numerator / denominator;
    }

    /// @notice Calculate input amount needed for a desired output
    /// @param amountOut Desired output amount
    /// @param reserveIn Reserve of the input token
    /// @param reserveOut Reserve of the output token
    /// @return amountIn Required input amount
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        require(amountOut > 0, "CPMath: zero output");
        require(reserveIn > 0 && reserveOut > amountOut, "CPMath: no liquidity");

        uint256 numerator = reserveIn * amountOut;
        uint256 denominator = reserveOut - amountOut;
        amountIn = (numerator / denominator) + 1; // Round up
    }

    /// @notice Quote equivalent amount of tokenB given amountA and reserves
    /// @dev Used for adding liquidity at the current ratio
    /// @param amountA Amount of token A
    /// @param reserveA Reserve of token A
    /// @param reserveB Reserve of token B
    /// @return amountB Equivalent amount of token B
    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) internal pure returns (uint256 amountB) {
        require(amountA > 0, "CPMath: zero amount");
        require(reserveA > 0 && reserveB > 0, "CPMath: no liquidity");

        amountB = (amountA * reserveB) / reserveA;
    }

    /// @notice Calculate the minimum of two values
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @notice Integer square root using the Babylonian method
    /// @param y Input value
    /// @return z Square root
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
