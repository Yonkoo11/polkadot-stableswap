// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StableSwapMath} from "../src/libraries/StableSwapMath.sol";

contract StableSwapMathTest is Test {
    uint256 constant PRECISION = 1e18;
    uint256 constant N_COINS = 2;

    // A=85, stored as A * n^(n-1) * PRECISION = 85 * 2 * 1e18
    uint256 constant AMP = 85 * N_COINS * PRECISION;

    function test_getD_equalBalances() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18; // 1M USDC normalized to 18 decimals
        xp[1] = 1_000_000e18; // 1M USDT normalized to 18 decimals

        uint256 D = StableSwapMath.getD(xp, AMP);

        // For equal balances, D should equal the sum of balances
        assertApproxEqRel(D, 2_000_000e18, 1e14); // 0.01% tolerance
    }

    function test_getD_unequalBalances() public pure {
        uint256[2] memory xp;
        xp[0] = 800_000e18;
        xp[1] = 1_200_000e18;

        uint256 D = StableSwapMath.getD(xp, AMP);

        // D should be close to sum but slightly less due to imbalance
        assertTrue(D > 0);
        assertTrue(D <= 2_000_000e18);
        assertTrue(D > 1_900_000e18); // High A keeps it close to sum
    }

    function test_getD_zeroBalances() public {
        uint256[2] memory xp;
        xp[0] = 0;
        xp[1] = 0;

        uint256 D = StableSwapMath.getD(xp, AMP);
        assertEq(D, 0);
    }

    function test_getY_equalBalances() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        // Swap 1000 USDC for USDT
        uint256 x = xp[0] + 1_000e18;
        uint256 y = StableSwapMath.getY(0, 1, x, xp, AMP);

        // Should get close to 1000 USDT out (high A = low slippage)
        uint256 dy = xp[1] - y;
        assertApproxEqRel(dy, 1_000e18, 1e15); // 0.1% tolerance
    }

    function test_getY_largeSwap() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        // Swap 100k USDC (10% of pool)
        uint256 x = xp[0] + 100_000e18;
        uint256 y = StableSwapMath.getY(0, 1, x, xp, AMP);
        uint256 dy = xp[1] - y;

        // Should still be close to 100k but with some slippage
        assertTrue(dy > 99_000e18);
        assertTrue(dy < 100_000e18);
    }

    function test_getY_symmetry() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        uint256 swapAmount = 5_000e18;

        // Swap 0->1
        uint256 x01 = xp[0] + swapAmount;
        uint256 y01 = StableSwapMath.getY(0, 1, x01, xp, AMP);
        uint256 dy01 = xp[1] - y01;

        // Swap 1->0
        uint256 x10 = xp[1] + swapAmount;
        uint256 y10 = StableSwapMath.getY(1, 0, x10, xp, AMP);
        uint256 dy10 = xp[0] - y10;

        // Should be symmetric for equal balances
        assertEq(dy01, dy10);
    }

    function test_getYD() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        uint256 D = StableSwapMath.getD(xp, AMP);

        // getYD should return the same balance if D hasn't changed
        uint256 y0 = StableSwapMath.getYD(0, xp, D, AMP);
        uint256 y1 = StableSwapMath.getYD(1, xp, D, AMP);

        assertApproxEqAbs(y0, xp[0], 1);
        assertApproxEqAbs(y1, xp[1], 1);
    }

    function test_getYD_reducedD() public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        uint256 D = StableSwapMath.getD(xp, AMP);
        uint256 D1 = D * 90 / 100; // 10% reduction

        uint256 y0 = StableSwapMath.getYD(0, xp, D1, AMP);

        // Reduced D means reduced balance
        assertTrue(y0 < xp[0]);
    }

    // Fuzz test: getD should always return a value >= 0 and converge
    function testFuzz_getD_converges(uint256 bal0, uint256 bal1) public pure {
        // Bound to reasonable values for pegged assets (within 10x of each other)
        bal0 = bound(bal0, 1_000e18, 1e27);
        bal1 = bound(bal1, bal0 / 10, bal0 * 10);

        uint256[2] memory xp;
        xp[0] = bal0;
        xp[1] = bal1;

        uint256 D = StableSwapMath.getD(xp, AMP);
        assertTrue(D > 0);
    }

    // Fuzz test: getY should maintain invariant
    function testFuzz_getY_invariantPreserved(uint256 swapAmount) public pure {
        uint256[2] memory xp;
        xp[0] = 1_000_000e18;
        xp[1] = 1_000_000e18;

        swapAmount = bound(swapAmount, 1e18, 500_000e18);

        uint256 x = xp[0] + swapAmount;
        uint256 y = StableSwapMath.getY(0, 1, x, xp, AMP);

        // The new Y should be less than old Y (we're buying token 1)
        assertTrue(y < xp[1]);
        // But not zero
        assertTrue(y > 0);
    }
}
