// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {VolatilePool} from "../src/core/VolatilePool.sol";
import {LPToken} from "../src/tokens/LPToken.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {IFlashLoanReceiver} from "../src/interfaces/IVolatilePool.sol";

contract VolatilePoolTest is Test {
    VolatilePool public pool;
    MockERC20 public dot;
    MockERC20 public usdc;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    uint256 constant FEE = 30; // 0.3%

    function setUp() public {
        dot = new MockERC20("Polkadot", "DOT", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        pool = new VolatilePool(address(dot), address(usdc), FEE, "DOT-USDC LP", "vpLP");

        // Fund users
        dot.mint(alice, 100_000e18);
        usdc.mint(alice, 1_000_000e6);
        dot.mint(bob, 100_000e18);
        usdc.mint(bob, 1_000_000e6);

        // Approve
        vm.startPrank(alice);
        dot.approve(address(pool), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        dot.approve(address(pool), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ========== ADD LIQUIDITY ==========

    function test_addLiquidity_initial() public {
        (uint256 dotAmt, uint256 usdcAmt) = _sortedAmounts(10_000e18, 100_000e6);

        vm.startPrank(alice);
        (uint256 a0, uint256 a1, uint256 lpOut) = pool.addLiquidity(dotAmt, usdcAmt, 0, 0, alice, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(lpOut > 0);
        assertTrue(a0 > 0);
        assertTrue(a1 > 0);
        (uint256 r0, uint256 r1) = pool.getReserves();
        assertEq(r0, a0);
        assertEq(r1, a1);
    }

    function test_addLiquidity_subsequent() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        (uint256 dotAmt, uint256 usdcAmt) = _sortedAmounts(5_000e18, 50_000e6);

        vm.startPrank(bob);
        (,, uint256 lpOut) = pool.addLiquidity(dotAmt, usdcAmt, 0, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(lpOut > 0);
    }

    // ========== SWAP ==========

    function test_swap_dot_to_usdc() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        // Determine token ordering
        address t0 = pool.token0();

        vm.startPrank(bob);
        uint256 amountOut = pool.swap(address(dot), 100e18, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(amountOut > 0);
    }

    function test_swap_usdc_to_dot() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        vm.startPrank(bob);
        uint256 amountOut = pool.swap(address(usdc), 1_000e6, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(amountOut > 0);
    }

    function test_swap_slippageProtection() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        vm.startPrank(bob);
        vm.expectRevert("VolatilePool: slippage");
        pool.swap(address(dot), 100e18, type(uint256).max, bob, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_getAmountOut() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        uint256 preview = pool.getAmountOut(address(dot), 100e18);
        assertTrue(preview > 0);
    }

    // ========== REMOVE LIQUIDITY ==========

    function test_removeLiquidity() public {
        (uint256 dotAmt, uint256 usdcAmt) = _sortedAmounts(10_000e18, 100_000e6);

        vm.startPrank(alice);
        (,, uint256 lpOut) = pool.addLiquidity(dotAmt, usdcAmt, 0, 0, alice, block.timestamp + 1);

        uint256 halfLP = lpOut / 2;
        (uint256 a0, uint256 a1) = pool.removeLiquidity(halfLP, 0, 0, alice, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(a0 > 0);
        assertTrue(a1 > 0);
    }

    // ========== FLASH LOAN ==========

    function test_flashLoan() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        // Deploy flash loan receiver
        address t0 = pool.token0();
        address t1 = pool.token1();
        FlashBorrower borrower = new FlashBorrower(address(pool), t0, t1);

        // Fund borrower to repay fee
        MockERC20(t0).mint(address(borrower), 1e18);
        MockERC20(t1).mint(address(borrower), 1e6);

        // Borrow token0 only
        (uint256 r0,) = pool.getReserves();
        uint256 borrowAmount = r0 / 10; // Borrow 10% of reserves

        pool.flashLoan(address(borrower), borrowAmount, 0, "");
    }

    function test_flashLoan_mustRepay() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);

        BadBorrower borrower = new BadBorrower();

        (uint256 r0,) = pool.getReserves();

        vm.expectRevert();
        pool.flashLoan(address(borrower), r0 / 10, 0, "");
    }

    // ========== ADMIN ==========

    function test_pause_blocksSwap() public {
        _addInitialLiquidity(alice, 10_000e18, 100_000e6);
        pool.pause();

        vm.startPrank(bob);
        vm.expectRevert();
        pool.swap(address(dot), 100e18, 0, bob, block.timestamp + 1);
        vm.stopPrank();
    }

    // ========== HELPERS ==========

    /// @notice Returns (amount for token0, amount for token1) given (dotAmount, usdcAmount)
    function _sortedAmounts(uint256 dotAmount, uint256 usdcAmount) internal view returns (uint256, uint256) {
        address t0 = pool.token0();
        return address(dot) == t0 ? (dotAmount, usdcAmount) : (usdcAmount, dotAmount);
    }

    function _addInitialLiquidity(address user, uint256 dotAmount, uint256 usdcAmount) internal {
        (uint256 a0, uint256 a1) = _sortedAmounts(dotAmount, usdcAmount);

        vm.startPrank(user);
        pool.addLiquidity(a0, a1, 0, 0, user, block.timestamp + 1);
        vm.stopPrank();
    }
}

/// @notice Flash loan receiver that properly repays
contract FlashBorrower is IFlashLoanReceiver {
    address public pool;
    address public token0;
    address public token1;

    constructor(address _pool, address _token0, address _token1) {
        pool = _pool;
        token0 = _token0;
        token1 = _token1;
    }

    function onFlashLoan(address, uint256 amount0, uint256 amount1, uint256 fee0, uint256 fee1, bytes calldata)
        external
    {
        // Repay loan + fees
        if (amount0 + fee0 > 0) {
            MockERC20(token0).transfer(pool, amount0 + fee0);
        }
        if (amount1 + fee1 > 0) {
            MockERC20(token1).transfer(pool, amount1 + fee1);
        }
    }
}

/// @notice Flash loan receiver that doesn't repay (for testing)
contract BadBorrower is IFlashLoanReceiver {
    function onFlashLoan(address, uint256, uint256, uint256, uint256, bytes calldata) external {
        // Do nothing - don't repay
    }
}
