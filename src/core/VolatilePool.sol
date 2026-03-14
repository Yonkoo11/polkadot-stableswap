// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {ConstantProductMath} from "../libraries/ConstantProductMath.sol";
import {LPToken} from "../tokens/LPToken.sol";
import {IVolatilePool, IFlashLoanReceiver} from "../interfaces/IVolatilePool.sol";

/// @title VolatilePool
/// @notice Uniswap V2-style constant-product AMM for volatile pairs (e.g. DOT/USDC)
/// @dev x*y=k invariant. Includes flash loans and TWAP oracle.
contract VolatilePool is IVolatilePool, ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 private constant FEE_DENOMINATOR = 1e4;
    uint256 private constant MAX_FEE = 100; // 1%
    uint256 private constant MINIMUM_LIQUIDITY = 1e3;

    address public override token0;
    address public override token1;
    LPToken public lpTokenContract;

    uint256 private reserve0;
    uint256 private reserve1;
    uint256 public fee; // e.g. 30 = 0.3%

    // TWAP oracle
    uint256 public override price0CumulativeLast;
    uint256 public override price1CumulativeLast;
    uint32 private blockTimestampLast;

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "VolatilePool: expired");
        _;
    }

    constructor(
        address _token0,
        address _token1,
        uint256 _fee,
        string memory _lpName,
        string memory _lpSymbol
    ) {
        require(_token0 != address(0) && _token1 != address(0), "VolatilePool: zero address");
        require(_token0 != _token1, "VolatilePool: identical tokens");
        require(_fee <= MAX_FEE, "VolatilePool: fee too high");

        // Sort tokens for canonical ordering
        (token0, token1) = _token0 < _token1 ? (_token0, _token1) : (_token1, _token0);

        fee = _fee;
        lpTokenContract = new LPToken(_lpName, _lpSymbol, address(this));

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ========== VIEW FUNCTIONS ==========

    function getReserves() public view override returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function lpToken() external view override returns (address) {
        return address(lpTokenContract);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) external view override returns (uint256) {
        require(tokenIn == token0 || tokenIn == token1, "VolatilePool: invalid token");
        (uint256 resIn, uint256 resOut) = tokenIn == token0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        uint256 amountInAfterFee = amountIn * (FEE_DENOMINATOR - fee) / FEE_DENOMINATOR;
        return ConstantProductMath.getAmountOut(amountInAfterFee, resIn, resOut);
    }

    // ========== SWAP ==========

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external override nonReentrant whenNotPaused ensure(deadline) returns (uint256 amountOut) {
        require(tokenIn == token0 || tokenIn == token1, "VolatilePool: invalid token");
        require(amountIn > 0, "VolatilePool: zero input");
        require(to != address(0), "VolatilePool: zero address");

        bool isToken0 = tokenIn == token0;
        (uint256 resIn, uint256 resOut) = isToken0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);

        // Transfer in
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 amountInAfterFee = amountIn * (FEE_DENOMINATOR - fee) / FEE_DENOMINATOR;
        amountOut = ConstantProductMath.getAmountOut(amountInAfterFee, resIn, resOut);
        require(amountOut >= minAmountOut, "VolatilePool: slippage");

        address tokenOut = isToken0 ? token1 : token0;
        IERC20(tokenOut).safeTransfer(to, amountOut);

        // Update reserves
        _update();

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut, to);
    }

    // ========== LIQUIDITY ==========

    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external override nonReentrant whenNotPaused ensure(deadline) returns (uint256 amount0, uint256 amount1, uint256 lpMinted) {
        require(to != address(0), "VolatilePool: zero address");

        uint256 totalSupply = lpTokenContract.totalSupply();

        if (totalSupply == 0) {
            // First deposit
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            lpMinted = ConstantProductMath.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            require(lpMinted > 0, "VolatilePool: insufficient initial liquidity");
            lpTokenContract.mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            // Calculate optimal amounts
            uint256 amount1Optimal = ConstantProductMath.quote(amount0Desired, reserve0, reserve1);
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "VolatilePool: insufficient amount1");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = ConstantProductMath.quote(amount1Desired, reserve1, reserve0);
                require(amount0Optimal <= amount0Desired, "VolatilePool: excessive amount0");
                require(amount0Optimal >= amount0Min, "VolatilePool: insufficient amount0");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }

            lpMinted = ConstantProductMath.min(
                amount0 * totalSupply / reserve0,
                amount1 * totalSupply / reserve1
            );
        }

        require(amount0 > 0 && amount1 > 0, "VolatilePool: zero amounts");

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);

        _update();
        lpTokenContract.mint(to, lpMinted);

        emit AddLiquidity(msg.sender, amount0, amount1, lpMinted);
    }

    function removeLiquidity(
        uint256 lpAmount,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external override nonReentrant ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        require(to != address(0), "VolatilePool: zero address");
        uint256 totalSupply = lpTokenContract.totalSupply();
        require(lpAmount > 0 && lpAmount <= totalSupply, "VolatilePool: invalid LP amount");

        amount0 = reserve0 * lpAmount / totalSupply;
        amount1 = reserve1 * lpAmount / totalSupply;
        require(amount0 >= amount0Min, "VolatilePool: slippage token0");
        require(amount1 >= amount1Min, "VolatilePool: slippage token1");

        lpTokenContract.burn(msg.sender, lpAmount);

        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);

        _update();

        emit RemoveLiquidity(msg.sender, amount0, amount1, lpAmount);
    }

    // ========== FLASH LOAN ==========

    function flashLoan(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external override nonReentrant whenNotPaused {
        require(amount0 > 0 || amount1 > 0, "VolatilePool: zero amounts");
        require(amount0 <= reserve0 && amount1 <= reserve1, "VolatilePool: insufficient reserves");

        uint256 fee0 = (amount0 * fee) / FEE_DENOMINATOR;
        uint256 fee1 = (amount1 * fee) / FEE_DENOMINATOR;
        if (fee0 == 0 && amount0 > 0) fee0 = 1;
        if (fee1 == 0 && amount1 > 0) fee1 = 1;

        uint256 balance0Before = IERC20(token0).balanceOf(address(this));
        uint256 balance1Before = IERC20(token1).balanceOf(address(this));

        if (amount0 > 0) IERC20(token0).safeTransfer(recipient, amount0);
        if (amount1 > 0) IERC20(token1).safeTransfer(recipient, amount1);

        IFlashLoanReceiver(recipient).onFlashLoan(
            msg.sender, amount0, amount1, fee0, fee1, data
        );

        uint256 balance0After = IERC20(token0).balanceOf(address(this));
        uint256 balance1After = IERC20(token1).balanceOf(address(this));

        require(balance0After >= balance0Before + fee0, "VolatilePool: flash loan not repaid (token0)");
        require(balance1After >= balance1Before + fee1, "VolatilePool: flash loan not repaid (token1)");

        _update();

        emit FlashLoan(recipient, amount0, amount1, fee0, fee1);
    }

    // ========== ADMIN ==========

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ========== INTERNAL ==========

    /// @notice Sync reserves from actual token balances and update TWAP oracle
    function _update() private {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        unchecked {
            uint32 timeElapsed = blockTimestamp - blockTimestampLast;
            if (timeElapsed > 0 && reserve0 > 0 && reserve1 > 0) {
                // Overflow is intentional for TWAP accumulator
                price0CumulativeLast += (reserve1 * 1e18 / reserve0) * timeElapsed;
                price1CumulativeLast += (reserve0 * 1e18 / reserve1) * timeElapsed;
            }
        }

        reserve0 = balance0;
        reserve1 = balance1;
        blockTimestampLast = blockTimestamp;
    }
}
