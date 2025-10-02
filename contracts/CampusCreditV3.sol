// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract BankMintToken is ERC20, ERC20Burnable, ERC20Pausable, ERC20Capped, AccessControl {
    // -------- Roles --------
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // -------- Custom Errors --------
    error ArrayLengthMismatch();
    error CapExceeded(uint256 cap, uint256 newTotal);

    /// @param name_ Token name
    /// @param symbol_ Token symbol
    /// @param cap_ Max total supply (wei units, 18 decimals)
    /// @param initialReceiver Address to receive the initial mint
    /// @param initialMint Amount to mint on deploy (wei units)
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 cap_,
        address initialReceiver,
        uint256 initialMint
    )
        ERC20(name_, symbol_)
        ERC20Capped(cap_)
    {
        require(initialReceiver != address(0), "InvalidReceiver");

        // Grant roles to deployer by default
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);

        if (initialMint > 0) {
            _mint(initialReceiver, initialMint); // cap enforced by ERC20Capped
        }
    }

    // -------- Admin functions --------

    /// @notice Pause token transfers (only PAUSER_ROLE)
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Unpause token transfers (only PAUSER_ROLE)
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Mint tokens (only MINTER_ROLE). Cap is enforced.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Batch airdrop minting. Reverts on length mismatch or if cap would be exceeded.
    /// @param to Recipients
    /// @param amounts Mint amounts per recipient (wei units)
    function airdrop(address[] calldata to, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        if (to.length != amounts.length) revert ArrayLengthMismatch();

        uint256 total;
        unchecked {
            for (uint256 i; i < amounts.length; ++i) {
                total += amounts[i];
            }
        }
        uint256 newTotal = totalSupply() + total;
        if (newTotal > cap()) revert CapExceeded(cap(), newTotal);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amounts[i]);
        }
    }

    // -------- Hooks / Overrides --------

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable, ERC20Capped)
    {
        super._update(from, to, value);
    }

    /// @dev AccessControl adds supportsInterface
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
