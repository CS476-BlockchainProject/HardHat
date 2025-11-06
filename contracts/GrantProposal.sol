// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract GrantProposal is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    ERC20Capped,
    AccessControl,
    EIP712
{
    // -------- Roles (existing) --------
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant ENDORSER_ROLE = keccak256("ENDORSER_ROLE");

    // -------- New Role (for proposal reviews) --------
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    // -------- Custom Errors (existing + reused by proposals) --------
    error ArrayLengthMismatch();
    error CapExceeded(uint256 cap, uint256 newTotal);
    error EndorsementExpired();
    error EndorsementBadSigner();
    error InvalidStatus();
    error NotProposer();
    error AlreadyVoted();
    error PastDeadline();
    error BadThreshold();
    error NothingToDisburse();
    error InsufficientPool();
    error Unauthorized();

    // -------- EIP-712 Endorsements (existing) --------
    // typed structure: Action(address caller, bytes32 actionId, bytes32 payloadHash, uint256 nonce, uint256 deadline)
    bytes32 private constant ACTION_TYPEHASH =
        keccak256("Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)");

    // Action tags for domain separation / audit clarity (existing)
    bytes32 public constant ACTION_MINT    = keccak256("MINT");
    bytes32 public constant ACTION_AIRDROP = keccak256("AIRDROP");

    // Additional action tags (new) to endorse proposal operations if desired
    bytes32 public constant ACTION_CREATE_PROPOSAL = keccak256("CREATE_PROPOSAL");
    bytes32 public constant ACTION_REVIEW_PROPOSAL = keccak256("REVIEW_PROPOSAL");

    // Nonces are consumed per-caller (existing)
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

        // Grant roles to deployer by default (existing)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(ENDORSER_ROLE, msg.sender); // optional: deployer can endorse by default

        if (initialMint > 0) {
            _mint(initialReceiver, initialMint); // cap enforced by ERC20Capped
        }
    }

    // -------- Admin functions (existing) --------

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

    // -------- Endorsed (Dual-Control) variants (existing) --------

    /// @notice Mint tokens with EIP-712 endorsement by an ENDORSER_ROLE signer.
    function mintEndorsed(
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata sig
    ) external onlyRole(MINTER_ROLE) {
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

        uint256 total;
        unchecked { for (uint256 i; i < amounts.length; ++i) total += amounts[i]; }
        uint256 newTotal = totalSupply() + total;
        if (newTotal > cap()) revert CapExceeded(cap(), newTotal);

        bytes32 toHash      = keccak256(abi.encodePacked(to));
        bytes32 amountsHash = keccak256(abi.encodePacked(amounts));
        bytes32 payloadHash = keccak256(abi.encode(toHash, amountsHash));

        _requireEndorsement(msg.sender, ACTION_AIRDROP, payloadHash, deadline, sig);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amounts[i]);
        }
    }

    // ======================================================================
    // ========== NEW: On-chain Grant Proposals (create/submit/review) =======
    // ======================================================================

    enum ProposalStatus { Draft, Submitted, Approved, Rejected, Cancelled, Funded }

    struct Proposal {
        address proposer;
        string  title;
        string  metadataURI;      // IPFS/HTTP pointer to full proposal details
        uint256 requestedAmount;  // wei (paid from this contract’s ETH pool)
        uint64  reviewDeadline;   // timestamp by which reviews must conclude
        ProposalStatus status;
        uint32  approvals;
        uint32  rejections;
        bool    paid;
    }

    uint256 public proposalCount;
    uint256 public approvalThreshold;   // e.g., 2
    uint256 public rejectionThreshold;  // e.g., 2
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _voted; // proposalId => reviewer => voted?

    // ---- Events (new) ----
    event ReviewerAdded(address indexed account);
    event ReviewerRemoved(address indexed account);
    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        string title,
        uint256 requestedAmount,
        uint64 reviewDeadline
    );
    event ProposalUpdated(
        uint256 indexed id,
        string title,
        string metadataURI,
        uint256 requestedAmount,
        uint64 reviewDeadline
    );
    event ProposalSubmitted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event ProposalReviewed(
        uint256 indexed id,
        address indexed reviewer,
        bool approved,
        uint32 approvals,
        uint32 rejections
    );
    event ProposalFinalized(uint256 indexed id, ProposalStatus status);
    event FundsDeposited(address indexed from, uint256 amount);
    event FundsDisbursed(uint256 indexed id, address indexed to, uint256 amount);

    // ---- Admin controls for proposal system ----
    function setProposalThresholds(uint256 _approvalThreshold, uint256 _rejectionThreshold)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setProposalThresholds(_approvalThreshold, _rejectionThreshold);
    }

    function _setProposalThresholds(uint256 _approvalThreshold, uint256 _rejectionThreshold) internal {
        if (_approvalThreshold == 0 || _rejectionThreshold == 0) revert BadThreshold();
        approvalThreshold  = _approvalThreshold;
        rejectionThreshold = _rejectionThreshold;
    }

    function addReviewer(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(REVIEWER_ROLE, account);
        emit ReviewerAdded(account);
    }

    function removeReviewer(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(REVIEWER_ROLE, account);
        emit ReviewerRemoved(account);
    }

    // ---- Proposal authoring ----
    function createProposal(
        string calldata title,
        string calldata metadataURI,
        uint256 requestedAmount,
        uint64  reviewDeadline
    ) external whenNotPaused returns (uint256 id) {
        require(bytes(title).length > 0, "title required");
        require(requestedAmount > 0, "amount > 0");
        require(reviewDeadline > block.timestamp, "deadline future");

        id = ++proposalCount;
        _proposals[id] = Proposal({
            proposer: msg.sender,
            title: title,
            metadataURI: metadataURI,
            requestedAmount: requestedAmount,
            reviewDeadline: reviewDeadline,
            status: ProposalStatus.Draft,
            approvals: 0,
            rejections: 0,
            paid: false
        });

        emit ProposalCreated(id, msg.sender, title, requestedAmount, reviewDeadline);
    }

    function updateDraft(
        uint256 id,
        string calldata title,
        string calldata metadataURI,
        uint256 requestedAmount,
        uint64  reviewDeadline
    ) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.proposer != msg.sender) revert NotProposer();
        if (p.status != ProposalStatus.Draft) revert InvalidStatus();
        require(bytes(title).length > 0, "title required");
        require(requestedAmount > 0, "amount > 0");
        require(reviewDeadline > block.timestamp, "deadline future");

        p.title = title;
        p.metadataURI = metadataURI;
        p.requestedAmount = requestedAmount;
        p.reviewDeadline = reviewDeadline;

        emit ProposalUpdated(id, title, metadataURI, requestedAmount, reviewDeadline);
    }

    function submit(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.proposer != msg.sender) revert NotProposer();
        if (p.status != ProposalStatus.Draft) revert InvalidStatus();
        if (p.reviewDeadline <= block.timestamp) revert PastDeadline();

        p.status = ProposalStatus.Submitted;
        emit ProposalSubmitted(id);
    }

    function cancel(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (msg.sender != p.proposer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        if (p.status != ProposalStatus.Draft && p.status != ProposalStatus.Submitted) revert InvalidStatus();

        p.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(id);
        emit ProposalFinalized(id, ProposalStatus.Cancelled);
    }

    // ---- Endorsed submission (reuses your EIP-712 endorsement flow) ----
    function submitProposalEndorsed(
        string calldata title,
        string calldata metadataURI,
        uint256 requestedAmount,
        uint64  reviewDeadline,
        uint256 endorsementDeadline,
        bytes   calldata sig
    ) external whenNotPaused returns (uint256 id) {
        require(bytes(title).length > 0, "title required");
        require(requestedAmount > 0, "amount > 0");
        require(reviewDeadline > block.timestamp, "deadline future");

        bytes32 payloadHash = keccak256(
            abi.encode(
                keccak256(bytes(title)),
                keccak256(bytes(metadataURI)),
                requestedAmount,
                reviewDeadline
            )
        );

        _requireEndorsement(
            msg.sender,
            ACTION_CREATE_PROPOSAL,
            payloadHash,
            endorsementDeadline,
            sig
        );

        id = ++proposalCount;
        _proposals[id] = Proposal({
            proposer: msg.sender,
            title: title,
            metadataURI: metadataURI,
            requestedAmount: requestedAmount,
            reviewDeadline: reviewDeadline,
            status: ProposalStatus.Submitted,
            approvals: 0,
            rejections: 0,
            paid: false
        });

        emit ProposalCreated(id, msg.sender, title, requestedAmount, reviewDeadline);
        emit ProposalSubmitted(id);
    }

    // ---- Reviewing ----
    function review(uint256 id, bool approve) external whenNotPaused onlyRole(REVIEWER_ROLE) {
        Proposal storage p = _proposals[id];
        if (p.status != ProposalStatus.Submitted) revert InvalidStatus();
        if (p.reviewDeadline <= block.timestamp) revert PastDeadline();
        if (_voted[id][msg.sender]) revert AlreadyVoted();

        _voted[id][msg.sender] = true;
        if (approve) p.approvals += 1;
        else p.rejections += 1;

        emit ProposalReviewed(id, msg.sender, approve, p.approvals, p.rejections);

        if (p.approvals >= approvalThreshold) {
            p.status = ProposalStatus.Approved;
            emit ProposalFinalized(id, ProposalStatus.Approved);
        } else if (p.rejections >= rejectionThreshold) {
            p.status = ProposalStatus.Rejected;
            emit ProposalFinalized(id, ProposalStatus.Rejected);
        }
    }

    /// @notice If no threshold reached by the review deadline, anyone can finalize to Rejected.
    function finalizeAfterDeadline(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.status != ProposalStatus.Submitted) revert InvalidStatus();
        if (block.timestamp < p.reviewDeadline) revert PastDeadline();
        p.status = ProposalStatus.Rejected;
        emit ProposalFinalized(id, ProposalStatus.Rejected);
    }

    // ---- ETH funding pool for disbursements ----
    receive() external payable { emit FundsDeposited(msg.sender, msg.value); }
    function deposit() external payable { emit FundsDeposited(msg.sender, msg.value); }

    /// @notice Pay out the requested amount to proposer if Approved and pool has enough ETH.
    function disburse(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.status != ProposalStatus.Approved || p.paid) revert NothingToDisburse();
        if (address(this).balance < p.requestedAmount) revert InsufficientPool();

        p.paid = true;
        p.status = ProposalStatus.Funded;

        (bool ok, ) = p.proposer.call{value: p.requestedAmount}("");
        require(ok, "transfer failed");

        emit FundsDisbursed(id, p.proposer, p.requestedAmount);
        emit ProposalFinalized(id, ProposalStatus.Funded);
    }

    // ---- Views ----
    function getProposal(uint256 id)
        external
        view
        returns (
            address proposer,
            string memory title,
            string memory metadataURI,
            uint256 requestedAmount,
            uint64  reviewDeadline,
            ProposalStatus status,
            uint32 approvals,
            uint32 rejections,
            bool   paid
        )
    {
        Proposal storage p = _proposals[id];
        proposer        = p.proposer;
        title           = p.title;
        metadataURI     = p.metadataURI;
        requestedAmount = p.requestedAmount;
        reviewDeadline  = p.reviewDeadline;
        status          = p.status;
        approvals       = p.approvals;
        rejections      = p.rejections;
        paid            = p.paid;
    }

    function hasVoted(uint256 id, address reviewer) external view returns (bool) {
        return _voted[id][reviewer];
    }

    // -------- Endorsement verifier (existing, reused by proposals) --------
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

    // -------- Hooks / Overrides (existing) --------
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