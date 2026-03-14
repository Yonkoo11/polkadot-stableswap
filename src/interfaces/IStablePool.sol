// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IStablePool {
    event Swap(
        address indexed sender,
        uint256 tokenIn,
        uint256 tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed to
    );

    event AddLiquidity(
        address indexed provider,
        uint256[2] amounts,
        uint256 lpMinted
    );

    event RemoveLiquidity(
        address indexed provider,
        uint256[2] amounts,
        uint256 lpBurned
    );

    event RemoveLiquidityOneToken(
        address indexed provider,
        uint256 tokenIndex,
        uint256 amount,
        uint256 lpBurned
    );

    event RampA(uint256 oldA, uint256 newA, uint256 startTime, uint256 endTime);

    function swap(
        uint256 tokenIndexIn,
        uint256 tokenIndexOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);

    function addLiquidity(
        uint256[2] calldata amounts,
        uint256 minLPOut,
        uint256 deadline
    ) external returns (uint256 lpMinted);

    function removeLiquidity(
        uint256 lpAmount,
        uint256[2] calldata minAmounts,
        uint256 deadline
    ) external returns (uint256[2] memory amounts);

    function removeLiquidityOneToken(
        uint256 lpAmount,
        uint256 tokenIndex,
        uint256 minAmount,
        uint256 deadline
    ) external returns (uint256 amount);

    function getDy(uint256 i, uint256 j, uint256 dx) external view returns (uint256);
    function getVirtualPrice() external view returns (uint256);
    function getA() external view returns (uint256);
    function getTokenBalance(uint256 index) external view returns (uint256);
    function getToken(uint256 index) external view returns (address);
}
