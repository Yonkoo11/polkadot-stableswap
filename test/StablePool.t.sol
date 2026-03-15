// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {StablePool} from "../src/core/StablePool.sol";
import {LPToken} from "../src/tokens/LPToken.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract StablePoolTest is Test {
    StablePool public pool;
    MockERC20 public usdc;
    MockERC20 public usdt;
    LPToken public lp;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 constant AMP = 85;
    uint256 constant FEE = 4e6; // 0.04%
    uint256 constant ADMIN_FEE = 5e9; // 50%

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdt = new MockERC20("Tether USD", "USDT", 6);

        pool = new StablePool(address(usdc), address(usdt), AMP, FEE, ADMIN_FEE, "USDC-USDT StableLP", "ssLP");
        lp = pool.lpToken();

        // Fund users
        usdc.mint(alice, 10_000_000e6);
        usdt.mint(alice, 10_000_000e6);
        usdc.mint(bob, 10_000_000e6);
        usdt.mint(bob, 10_000_000e6);

        // Approve
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ========== ADD LIQUIDITY ==========

    function test_addLiquidity_initial() public {
        vm.startPrank(alice);
        uint256[2] memory amounts = [uint256(1_000_000e6), uint256(1_000_000e6)];
        uint256 lpOut = pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(lpOut > 0, "should mint LP tokens");
        assertEq(pool.getTokenBalance(0), 1_000_000e6);
        assertEq(pool.getTokenBalance(1), 1_000_000e6);
        assertEq(lp.balanceOf(alice), lpOut);
        // Minimum liquidity locked
        assertEq(lp.balanceOf(address(1)), 1e3);
    }

    function test_addLiquidity_initialRequiresBoth() public {
        vm.startPrank(alice);
        uint256[2] memory amounts = [uint256(1_000_000e6), uint256(0)];
        vm.expectRevert("StablePool: initial deposit needs both");
        pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_addLiquidity_subsequent_balanced() public {
        // Initial deposit
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        // Bob adds balanced liquidity
        vm.startPrank(bob);
        uint256[2] memory amounts = [uint256(500_000e6), uint256(500_000e6)];
        uint256 lpOut = pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(lpOut > 0);
    }

    function test_addLiquidity_subsequent_imbalanced() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        // Bob adds only USDC
        vm.startPrank(bob);
        uint256[2] memory amounts = [uint256(100_000e6), uint256(0)];
        uint256 lpOut = pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();

        // Should get LP tokens but less than a balanced deposit would give
        assertTrue(lpOut > 0);
    }

    function test_addLiquidity_slippageProtection() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        uint256[2] memory amounts = [uint256(100_000e6), uint256(100_000e6)];
        vm.expectRevert("StablePool: slippage");
        pool.addLiquidity(amounts, type(uint256).max, block.timestamp + 1);
        vm.stopPrank();
    }

    // ========== SWAP ==========

    function test_swap() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        uint256 bobUsdtBefore = usdt.balanceOf(bob);
        uint256 amountOut = pool.swap(0, 1, 1_000e6, 0, bob, block.timestamp + 1);
        uint256 bobUsdtAfter = usdt.balanceOf(bob);
        vm.stopPrank();

        assertEq(bobUsdtAfter - bobUsdtBefore, amountOut);
        // Should get close to 1000 USDT for 1000 USDC (high A, low slippage)
        assertApproxEqRel(amountOut, 1_000e6, 1e15); // 0.1%
    }

    function test_swap_nearPerfectPricing() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        // Small swap should have near-zero slippage
        vm.startPrank(bob);
        uint256 amountOut = pool.swap(0, 1, 100e6, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        // 100 USDC should get ~99.96 USDT (0.04% fee)
        uint256 expectedAfterFee = 100e6 * (1e10 - FEE) / 1e10;
        assertApproxEqRel(amountOut, expectedAfterFee, 1e15);
    }

    function test_swap_reverseDirection() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        uint256 amountOut = pool.swap(1, 0, 1_000e6, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertApproxEqRel(amountOut, 1_000e6, 1e15);
    }

    function test_swap_slippageProtection() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        vm.expectRevert("StablePool: slippage");
        pool.swap(0, 1, 1_000e6, 1_000e6, bob, block.timestamp + 1); // Asking for too much
        vm.stopPrank();
    }

    function test_swap_sameToken_reverts() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        vm.expectRevert("StablePool: same token");
        pool.swap(0, 0, 1_000e6, 0, bob, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_swap_deadline() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(bob);
        vm.expectRevert("StablePool: expired");
        pool.swap(0, 1, 1_000e6, 0, bob, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_getDy() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        uint256 dy = pool.getDy(0, 1, 1_000e6);
        assertTrue(dy > 0);
        assertApproxEqRel(dy, 1_000e6, 1e15);
    }

    // ========== REMOVE LIQUIDITY ==========

    function test_removeLiquidity_proportional() public {
        uint256 lpMinted = _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(alice);
        uint256[2] memory minAmounts = [uint256(0), uint256(0)];
        uint256[2] memory amounts = pool.removeLiquidity(lpMinted, minAmounts, block.timestamp + 1);
        vm.stopPrank();

        // Should get back proportional amounts (minus locked minimum)
        assertTrue(amounts[0] > 0);
        assertTrue(amounts[1] > 0);
    }

    function test_removeLiquidity_partial() public {
        uint256 lpMinted = _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(alice);
        uint256 halfLP = lpMinted / 2;
        uint256[2] memory minAmounts = [uint256(0), uint256(0)];
        uint256[2] memory amounts = pool.removeLiquidity(halfLP, minAmounts, block.timestamp + 1);
        vm.stopPrank();

        // Should get back roughly half
        assertApproxEqRel(amounts[0], 500_000e6, 1e15);
        assertApproxEqRel(amounts[1], 500_000e6, 1e15);
    }

    function test_removeLiquidityOneToken() public {
        uint256 lpMinted = _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        vm.startPrank(alice);
        uint256 removeLP = lpMinted / 10; // Remove 10%
        uint256 amount = pool.removeLiquidityOneToken(removeLP, 0, 0, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(amount > 0);
        // Single-sided removal incurs fee, so get less than proportional
        assertTrue(amount < 200_000e6); // Less than 2x the proportional share
    }

    // ========== VIRTUAL PRICE ==========

    function test_virtualPrice_initial() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        uint256 vp = pool.getVirtualPrice();
        // Virtual price should start near 1e18
        assertApproxEqRel(vp, 1e18, 1e15);
    }

    function test_virtualPrice_increasesAfterSwaps() public {
        _addInitialLiquidity(alice, 1_000_000e6, 1_000_000e6);

        uint256 vpBefore = pool.getVirtualPrice();

        // Do some swaps (fees accrue to LPs)
        vm.startPrank(bob);
        for (uint256 i = 0; i < 10; i++) {
            pool.swap(0, 1, 10_000e6, 0, bob, block.timestamp + 1);
            pool.swap(1, 0, 10_000e6, 0, bob, block.timestamp + 1);
        }
        vm.stopPrank();

        uint256 vpAfter = pool.getVirtualPrice();
        assertTrue(vpAfter >= vpBefore, "virtual price should not decrease from fees");
    }

    // ========== ADMIN ==========

    function test_pause() public {
        pool.pause();

        _fundAndApprove(alice);
        vm.startPrank(alice);
        uint256[2] memory amounts = [uint256(1_000_000e6), uint256(1_000_000e6)];
        vm.expectRevert();
        pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_unpause() public {
        pool.pause();
        pool.unpause();

        vm.startPrank(alice);
        uint256[2] memory amounts = [uint256(1_000_000e6), uint256(1_000_000e6)];
        pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_getA() public view {
        uint256 A = pool.getA();
        // A is stored as A * N^(N-1) * PRECISION = 85 * 2 * 1e18
        assertEq(A, AMP * 2 * 1e18);
    }

    // ========== HELPERS ==========

    function _addInitialLiquidity(address user, uint256 amount0, uint256 amount1) internal returns (uint256) {
        vm.startPrank(user);
        uint256[2] memory amounts = [amount0, amount1];
        uint256 lpOut = pool.addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();
        return lpOut;
    }

    function _fundAndApprove(address user) internal {
        usdc.mint(user, 10_000_000e6);
        usdt.mint(user, 10_000_000e6);
        vm.startPrank(user);
        usdc.approve(address(pool), type(uint256).max);
        usdt.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }
}
