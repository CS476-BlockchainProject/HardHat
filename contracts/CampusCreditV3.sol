// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract BankMintToken is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    ERC20Capped,
    AccessControl,
    EIP712
{
    // -------- Roles --------
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant ENDORSER_ROLE = keccak256("ENDORSER_ROLE");

    // -------- Custom Errors --------
    error ArrayLengthMismatch();
    error CapExceeded(uint256 cap, uint256 newTotal);
    error EndorsementExpired();
    error EndorsementBadSigner();

    // -------- EIP-712 Endorsements --------
    // typed structure: Action(address caller, bytes32 actionId, bytes32 payloadHash, uint256 nonce, uint256 deadline)
    bytes32 private constant ACTION_TYPEHASH =
        keccak256("Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)");

    // Action tags for domain separation / audit clarity
    bytes32 public constant ACTION_MINT    = keccak256("MINT");
    bytes32 public constant ACTION_AIRDROP = keccak256("AIRDROP");

    // Nonces are consumed per-caller (the account performing the action on-chain)
    mapping(address => uint256) public nonces;

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
        EIP712("BankMintToken-Endorsement", "1")
    {
        require(initialReceiver != address(0), "InvalidReceiver");

        // Grant roles to deployer by default
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(ENDORSER_ROLE, msg.sender); // optional: deployer can endorse by default

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
    /// @dev Unchanged legacy path (no endorsement). Keep for backward compatibility.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Batch airdrop minting. Reverts on length mismatch or if cap would be exceeded.
    /// @dev Unchanged legacy path (no endorsement). Keep for backward compatibility.
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

    // -------- Endorsed (Dual-Control) variants --------
    // Use these if you want gateway/endorser approval on sensitive actions.

    /// @notice Mint tokens with EIP-712 endorsement by an ENDORSER_ROLE signer.
    /// @param to Recipient
    /// @param amount Mint amount
    /// @param deadline Unix timestamp after which the endorsement is invalid
    /// @param sig Signature from an ENDORSER_ROLE address over the typed Action
    function mintEndorsed(
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata sig
    ) external onlyRole(MINTER_ROLE) {
        // bind endorsement to the on-chain caller (the minter account)
        bytes32 payloadHash = keccak256(abi.encode(to, amount));
        _requireEndorsement(msg.sender, ACTION_MINT, payloadHash, deadline, sig);

        _mint(to, amount);
    }

    /// @notice Airdrop mint with EIP-712 endorsement by an ENDORSER_ROLE signer.
    /// @dev The payload is hashed as keccak(to[]) || keccak(amounts[]) to keep signatures small.
    function airdropEndorsed(
        address[] calldata to,
        uint256[] calldata amounts,
        uint256 deadline,
        bytes calldata sig
    ) external onlyRole(MINTER_ROLE) {
        if (to.length != amounts.length) revert ArrayLengthMismatch();

        // pre-check cap
        uint256 total;
        unchecked {
            for (uint256 i; i < amounts.length; ++i) total += amounts[i];
        }
        uint256 newTotal = totalSupply() + total;
        if (newTotal > cap()) revert CapExceeded(cap(), newTotal);

        // hash arrays compactly
        bytes32 toHash      = keccak256(abi.encodePacked(to));
        bytes32 amountsHash = keccak256(abi.encodePacked(amounts));
        bytes32 payloadHash = keccak256(abi.encode(toHash, amountsHash));

        _requireEndorsement(msg.sender, ACTION_AIRDROP, payloadHash, deadline, sig);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amounts[i]);
        }
    }

    // -------- Endorsement verifier --------

    function _requireEndorsement(
        address caller,
        bytes32 actionId,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata sig
    ) internal {
        if (block.timestamp > deadline) revert EndorsementExpired();

        uint256 nonce = nonces[caller]++; // consume per-caller nonce

        bytes32 structHash = keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                caller,
                actionId,
                payloadHash,
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(digest, sig);
        if (!hasRole(ENDORSER_ROLE, signer)) revert EndorsementBadSigner();
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