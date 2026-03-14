// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Test ERC-20 token with configurable decimals and public mint
/// @dev Used on testnet when native asset precompile addresses are unavailable
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 dec
    ) ERC20(name, symbol) {
        _decimals = dec;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Public mint for testnet usage
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
