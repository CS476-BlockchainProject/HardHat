// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReceiptNFT
 * @notice ERC-721 receipts for SavingsPool deposits.
 *         Only the SavingsPool (set as `pool`) can mint/burn.
 * @dev OpenZeppelin v4; override only from direct base (ERC721URIStorage).
 */
contract ReceiptNFT is ERC721URIStorage, Ownable {
    address public pool;

    error NotPool();

    modifier onlyPool() {
        if (msg.sender != pool) revert NotPool();
        _;
    }

    // OZ v4: Ownable has no-arg constructor; owner = msg.sender
    constructor() ERC721("Savings Receipt", "RECEIPT") {}

    /// @notice One-time or updatable link to the SavingsPool.
    function setPool(address _pool) external onlyOwner {
        require(_pool != address(0), "pool=0");
        pool = _pool;
    }

    /// @notice Mint a receipt to `to` with `tokenId`. Optionally set a tokenURI.
    function mint(address to, uint256 tokenId, string calldata uri) external onlyPool {
        _safeMint(to, tokenId);
        if (bytes(uri).length != 0) {
            _setTokenURI(tokenId, uri);
        }
    }

    /// @notice Burn a receipt. Only the SavingsPool can burn on withdraw.
    function burn(uint256 tokenId) external onlyPool {
        _burn(tokenId);
    }

    // --- Required overrides for OZ v4 ---
    // Only override from the direct base class we inherit (ERC721URIStorage).
    function _burn(uint256 tokenId)
        internal
        virtual
        override(ERC721URIStorage)
    {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override(ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
}