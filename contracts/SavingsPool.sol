// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IReceiptNFT {
    function mint(address to, uint256 tokenId, string calldata uri) external;
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title SavingsPool
 * @notice Native-token savings pool that mints a ReceiptNFT on deposit and burns it on withdraw.
 *         Interest accrues linearly using APR in basis points (simple interest).
 * @dev OpenZeppelin v4 imports + no-arg Ownable.
 */
contract SavingsPool is Ownable, ReentrancyGuard {
    struct Position {
        uint128 principal; // wei
        uint64  start;     // timestamp (seconds)
        bool    active;    // true until withdrawn
    }

    /// @notice APR in basis points (e.g., 500 = 5%)
    uint256 public aprBps;

    /// @notice Next position/NFT id
    uint256 public nextId;

    /// @notice Receipt NFT contract
    IReceiptNFT public immutable receipt;

    /// @dev tokenId (positionId) => Position
    mapping(uint256 => Position) public positions;

    event Deposited(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event Withdrawn(uint256 indexed tokenId, address indexed owner, uint256 payout);
    event AprUpdated(uint256 oldBps, uint256 newBps);

    /**
     * @param _aprBps  Initial APR in basis points (max 5000 = 50%)
     * @param _receipt Address of the ReceiptNFT contract
     */
    constructor(uint256 _aprBps, address _receipt) {
        require(_receipt != address(0), "receipt=0");
        require(_aprBps <= 5000, "apr too high");
        aprBps = _aprBps;
        receipt = IReceiptNFT(_receipt);
        // Ownable (v4) sets owner = msg.sender by default.
    }

    /// @notice Admin: set APR (bps)
    function setApr(uint256 bps) external onlyOwner {
        require(bps <= 5000, "apr too high");
        uint256 old = aprBps;
        aprBps = bps;
        emit AprUpdated(old, bps);
    }

    /// @notice Deposit native TT and mint a receipt NFT.
    function deposit() external payable nonReentrant returns (uint256 tokenId) {
        // Pass an empty URI using memory (internal helper expects memory)
        return _depositWithURI("");
    }

    /// @notice Deposit + set a custom tokenURI on the receipt (optional IPFS metadata).
    function depositWithURI(string calldata uri)
        external
        payable
        nonReentrant
        returns (uint256 tokenId)
    {
        return _depositWithURI(uri);
    }

    /// @dev Internal deposit implementation. Takes `memory` so both "" and calldata can be passed.
    function _depositWithURI(string memory uri) internal returns (uint256 tokenId) {
        uint256 amount = msg.value;
        require(amount > 0, "amount=0");

        tokenId = ++nextId;
        positions[tokenId] = Position({
            principal: uint128(amount),
            start: uint64(block.timestamp),
            active: true
        });

        // Effects done; now interaction
        receipt.mint(msg.sender, tokenId, uri);

        emit Deposited(tokenId, msg.sender, amount);
    }

    /// @notice Interest accrued (in wei) for a position.
    function accrued(uint256 tokenId) public view returns (uint256) {
        Position memory p = positions[tokenId];
        require(p.active, "!active");
        uint256 dt = block.timestamp - p.start; // seconds
        // interest = principal * aprBps * dt / (365 days * 10000)
        return (uint256(p.principal) * aprBps * dt) / (365 days * 10000);
    }

    /// @notice Convenience: principal + accrued (in wei).
    function payoutOf(uint256 tokenId) external view returns (uint256) {
        Position memory p = positions[tokenId];
        require(p.active, "!active");
        return uint256(p.principal) + accrued(tokenId);
    }

    /// @notice Withdraw principal + accrued; burns the receipt NFT (must be NFT owner).
    function withdraw(uint256 tokenId) external nonReentrant {
        Position storage p = positions[tokenId];
        require(p.active, "!active");
        require(receipt.ownerOf(tokenId) == msg.sender, "!owner");

        // Effects
        p.active = false;
        uint256 pay = uint256(p.principal) + accrued(tokenId);

        // Interactions
        receipt.burn(tokenId);

        (bool ok, ) = msg.sender.call{ value: pay }("");
        require(ok, "xfer failed");

        emit Withdrawn(tokenId, msg.sender, pay);
    }

    /// @dev Prevent accidental plain ETH sends.
    receive() external payable {
        revert("use deposit()");
    }
}