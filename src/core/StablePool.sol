// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {StableSwapMath} from "../libraries/StableSwapMath.sol";
import {LPToken} from "../tokens/LPToken.sol";
import {IStablePool} from "../interfaces/IStablePool.sol";

/// @title StablePool
/// @notice Curve-style StableSwap pool for pegged assets (e.g. USDC/USDT)
/// @dev Uses the StableSwap invariant for minimal slippage on pegged pairs.
///      The AssetConversion pallet on Polkadot Hub requires DOT in every pair.
///      This contract enables direct stablecoin-to-stablecoin swaps.
contract StablePool is IStablePool, ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    uint256 private constant N_COINS = 2;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant FEE_DENOMINATOR = 1e10;
    uint256 private constant MAX_FEE = 5e7; // 0.5%
    uint256 private constant MAX_A = 1e6;
    uint256 private constant MIN_RAMP_TIME = 1 days;
    uint256 private constant MAX_A_CHANGE = 10;

    // Minimum LP to lock on first deposit (prevents inflation attacks)
    uint256 private constant MINIMUM_LIQUIDITY = 1e3;

    address[2] public tokens;
    uint256[2] public balances; // Tracked balances (not raw ERC20 balances)
    uint256[2] public precisionMultipliers; // 10^(18 - token.decimals)

    LPToken public lpToken;
    uint256 public fee; // e.g. 4e6 = 0.04%
    uint256 public adminFee; // Fraction of fee for admin (50% = 5e9)

    // Amplification coefficient ramping
    uint256 public initialA;
    uint256 public futureA;
    uint256 public initialATime;
    uint256 public futureATime;

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "StablePool: expired");
        _;
    }

    constructor(
        address _token0,
        address _token1,
        uint256 _A, // Amplification coefficient (not multiplied by n^(n-1))
        uint256 _fee,
        uint256 _adminFee,
        string memory _lpName,
        string memory _lpSymbol
    ) {
        require(_token0 != address(0) && _token1 != address(0), "StablePool: zero address");
        require(_token0 != _token1, "StablePool: identical tokens");
        require(_fee <= MAX_FEE, "StablePool: fee too high");
        require(_A > 0 && _A <= MAX_A, "StablePool: invalid A");

        tokens[0] = _token0;
        tokens[1] = _token1;

        // Both USDC and USDT on Polkadot Hub are 6 decimals
        // But we handle arbitrary decimals for generality
        uint8 decimals0 = _getDecimals(_token0);
        uint8 decimals1 = _getDecimals(_token1);
        precisionMultipliers[0] = 10 ** (18 - decimals0);
        precisionMultipliers[1] = 10 ** (18 - decimals1);

        // Store A * n^(n-1) for the math library
        uint256 ampNN = _A * (N_COINS ** (N_COINS - 1));
        initialA = ampNN * PRECISION;
        futureA = ampNN * PRECISION;

        fee = _fee;
        adminFee = _adminFee;

        lpToken = new LPToken(_lpName, _lpSymbol, address(this));

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ========== VIEW FUNCTIONS ==========

    function getA() public view override returns (uint256) {
        return _getA();
    }

    function getToken(uint256 index) external view override returns (address) {
        require(index < N_COINS, "StablePool: invalid index");
        return tokens[index];
    }

    function getTokenBalance(uint256 index) external view override returns (uint256) {
        require(index < N_COINS, "StablePool: invalid index");
        return balances[index];
    }

    function getDy(uint256 i, uint256 j, uint256 dx) external view override returns (uint256) {
        uint256[2] memory xp = _xp();
        uint256 x = xp[i] + dx * precisionMultipliers[i];
        uint256 y = StableSwapMath.getY(i, j, x, xp, _getA());
        uint256 dy = (xp[j] - y - 1) / precisionMultipliers[j];
        uint256 feeAmount = dy * fee / FEE_DENOMINATOR;
        return dy - feeAmount;
    }

    function getVirtualPrice() external view override returns (uint256) {
        uint256 D = StableSwapMath.getD(_xp(), _getA());
        uint256 totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) return PRECISION;
        return D * PRECISION / totalSupply;
    }

    // ========== SWAP ==========

    function swap(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external override nonReentrant whenNotPaused ensure(deadline) returns (uint256 amountOut) {
        require(tokenIndexIn < N_COINS && tokenIndexOut < N_COINS, "StablePool: invalid index");
        require(tokenIndexIn != tokenIndexOut, "StablePool: same token");
        require(amountIn > 0, "StablePool: zero input");
        require(to != address(0), "StablePool: zero address");

        uint256[2] memory xp = _xp();

        // Transfer tokens in
        IERC20(tokens[tokenIndexIn]).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 x = xp[tokenIndexIn] + amountIn * precisionMultipliers[tokenIndexIn];
        uint256 y = StableSwapMath.getY(tokenIndexIn, tokenIndexOut, x, xp, _getA());

        uint256 dy = xp[tokenIndexOut] - y - 1; // Normalized
        uint256 dyFee = dy * fee / FEE_DENOMINATOR;

        // Convert back to token decimals
        amountOut = (dy - dyFee) / precisionMultipliers[tokenIndexOut];
        uint256 adminFeeAmount = (dyFee * adminFee / FEE_DENOMINATOR) / precisionMultipliers[tokenIndexOut];

        require(amountOut >= minAmountOut, "StablePool: slippage");

        // Update balances
        balances[tokenIndexIn] += amountIn;
        balances[tokenIndexOut] -= (amountOut + adminFeeAmount);

        // Transfer tokens out
        IERC20(tokens[tokenIndexOut]).safeTransfer(to, amountOut);

        emit Swap(msg.sender, tokenIndexIn, tokenIndexOut, amountIn, amountOut, to);
    }

    // ========== LIQUIDITY ==========

    function addLiquidity(
        uint256[2] calldata amounts,
        uint256 minLPOut,
        uint256 deadline
    ) external override nonReentrant whenNotPaused ensure(deadline) returns (uint256 lpMinted) {
        require(amounts[0] > 0 || amounts[1] > 0, "StablePool: zero amounts");

        uint256 totalSupply = lpToken.totalSupply();
        uint256 amp = _getA();

        uint256[2] memory oldBalances = balances;
        uint256[2] memory newBalances;

        // Transfer tokens in
        for (uint256 i = 0; i < N_COINS; i++) {
            if (amounts[i] > 0) {
                IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
                newBalances[i] = oldBalances[i] + amounts[i];
            } else {
                newBalances[i] = oldBalances[i];
            }
        }

        if (totalSupply == 0) {
            // First deposit - require both tokens
            require(amounts[0] > 0 && amounts[1] > 0, "StablePool: initial deposit needs both");

            uint256[2] memory xp;
            xp[0] = newBalances[0] * precisionMultipliers[0];
            xp[1] = newBalances[1] * precisionMultipliers[1];

            uint256 D = StableSwapMath.getD(xp, amp);
            lpMinted = D - MINIMUM_LIQUIDITY;

            // Lock minimum liquidity
            lpToken.mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            // Compute D before and after
            uint256[2] memory oldXp;
            oldXp[0] = oldBalances[0] * precisionMultipliers[0];
            oldXp[1] = oldBalances[1] * precisionMultipliers[1];
            uint256 D0 = StableSwapMath.getD(oldXp, amp);

            uint256[2] memory newXp;
            newXp[0] = newBalances[0] * precisionMultipliers[0];
            newXp[1] = newBalances[1] * precisionMultipliers[1];
            uint256 D1 = StableSwapMath.getD(newXp, amp);

            require(D1 > D0, "StablePool: D must increase");

            // Charge imbalance fees (Curve pattern)
            // Ideal balance would be proportional to D change
            uint256[2] memory idealBalances;
            for (uint256 i = 0; i < N_COINS; i++) {
                idealBalances[i] = oldXp[i] * D1 / D0;
                uint256 diff = _abs(newXp[i], idealBalances[i]);
                uint256 feeAmount = fee * diff / FEE_DENOMINATOR;
                // Subtract full fee from xp for D2 (depositor gets fewer LP tokens)
                // Admin fee is a portion extracted separately from pool balances
                newBalances[i] -= (feeAmount * adminFee / FEE_DENOMINATOR) / precisionMultipliers[i];
                newXp[i] -= feeAmount;
            }

            uint256 D2 = StableSwapMath.getD(newXp, amp);
            lpMinted = totalSupply * (D2 - D0) / D0;
        }

        require(lpMinted >= minLPOut, "StablePool: slippage");

        // Update stored balances
        balances = newBalances;

        lpToken.mint(msg.sender, lpMinted);
        emit AddLiquidity(msg.sender, amounts, lpMinted);
    }

    function removeLiquidity(
        uint256 lpAmount,
        uint256[2] calldata minAmounts,
        uint256 deadline
    ) external override nonReentrant ensure(deadline) returns (uint256[2] memory amounts) {
        uint256 totalSupply = lpToken.totalSupply();
        require(lpAmount > 0 && lpAmount <= totalSupply, "StablePool: invalid LP amount");

        // Proportional withdrawal
        for (uint256 i = 0; i < N_COINS; i++) {
            amounts[i] = balances[i] * lpAmount / totalSupply;
            require(amounts[i] >= minAmounts[i], "StablePool: slippage");
            balances[i] -= amounts[i];
            IERC20(tokens[i]).safeTransfer(msg.sender, amounts[i]);
        }

        lpToken.burn(msg.sender, lpAmount);
        emit RemoveLiquidity(msg.sender, amounts, lpAmount);
    }

    function removeLiquidityOneToken(
        uint256 lpAmount,
        uint256 tokenIndex,
        uint256 minAmount,
        uint256 deadline
    ) external override nonReentrant ensure(deadline) returns (uint256 amount) {
        require(tokenIndex < N_COINS, "StablePool: invalid index");
        uint256 totalSupply = lpToken.totalSupply();
        require(lpAmount > 0 && lpAmount <= totalSupply, "StablePool: invalid LP amount");

        (uint256 dy, uint256 dyFee) = _calcRemoveOneToken(lpAmount, tokenIndex, totalSupply);
        amount = dy;
        require(amount >= minAmount, "StablePool: slippage");

        uint256 adminFeeAmount = dyFee * adminFee / FEE_DENOMINATOR;
        balances[tokenIndex] -= (amount + adminFeeAmount);

        lpToken.burn(msg.sender, lpAmount);
        IERC20(tokens[tokenIndex]).safeTransfer(msg.sender, amount);

        emit RemoveLiquidityOneToken(msg.sender, tokenIndex, amount, lpAmount);
    }

    function _calcRemoveOneToken(
        uint256 lpAmount,
        uint256 tokenIndex,
        uint256 totalSupply
    ) internal view returns (uint256 dy, uint256 dyFee) {
        uint256 amp = _getA();
        uint256[2] memory xp = _xp();
        uint256 D0 = StableSwapMath.getD(xp, amp);
        uint256 D1 = D0 - (D0 * lpAmount / totalSupply);

        uint256 newY = StableSwapMath.getYD(tokenIndex, xp, D1, amp);

        uint256[2] memory xpReduced;
        for (uint256 i = 0; i < N_COINS; i++) {
            uint256 idealBalance = xp[i] * D1 / D0;
            uint256 diff = _abs(xp[i], idealBalance);
            xpReduced[i] = xp[i] - (fee * diff / FEE_DENOMINATOR);
        }

        uint256 newYReduced = StableSwapMath.getYD(tokenIndex, xpReduced, D1, amp);
        uint256 precMul = precisionMultipliers[tokenIndex];

        dy = (xp[tokenIndex] - newYReduced - 1) / precMul;
        uint256 dyWithoutFee = (xp[tokenIndex] - newY) / precMul;
        dyFee = dyWithoutFee - dy;
    }

    // ========== ADMIN ==========

    /// @notice Ramp the amplification coefficient over time
    function rampA(uint256 newA, uint256 rampEndTime) external onlyRole(ADMIN_ROLE) {
        require(block.timestamp >= initialATime + MIN_RAMP_TIME, "StablePool: ramp active");
        require(rampEndTime >= block.timestamp + MIN_RAMP_TIME, "StablePool: ramp too short");

        uint256 currentA = _getA();
        uint256 newAScaled = newA * (N_COINS ** (N_COINS - 1)) * PRECISION;

        require(newAScaled > 0 && newAScaled <= MAX_A * N_COINS * PRECISION, "StablePool: invalid A");
        require(
            (newAScaled >= currentA && newAScaled <= currentA * MAX_A_CHANGE) ||
            (newAScaled < currentA && newAScaled * MAX_A_CHANGE >= currentA),
            "StablePool: A change too large"
        );

        initialA = currentA;
        futureA = newAScaled;
        initialATime = block.timestamp;
        futureATime = rampEndTime;

        emit RampA(currentA, newAScaled, block.timestamp, rampEndTime);
    }

    /// @notice Withdraw accumulated admin fees
    /// @dev Admin fees are the difference between tracked balances and actual token balances
    function withdrawAdminFees(address recipient) external onlyRole(ADMIN_ROLE) {
        require(recipient != address(0), "StablePool: zero address");

        for (uint256 i = 0; i < N_COINS; i++) {
            uint256 actualBalance = IERC20(tokens[i]).balanceOf(address(this));
            uint256 trackedBalance = balances[i];
            if (actualBalance > trackedBalance) {
                uint256 adminFeeAmount = actualBalance - trackedBalance;
                IERC20(tokens[i]).safeTransfer(recipient, adminFeeAmount);
            }
        }
    }

    function stopRampA() external onlyRole(ADMIN_ROLE) {
        uint256 currentA = _getA();
        initialA = currentA;
        futureA = currentA;
        initialATime = block.timestamp;
        futureATime = block.timestamp;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ========== INTERNAL ==========

    function _getA() internal view returns (uint256) {
        uint256 t1 = futureATime;
        uint256 A1 = futureA;

        if (block.timestamp < t1) {
            uint256 t0 = initialATime;
            uint256 A0 = initialA;

            if (A1 > A0) {
                return A0 + (A1 - A0) * (block.timestamp - t0) / (t1 - t0);
            } else {
                return A0 - (A0 - A1) * (block.timestamp - t0) / (t1 - t0);
            }
        }

        return A1;
    }

    /// @notice Get normalized balances (18 decimals)
    function _xp() internal view returns (uint256[2] memory xp) {
        xp[0] = balances[0] * precisionMultipliers[0];
        xp[1] = balances[1] * precisionMultipliers[1];
    }

    function _abs(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _getDecimals(address token) internal view returns (uint8) {
        // Must successfully return decimals - silent fallback to 18 would break
        // math for 6-decimal tokens by 10^12
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            require(d <= 18, "StablePool: decimals > 18");
            return d;
        } catch {
            revert("StablePool: token must implement decimals()");
        }
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}
