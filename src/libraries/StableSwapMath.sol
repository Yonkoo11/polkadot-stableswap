// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title StableSwapMath
/// @notice Implements the Curve StableSwap invariant for 2-token pools
/// @dev Invariant: A*n^n * sum(x_i) + D = A*D*n^n + D^(n+1) / (n^n * prod(x_i))
///      For n=2: 4A(x+y) + D = 4AD + D^3/(4xy)
library StableSwapMath {
    uint256 internal constant N_COINS = 2;
    uint256 internal constant PRECISION = 1e18;

    /// @notice Maximum iterations for Newton's method convergence
    uint256 internal constant MAX_ITERATIONS = 255;

    /// @notice Convergence threshold (1 wei)
    uint256 internal constant CONVERGENCE_THRESHOLD = 1;

    /// @notice Compute the StableSwap invariant D
    /// @param xp Token balances normalized to 18 decimals
    /// @param amp Amplification coefficient (already multiplied by N_COINS^(N_COINS-1))
    /// @return D The invariant
    function getD(uint256[2] memory xp, uint256 amp) internal pure returns (uint256) {
        uint256 S = xp[0] + xp[1];
        if (S == 0) return 0;

        uint256 D = S;
        uint256 Ann = amp * N_COINS; // A * n^n, where amp already has n^(n-1)

        for (uint256 i = 0; i < MAX_ITERATIONS; i++) {
            // D_P = D^(n+1) / (n^n * prod(x_i))
            // For 2 tokens: D_P = D * D / (2 * x0) * D / (2 * x1)
            uint256 D_P = D;
            for (uint256 j = 0; j < N_COINS; j++) {
                // D_P = D_P * D / (xp[j] * N_COINS)
                // +1 to prevent division by zero
                D_P = (D_P * D) / (xp[j] * N_COINS + 1);
            }

            uint256 D_prev = D;

            // Newton's method:
            // numerator = (Ann * S + D_P * N_COINS) * D
            // denominator = (Ann - 1) * D + (N_COINS + 1) * D_P
            // D = numerator / denominator
            uint256 numerator = (Ann * S / PRECISION + D_P * N_COINS) * D;
            uint256 denominator = (Ann - PRECISION) * D / PRECISION + (N_COINS + 1) * D_P;

            D = numerator / denominator;

            // Check convergence
            if (D > D_prev) {
                if (D - D_prev <= CONVERGENCE_THRESHOLD) return D;
            } else {
                if (D_prev - D <= CONVERGENCE_THRESHOLD) return D;
            }
        }

        // Should converge within MAX_ITERATIONS for reasonable inputs
        revert("StableSwapMath: D did not converge");
    }

    /// @notice Compute the output token balance given input for a swap
    /// @param i Index of the input token
    /// @param j Index of the output token
    /// @param x New balance of token i (after adding input amount)
    /// @param xp Current normalized balances
    /// @param amp Amplification coefficient
    /// @return y New balance of token j
    function getY(uint256 i, uint256 j, uint256 x, uint256[2] memory xp, uint256 amp) internal pure returns (uint256) {
        require(i != j, "StableSwapMath: same token");
        require(i < N_COINS && j < N_COINS, "StableSwapMath: invalid index");

        uint256 D = getD(xp, amp);
        uint256 Ann = amp * N_COINS;

        uint256 c = D;
        uint256 S = x; // Sum of all balances except j

        // c = D^(n+1) / (n^n * prod(x_i for i != j))
        // For 2 tokens, we only have token i with new balance x
        c = (c * D) / (x * N_COINS);
        c = (c * D * PRECISION) / (Ann * N_COINS);

        uint256 b = S + D * PRECISION / Ann;

        // Newton's method to solve for y:
        // y^2 + (b - D)y = c
        // y_(n+1) = (y_n^2 + c) / (2*y_n + b - D)
        uint256 y = D;

        for (uint256 k = 0; k < MAX_ITERATIONS; k++) {
            uint256 y_prev = y;
            y = (y * y + c) / (2 * y + b - D);

            if (y > y_prev) {
                if (y - y_prev <= CONVERGENCE_THRESHOLD) return y;
            } else {
                if (y_prev - y <= CONVERGENCE_THRESHOLD) return y;
            }
        }

        revert("StableSwapMath: Y did not converge");
    }

    /// @notice Calculate the output amount for a swap (before fees)
    /// @param i Input token index
    /// @param j Output token index
    /// @param dx Input amount (normalized to 18 decimals)
    /// @param xp Current normalized balances
    /// @param amp Amplification coefficient
    /// @return dy Output amount (normalized to 18 decimals)
    function getDy(uint256 i, uint256 j, uint256 dx, uint256[2] memory xp, uint256 amp)
        internal
        pure
        returns (uint256)
    {
        uint256 x = xp[i] + dx;
        uint256 y = getY(i, j, x, xp, amp);
        return xp[j] - y - 1; // -1 for rounding safety
    }

    /// @notice Compute D for removing liquidity in one token
    /// @dev Same as getY but uses a given D value instead of computing it
    /// @param i Index of the token being withdrawn
    /// @param xp Current normalized balances
    /// @param D The invariant value to target
    /// @param amp Amplification coefficient
    /// @return New balance of token i
    function getYD(uint256 i, uint256[2] memory xp, uint256 D, uint256 amp) internal pure returns (uint256) {
        uint256 Ann = amp * N_COINS;

        uint256 S = 0;
        uint256 c = D;

        for (uint256 k = 0; k < N_COINS; k++) {
            if (k == i) continue;
            S += xp[k];
            c = (c * D) / (xp[k] * N_COINS);
        }

        c = (c * D * PRECISION) / (Ann * N_COINS);
        uint256 b = S + D * PRECISION / Ann;

        uint256 y = D;
        for (uint256 k = 0; k < MAX_ITERATIONS; k++) {
            uint256 y_prev = y;
            y = (y * y + c) / (2 * y + b - D);

            if (y > y_prev) {
                if (y - y_prev <= CONVERGENCE_THRESHOLD) return y;
            } else {
                if (y_prev - y <= CONVERGENCE_THRESHOLD) return y;
            }
        }

        revert("StableSwapMath: YD did not converge");
    }
}
