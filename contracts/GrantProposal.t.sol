// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title GrantProposalsV2
 * @notice On-chain grant proposals with optional EIP-712 endorsed submission.
 * @dev    Aligned with your existing BankMintToken endorsement flow:
 *         - Same EIP-712 Action struct/typehash
 *         - Domain: "BankMintToken-Endorsement" / "1"
 *         - nonces(address) per-caller
 *         - ENDORSER_ROLE gating + EndorsementExpired/EndorsementBadSigner errors
 *
 * Roles:
 *   - DEFAULT_ADMIN_ROLE: manage reviewers, thresholds, pause/unpause.
 *   - REVIEWER_ROLE: can review proposals (approve/reject).
 *   - ENDORSER_ROLE: allowed to endorse off-chain actions consumed on-chain.
 */

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GrantProposalsV2 is AccessControl, Pausable, ReentrancyGuard {
    // ----------- Errors (match names used in your token project) -----------
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

    // ----------- Roles -----------
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant ENDORSER_ROLE = keccak256("ENDORSER_ROLE");

    // ----------- EIP-712 compatibility (same shape/name/version) -----------
    // keccak256("Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)")
    bytes32 public constant ACTION_TYPEHASH = keccak256(
        "Action(address caller,bytes32 actionId,bytes32 payloadHash,uint256 nonce,uint256 deadline)"
    );

    // Domain kept identical to your token helpers so your existing digest code works.
    // name = "BankMintToken-Endorsement", version = "1"
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("BankMintToken-Endorsement")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Per-caller nonce (consumed by endorsed actions).
    mapping(address => uint256) public nonces;

    // Suggested action ids for your client-side constants/utilities
    bytes32 public constant ACTION_CREATE_PROPOSAL = keccak256("CREATE_PROPOSAL");
    bytes32 public constant ACTION_REVIEW_PROPOSAL = keccak256("REVIEW_PROPOSAL");

    // ----------- Types -----------
    enum Status {
        Draft,
        Submitted,
        Approved,
        Rejected,
        Cancelled,
        Funded
    }

    struct Proposal {
        address proposer;
        string title;
        string metadataURI;      // IPFS/HTTP pointer to full details
        uint256 requestedAmount; // wei
        uint64  reviewDeadline;  // timestamp — reviews must finish before this time
        Status  status;
        uint32  approvals;
        uint32  rejections;
        bool    paid;
    }

    // ----------- Storage -----------
    uint256 public proposalCount;
    uint256 public approvalThreshold;  // e.g., 2
    uint256 public rejectionThreshold; // e.g., 2

    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) private _voted; // proposalId => reviewer => voted?

    // ----------- Events -----------
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
    event ProposalFinalized(uint256 indexed id, Status status);
    event FundsDeposited(address indexed from, uint256 amount);
    event FundsDisbursed(uint256 indexed id, address indexed to, uint256 amount);

    // ----------- Constructor -----------
    constructor(
        address admin,
        address[] memory initialReviewers,
        uint256 _approvalThreshold,
        uint256 _rejectionThreshold
    ) {
        if (admin == address(0)) admin = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        for (uint256 i = 0; i < initialReviewers.length; i++) {
            _grantRole(REVIEWER_ROLE, initialReviewers[i]);
            emit ReviewerAdded(initialReviewers[i]);
        }

        _setThresholds(_approvalThreshold, _rejectionThreshold);
    }

    // ----------- Admin controls -----------
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setThresholds(uint256 _approvalThreshold, uint256 _rejectionThreshold)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setThresholds(_approvalThreshold, _rejectionThreshold);
    }

    function _setThresholds(uint256 _approvalThreshold, uint256 _rejectionThreshold) internal {
        if (_approvalThreshold == 0 || _rejectionThreshold == 0) revert BadThreshold();
        approvalThreshold = _approvalThreshold;
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

    // ----------- Proposal authoring -----------
    function createProposal(
        string calldata title,
        string calldata metadataURI,
        uint256 requestedAmount,
        uint64 reviewDeadline
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
            status: Status.Draft,
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
        uint64 reviewDeadline
    ) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.proposer != msg.sender) revert NotProposer();
        if (p.status != Status.Draft) revert InvalidStatus();
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
        if (p.status != Status.Draft) revert InvalidStatus();
        if (p.reviewDeadline <= block.timestamp) revert PastDeadline();

        p.status = Status.Submitted;
        emit ProposalSubmitted(id);
    }

    function cancel(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (msg.sender != p.proposer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert Unauthorized();
        if (p.status != Status.Draft && p.status != Status.Submitted) revert InvalidStatus();

        p.status = Status.Cancelled;
        emit ProposalCancelled(id);
        emit ProposalFinalized(id, Status.Cancelled);
    }

    // ----------- Endorsed submission (EIP-712; matches your helpers) -----------
    /**
     * @notice Submit a brand-new proposal using an off-chain endorsement from ENDORSER_ROLE.
     * @dev    Payload hash you should build off-chain (mirrors your existing pattern):
     *         keccak256(abi.encode(
     *             keccak256(bytes(title)),
     *             keccak256(bytes(metadataURI)),
     *             requestedAmount,
     *             reviewDeadline
     *         ))
     *         actionId = ACTION_CREATE_PROPOSAL
     *         caller   = msg.sender (included in digest)
     *         nonce    = nonces[msg.sender]
     */
    function submitProposalEndorsed(
        string calldata title,
        string calldata metadataURI,
        uint256 requestedAmount,
        uint64  reviewDeadline,
        uint256 endorsementDeadline,
        bytes calldata signature
    ) external whenNotPaused returns (uint256 id) {
        require(bytes(title).length > 0, "title required");
        require(requestedAmount > 0, "amount > 0");
        require(reviewDeadline > block.timestamp, "deadline future");

        // Build payloadHash exactly like in your client/tests flow
        bytes32 payloadHash = keccak256(
            abi.encode(
                keccak256(bytes(title)),
                keccak256(bytes(metadataURI)),
                requestedAmount,
                reviewDeadline
            )
        );

        _verifyAndConsumeEndorsement(
            msg.sender,
            ACTION_CREATE_PROPOSAL,
            payloadHash,
            endorsementDeadline,
            signature
        );

        // Create DRAFT + immediately mark as SUBMITTED (since this is a submission)
        id = ++proposalCount;

        _proposals[id] = Proposal({
            proposer: msg.sender,
            title: title,
            metadataURI: metadataURI,
            requestedAmount: requestedAmount,
            reviewDeadline: reviewDeadline,
            status: Status.Submitted,
            approvals: 0,
            rejections: 0,
            paid: false
        });

        emit ProposalCreated(id, msg.sender, title, requestedAmount, reviewDeadline);
        emit ProposalSubmitted(id);
    }

    // ----------- Reviewing -----------
    function review(uint256 id, bool approve) external whenNotPaused onlyRole(REVIEWER_ROLE) {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Submitted) revert InvalidStatus();
        if (p.reviewDeadline <= block.timestamp) revert PastDeadline();
        if (_voted[id][msg.sender]) revert AlreadyVoted();

        _voted[id][msg.sender] = true;
        if (approve) {
            p.approvals += 1;
        } else {
            p.rejections += 1;
        }

        emit ProposalReviewed(id, msg.sender, approve, p.approvals, p.rejections);

        // finalize automatically on threshold
        if (p.approvals >= approvalThreshold) {
            p.status = Status.Approved;
            emit ProposalFinalized(id, Status.Approved);
        } else if (p.rejections >= rejectionThreshold) {
            p.status = Status.Rejected;
            emit ProposalFinalized(id, Status.Rejected);
        }
    }

    /**
     * @notice If no threshold reached by the review deadline, anyone can finalize to Rejected.
     */
    function finalizeAfterDeadline(uint256 id) external whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Submitted) revert InvalidStatus();
        if (block.timestamp < p.reviewDeadline) revert PastDeadline();
        p.status = Status.Rejected;
        emit ProposalFinalized(id, Status.Rejected);
    }

    // ----------- Funding Pool (ETH) -----------
    receive() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }

    function deposit() external payable {
        emit FundsDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Disburse funds for an approved proposal.
     */
    function disburse(uint256 id) external nonReentrant whenNotPaused {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Approved || p.paid) revert NothingToDisburse();
        if (address(this).balance < p.requestedAmount) revert InsufficientPool();

        p.paid = true;
        p.status = Status.Funded;

        (bool ok, ) = p.proposer.call{value: p.requestedAmount}("");
        require(ok, "transfer failed");

        emit FundsDisbursed(id, p.proposer, p.requestedAmount);
        emit ProposalFinalized(id, Status.Funded);
    }

    // ----------- Views -----------
    function getProposal(uint256 id)
        external
        view
        returns (
            address proposer,
            string memory title,
            string memory metadataURI,
            uint256 requestedAmount,
            uint64 reviewDeadline,
            Status status,
            uint32 approvals,
            uint32 rejections,
            bool paid
        )
    {
        Proposal storage p = _proposals[id];
        proposer = p.proposer;
        title = p.title;
        metadataURI = p.metadataURI;
        requestedAmount = p.requestedAmount;
        reviewDeadline = p.reviewDeadline;
        status = p.status;
        approvals = p.approvals;
        rejections = p.rejections;
        paid = p.paid;
    }

    function hasVoted(uint256 id, address reviewer) external view returns (bool) {
        return _voted[id][reviewer];
    }

    // ----------- Internal: endorsement verification (matches your Action flow) -----------
    function _verifyAndConsumeEndorsement(
        address caller,
        bytes32 actionId,
        bytes32 payloadHash,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        if (block.timestamp > deadline) revert EndorsementExpired();

        bytes32 ds = domainSeparator();
        uint256 nonce = nonces[caller];

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

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ds, structHash));

        // Parse r,s,v from 65-byte signature (r||s||v)
        if (signature.length != 65) revert EndorsementBadSigner();
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || !hasRole(ENDORSER_ROLE, signer)) {
            revert EndorsementBadSigner();
        }

        unchecked {
            nonces[caller] = nonce + 1;
        }
    }
}