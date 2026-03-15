// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title LPToken
/// @notice ERC-20 token representing liquidity pool shares
/// @dev Only the pool contract (MINTER_ROLE) can mint/burn
contract LPToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory name, string memory symbol, address pool) ERC20(name, symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, pool);
        _grantRole(MINTER_ROLE, pool);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}
