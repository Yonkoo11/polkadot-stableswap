// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {PoolFactory} from "../src/core/PoolFactory.sol";
import {Router} from "../src/core/Router.sol";
import {StablePool} from "../src/core/StablePool.sol";
import {VolatilePool} from "../src/core/VolatilePool.sol";
import {IRouter} from "../src/interfaces/IRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @title Integration test: Factory + Router + multi-hop swaps
contract IntegrationTest is Test {
    PoolFactory public factory;
    Router public router;

    MockERC20 public dot;
    MockERC20 public usdc;
    MockERC20 public usdt;

    address public deployer = makeAddr("deployer");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        vm.startPrank(deployer);
        factory = new PoolFactory();
        router = new Router(address(factory));

        dot = new MockERC20("Polkadot", "DOT", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdt = new MockERC20("Tether USD", "USDT", 6);

        // Deploy pools and register in factory
        StablePool sp = new StablePool(address(usdc), address(usdt), 85, 4e6, 5e9, "ssLP", "ssLP");
        factory.registerStablePool(address(usdc), address(usdt), address(sp));

        VolatilePool vp1 = new VolatilePool(address(dot), address(usdc), 30, "vpLP1", "vpLP1");
        factory.registerVolatilePool(address(dot), address(usdc), address(vp1));

        VolatilePool vp2 = new VolatilePool(address(dot), address(usdt), 30, "vpLP2", "vpLP2");
        factory.registerVolatilePool(address(dot), address(usdt), address(vp2));
        vm.stopPrank();

        // Fund and approve
        _fundUser(alice);
        _fundUser(bob);

        // Seed liquidity in all pools
        _seedStablePool(alice);
        _seedVolatilePool(alice, address(dot), address(usdc), 10_000e18, 100_000e6);
        _seedVolatilePool(alice, address(dot), address(usdt), 10_000e18, 100_000e6);
    }

    // ========== FACTORY TESTS ==========

    function test_factory_poolCreation() public view {
        address stablePool = factory.getStablePool(address(usdc), address(usdt));
        assertTrue(stablePool != address(0));
        assertTrue(factory.isPool(stablePool));

        address volPool = factory.getVolatilePool(address(dot), address(usdc));
        assertTrue(volPool != address(0));
        assertTrue(factory.isPool(volPool));

        assertEq(factory.allPoolsLength(), 3);
    }

    function test_factory_duplicatePool_reverts() public {
        vm.startPrank(deployer);
        vm.expectRevert("Factory: pool exists");
        factory.registerStablePool(address(usdc), address(usdt), address(1));
        vm.stopPrank();
    }

    function test_factory_reverseTokenOrder() public view {
        // Should find pool regardless of token order
        address pool1 = factory.getStablePool(address(usdc), address(usdt));
        address pool2 = factory.getStablePool(address(usdt), address(usdc));
        assertEq(pool1, pool2);
    }

    // ========== ROUTER: DIRECT SWAP ==========

    function test_router_directStableSwap() public {
        // USDC -> USDT via stable pool
        IRouter.Route[] memory routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({
            tokenIn: address(usdc),
            tokenOut: address(usdt),
            poolType: IRouter.PoolType.Stable
        });

        vm.startPrank(bob);
        usdc.approve(address(router), type(uint256).max);
        uint256 amountOut = router.swapExactIn(routes, 1_000e6, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        // StableSwap: should get close to 1:1
        assertApproxEqRel(amountOut, 1_000e6, 1e15); // 0.1%
    }

    function test_router_directVolatileSwap() public {
        // DOT -> USDC via volatile pool
        IRouter.Route[] memory routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({
            tokenIn: address(dot),
            tokenOut: address(usdc),
            poolType: IRouter.PoolType.Volatile
        });

        vm.startPrank(bob);
        dot.approve(address(router), type(uint256).max);
        uint256 amountOut = router.swapExactIn(routes, 100e18, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(amountOut > 0);
    }

    // ========== ROUTER: MULTI-HOP ==========

    function test_router_multiHop_DOT_USDC_USDT() public {
        // DOT -> USDC (volatile) -> USDT (stable)
        IRouter.Route[] memory routes = new IRouter.Route[](2);
        routes[0] = IRouter.Route({
            tokenIn: address(dot),
            tokenOut: address(usdc),
            poolType: IRouter.PoolType.Volatile
        });
        routes[1] = IRouter.Route({
            tokenIn: address(usdc),
            tokenOut: address(usdt),
            poolType: IRouter.PoolType.Stable
        });

        vm.startPrank(bob);
        dot.approve(address(router), type(uint256).max);
        uint256 amountOut = router.swapExactIn(routes, 100e18, 0, bob, block.timestamp + 1);
        vm.stopPrank();

        assertTrue(amountOut > 0);
        // Check bob received USDT
        assertTrue(usdt.balanceOf(bob) > 1_000_000e6); // He started with 1M
    }

    // ========== ROUTER: QUOTE ==========

    function test_router_getAmountsOut() public view {
        IRouter.Route[] memory routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({
            tokenIn: address(usdc),
            tokenOut: address(usdt),
            poolType: IRouter.PoolType.Stable
        });

        uint256[] memory amounts = router.getAmountsOut(routes, 1_000e6);
        assertEq(amounts[0], 1_000e6);
        assertTrue(amounts[1] > 0);
        assertApproxEqRel(amounts[1], 1_000e6, 1e15);
    }

    function test_router_getAmountsOut_multiHop() public view {
        IRouter.Route[] memory routes = new IRouter.Route[](2);
        routes[0] = IRouter.Route({
            tokenIn: address(dot),
            tokenOut: address(usdc),
            poolType: IRouter.PoolType.Volatile
        });
        routes[1] = IRouter.Route({
            tokenIn: address(usdc),
            tokenOut: address(usdt),
            poolType: IRouter.PoolType.Stable
        });

        uint256[] memory amounts = router.getAmountsOut(routes, 100e18);
        assertEq(amounts.length, 3);
        assertEq(amounts[0], 100e18);
        assertTrue(amounts[1] > 0);
        assertTrue(amounts[2] > 0);
    }

    // ========== HELPERS ==========

    function _fundUser(address user) internal {
        dot.mint(user, 100_000e18);
        usdc.mint(user, 10_000_000e6);
        usdt.mint(user, 10_000_000e6);
    }

    function _seedStablePool(address user) internal {
        address stablePool = factory.getStablePool(address(usdc), address(usdt));
        vm.startPrank(user);
        usdc.approve(stablePool, type(uint256).max);
        usdt.approve(stablePool, type(uint256).max);
        uint256[2] memory amounts = [uint256(1_000_000e6), uint256(1_000_000e6)];
        StablePool(stablePool).addLiquidity(amounts, 0, block.timestamp + 1);
        vm.stopPrank();
    }

    function _seedVolatilePool(address user, address tokenA, address tokenB, uint256 amountA, uint256 amountB) internal {
        address volPool = factory.getVolatilePool(tokenA, tokenB);
        VolatilePool vp = VolatilePool(volPool);
        address t0 = vp.token0();

        // Sort amounts to match token order
        (uint256 a0, uint256 a1) = tokenA == t0 ? (amountA, amountB) : (amountB, amountA);

        vm.startPrank(user);
        MockERC20(t0).approve(volPool, type(uint256).max);
        MockERC20(vp.token1()).approve(volPool, type(uint256).max);
        vp.addLiquidity(a0, a1, 0, 0, user, block.timestamp + 1);
        vm.stopPrank();
    }
}
