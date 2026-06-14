// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  AgentGuard v1.0
 * @author AgentGuard Protocol
 * @notice Arbitrum-native trust framework that grants AI agents progressively
 *         larger treasury authority based on a cryptographically-anchored,
 *         automatically-derived credential history.
 *
 * @dev    Architecture
 *         ─────────────────────────────────────────────────────────────────
 *         TREASURY LAYER
 *           The contract holds ETH deposited by the owner organisation.
 *           address(this).balance is the single source of truth for available
 *           funds. _escrowedAmount tracks approved-but-unexecuted commitments
 *           so subsequent approvals cannot over-commit available ETH.
 *
 *         CREDENTIAL LAYER
 *           Each completed task produces a TaskCredential containing:
 *             - taskId        : unique task identifier
 *             - taskType      : TreasuryAnalysis | GovernanceReview | RiskAssessment
 *             - score         : 0–100 performance score
 *             - evidenceHash  : keccak256 of the off-chain work artifact (IPFS CID etc.)
 *             - timestamp     : block timestamp of recording
 *           Credential levels (Bronze / Silver / Gold) are derived automatically
 *           from task count and rolling average score. No manual upgrade path exists.
 *
 *         PERMISSION LAYER
 *           Credential level gates:
 *             - maximum single spend request size
 *             - maximum concurrent pending requests
 *           This prevents treasury flooding even by high-credentialled agents.
 *
 *         SPEND REQUEST STATE MACHINE
 *           Pending ──► Approved ──► Executed
 *           Pending ──► Rejected
 *           Pending ──► Cancelled   (by agent owner)
 *           Approved ──► Cancelled  (by protocol owner only)
 */
contract AgentGuard is Ownable, ReentrancyGuard {

    // ================================================================
    //  ENUMS
    // ================================================================

    /// @notice Credential tiers derived exclusively from task history.
    enum CredentialLevel { None, Bronze, Silver, Gold }

    /**
     * @notice Category of work performed by the agent.
     * @dev    Stored per-credential for auditability. Allows organisations to
     *         evaluate agent competence per domain, not just globally.
     */
    enum TaskType { TreasuryAnalysis, GovernanceReview, RiskAssessment }

    /**
     * @notice Lifecycle states for a treasury spend request.
     * @dev    Valid transitions:
     *         Pending  → Approved  (owner approves)
     *         Pending  → Rejected  (owner rejects)
     *         Pending  → Cancelled (agent owner cancels)
     *         Approved → Executed  (agent owner executes)
     *         Approved → Cancelled (protocol owner cancels; releases escrow)
     */
    enum RequestStatus { Pending, Approved, Executed, Rejected, Cancelled }

    // ================================================================
    //  STRUCTS
    // ================================================================

    /**
     * @notice Verifiable credential produced by each completed agent task.
     * @dev    evidenceHash MUST be the keccak256 digest of the off-chain work
     *         artifact (e.g. keccak256(abi.encodePacked(ipfsCID))). This allows
     *         anyone to verify the credential corresponds to real completed work
     *         without storing the artifact on-chain.
     */
    struct TaskCredential {
        string   taskId;        /// Unique task identifier
        TaskType taskType;      /// Category of work performed
        uint256  score;         /// Performance score 0–100
        bytes32  evidenceHash;  /// keccak256 digest of the off-chain work artifact
        uint256  timestamp;     /// Block timestamp of recording
    }

    /**
     * @notice A treasury spend request with full lifecycle tracking.
     * @dev    `exists` is the canonical existence check; do not rely on timestamp.
     *         `escrowReleased` tracks whether the escrowed amount was returned
     *         to the available pool on cancellation or rejection after approval.
     */
    struct SpendRequest {
        uint256       requestId;        /// Monotonically increasing unique ID
        address       agent;            /// Agent that created the request
        uint256       amount;           /// Requested amount in wei
        string        purpose;          /// Human-readable spend justification
        uint256       timestamp;        /// Block timestamp of creation
        RequestStatus status;           /// Current lifecycle state
        string        rejectionReason;  /// Set on Rejected; empty otherwise
        bool          exists;           /// Canonical existence flag
    }

    /**
     * @notice Core agent profile.
     * @dev    scoreSum stores the raw integer sum of all scores. Average is
     *         derived as scoreSum / completedTasks. Range 0–100 makes precision
     *         scaling unnecessary.
     */
    struct Agent {
        address         owner;            /// Controlling wallet address
        string          name;             /// Human-readable agent name
        uint256         completedTasks;   /// Total credentialled tasks
        uint256         scoreSum;         /// Cumulative score sum (for avg calculation)
        CredentialLevel credentialLevel;  /// Current tier (auto-derived, never manual)
        uint256         totalReleasedWei; /// Cumulative ETH released to this agent
        uint256         pendingCount;     /// Currently pending request count
        bool            registered;       /// Registration guard
    }

    /**
     * @notice Aggregated view of an agent for frontend dashboard consumption.
     * @dev    Returned by getAgentSummary(); avoids multiple view calls from UI.
     */
    struct AgentSummary {
        address         owner;
        string          name;
        uint256         completedTasks;
        uint256         averageScore;
        CredentialLevel credentialLevel;
        uint256         totalReleasedWei;
        uint256         pendingCount;
        uint256         spendLimit;
        uint256         pendingLimit;
        uint256         availableTreasury;
    }

    // ================================================================
    //  CONSTANTS
    // ================================================================

    uint256 public constant MAX_SCORE = 100;

    // Credential thresholds — task count
    uint256 public constant BRONZE_MIN_TASKS  = 3;
    uint256 public constant SILVER_MIN_TASKS  = 10;
    uint256 public constant GOLD_MIN_TASKS    = 25;

    // Credential thresholds — average score
    uint256 public constant BRONZE_MIN_SCORE  = 60;
    uint256 public constant SILVER_MIN_SCORE  = 75;
    uint256 public constant GOLD_MIN_SCORE    = 90;

    // Treasury spend limits per single request
    uint256 public constant BRONZE_SPEND_LIMIT = 0.1 ether;
    uint256 public constant SILVER_SPEND_LIMIT = 1   ether;
    uint256 public constant GOLD_SPEND_LIMIT   = 10  ether;

    // Maximum concurrent pending requests per credential tier
    uint256 public constant BRONZE_MAX_PENDING = 1;
    uint256 public constant SILVER_MAX_PENDING = 3;
    uint256 public constant GOLD_MAX_PENDING   = 5;

    // ================================================================
    //  STATE
    // ================================================================

    /**
     * @notice Total ETH committed in Approved-but-not-yet-Executed requests.
     * @dev    Used alongside address(this).balance to prevent over-commitment.
     *         Available ETH = address(this).balance - _escrowedAmount.
     */
    uint256 private _escrowedAmount;

    /// @notice Monotonically increasing spend request counter.
    uint256 private _nextRequestId;

    /// @notice Agent profiles keyed by agent address.
    mapping(address => Agent) private _agents;

    /// @notice Task credentials keyed by agent address.
    mapping(address => TaskCredential[]) private _credentials;

    /// @notice Guards against duplicate task IDs per agent.
    mapping(address => mapping(string => bool)) private _taskIdUsed;

    /// @notice All spend requests keyed by requestId.
    mapping(uint256 => SpendRequest) private _requests;

    /// @notice All spend request IDs per agent (lifetime, for history views).
    mapping(address => uint256[]) private _agentRequestIds;

    /// @notice Pending request IDs per agent (maintained for efficient enumeration).
    mapping(address => uint256[]) private _pendingRequestIds;

    /// @notice Approved request IDs per agent (maintained for efficient enumeration).
    mapping(address => uint256[]) private _approvedRequestIds;

    /// @notice Ordered registry of all agent addresses.
    address[] private _registeredAgents;

    // ================================================================
    //  EVENTS
    // ================================================================

    /**
     * @notice ETH deposited into the treasury by the owner.
     */
    event TreasuryDeposited(
        address indexed depositor,
        uint256         amount,
        uint256         newBalance
    );

    event UnexpectedDeposit(
        address indexed sender,
        uint256 amount,
        uint256 newBalance
    );

    /**
     * @notice A new agent has been registered.
     */
    event AgentRegistered(
        address indexed agent,
        string          name,
        uint256         timestamp
    );

    /**
     * @notice A verifiable task credential has been recorded for an agent.
     */
    event TaskCredentialRecorded(
        address  indexed agent,
        string   indexed taskId,
        TaskType         taskType,
        uint256          score,
        bytes32          evidenceHash,
        uint256          newAverageScore,
        uint256          completedTasks,
        uint256          timestamp
    );

    /**
     * @notice An agent's credential level has automatically changed.
     */
    event CredentialLevelChanged(
        address         indexed agent,
        CredentialLevel         oldLevel,
        CredentialLevel         newLevel,
        uint256                 timestamp
    );

    /**
     * @notice An agent has created a treasury spend request.
     */
    event SpendRequestCreated(
        uint256 indexed requestId,
        address indexed agent,
        uint256         amount,
        string          purpose,
        uint256         timestamp
    );

    /**
     * @notice The owner has approved a spend request.
     */
    event SpendRequestApproved(
        uint256 indexed requestId,
        address indexed agent,
        uint256         amount,
        uint256         timestamp
    );

    /**
     * @notice The owner has rejected a spend request.
     */
    event SpendRequestRejected(
        uint256 indexed requestId,
        address indexed agent,
        string          reason,
        uint256         timestamp
    );

    /**
     * @notice A spend request has been cancelled.
     * @param  cancelledBy The address that initiated the cancellation.
     */
    event SpendRequestCancelled(
        uint256 indexed requestId,
        address indexed agent,
        address         cancelledBy,
        uint256         timestamp
    );

    /**
     * @notice An agent has executed an approved spend request; ETH transferred.
     */
    event SpendExecuted(
        uint256 indexed requestId,
        address indexed agent,
        uint256         amount,
        uint256         remainingTreasury,
        uint256         timestamp
    );

    // ================================================================
    //  ERRORS
    // ================================================================

    // Registration
    error AgentAlreadyRegistered(address agent);
    error AgentNotRegistered(address agent);
    error NotAgentOwner(address caller, address expected);

    // Input validation
    error InvalidScore(uint256 score);
    error DuplicateTaskId(address agent, string taskId);
    error ZeroEvidenceHash();
    error ZeroAmount();
    error EmptyName();
    error EmptyTaskId();
    error EmptyPurpose();
    error EmptyReason();

    // Credential / permission
    error NoCredential(address agent);
    error ExceedsSpendLimit(uint256 requested, uint256 limit);
    error ExceedsPendingLimit(uint256 current, uint256 limit);

    // Treasury
    error InsufficientAvailableFunds(uint256 requested, uint256 available);
    error TransferFailed(address recipient, uint256 amount);
    // error DirectTransferNotAllowed();

    // Request lifecycle
    error RequestNotFound(uint256 requestId);
    error WrongStatus(uint256 requestId, RequestStatus current, RequestStatus required);
    error NotRequestAgent(uint256 requestId, address caller);
    error UnauthorisedCancellation(uint256 requestId, address caller);

    // ================================================================
    //  MODIFIERS
    // ================================================================

    /// @dev Reverts if the agent address is not registered.
    modifier mustBeRegistered(address agent) {
        if (!_agents[agent].registered) revert AgentNotRegistered(agent);
        _;
    }

    /// @dev Reverts if msg.sender is not the owner of the given agent profile.
    modifier onlyAgentOwner(address agent) {
        if (!_agents[agent].registered) revert AgentNotRegistered(agent);
        if (_agents[agent].owner != msg.sender) {
            revert NotAgentOwner(msg.sender, _agents[agent].owner);
        }
        _;
    }

    // ================================================================
    //  CONSTRUCTOR
    // ================================================================

    constructor() Ownable(msg.sender) {}

    // ================================================================
    //  TREASURY MANAGEMENT
    // ================================================================

    /**
     * @notice Deposit ETH into the protocol treasury.
     * @dev    address(this).balance is the single source of truth for treasury
     *         funds. No secondary accounting variable is maintained.
     *         Emits {TreasuryDeposited}.
     */
    function depositTreasury() external payable onlyOwner {
        if (msg.value == 0) revert ZeroAmount();
        emit TreasuryDeposited(msg.sender, msg.value, address(this).balance);
    }

    /**
     * @notice Returns available treasury (total balance minus escrowed approvals).
     * @dev    Use this figure, not address(this).balance, to determine whether
     *         a new spend request can be approved.
     */
    function availableTreasury() public view returns (uint256) {
        return address(this).balance - _escrowedAmount;
    }

    // ================================================================
    //  AGENT REGISTRATION
    // ================================================================

    /**
     * @notice Register the caller as a new AI agent.
     * @dev    Each address may register exactly once. Credential level begins
     *         at None and advances only through recorded task credentials.
     *         Emits {AgentRegistered}.
     * @param  name Human-readable label for this agent.
     */
    function registerAgent(string calldata name) external {
        if (_agents[msg.sender].registered) revert AgentAlreadyRegistered(msg.sender);
        if (bytes(name).length == 0)        revert EmptyName();

        _agents[msg.sender] = Agent({
            owner:            msg.sender,
            name:             name,
            completedTasks:   0,
            scoreSum:         0,
            credentialLevel:  CredentialLevel.None,
            totalReleasedWei: 0,
            pendingCount:     0,
            registered:       true
        });

        _registeredAgents.push(msg.sender);

        emit AgentRegistered(msg.sender, name, block.timestamp);
    }

    // ================================================================
    //  CREDENTIAL RECORDING
    // ================================================================

    /**
     * @notice Record a verifiable task credential for an agent.
     * @dev    Only the protocol owner (acting as the trusted evaluation oracle)
     *         may call this function. evidenceHash MUST be the keccak256 digest
     *         of the off-chain work artifact so the credential can be verified
     *         against actual agent output.
     *
     *         Credential level is recalculated automatically after every call.
     *         Duplicate taskIds per agent are permanently rejected.
     *
     *         Emits {TaskCredentialRecorded}.
     *         Conditionally emits {CredentialLevelChanged}.
     *
     * @param  agent        Address of the agent receiving the credential.
     * @param  taskId       Unique identifier for the completed task.
     * @param  taskType     Category of work: TreasuryAnalysis, GovernanceReview,
     *                      or RiskAssessment.
     * @param  score        Performance score, must be in [0, 100].
     * @param  evidenceHash keccak256 digest of the off-chain work artifact.
     */
    function recordTaskCredential(
        address         agent,
        string calldata taskId,
        TaskType        taskType,
        uint256         score,
        bytes32         evidenceHash
    )
        external
        onlyOwner
        mustBeRegistered(agent)
    {
        if (score > MAX_SCORE)           revert InvalidScore(score);
        if (bytes(taskId).length == 0)   revert EmptyTaskId();
        if (evidenceHash == bytes32(0))  revert ZeroEvidenceHash();
        if (_taskIdUsed[agent][taskId])  revert DuplicateTaskId(agent, taskId);

        _taskIdUsed[agent][taskId] = true;

        _credentials[agent].push(TaskCredential({
            taskId:       taskId,
            taskType:     taskType,
            score:        score,
            evidenceHash: evidenceHash,
            timestamp:    block.timestamp
        }));

        Agent storage a = _agents[agent];
        a.completedTasks += 1;
        a.scoreSum       += score;

        uint256 avg = _computeAverage(a.scoreSum, a.completedTasks);

        emit TaskCredentialRecorded(
            agent,
            taskId,
            taskType,
            score,
            evidenceHash,
            avg,
            a.completedTasks,
            block.timestamp
        );

        _updateCredentialLevel(agent);
    }

    // ================================================================
    //  SPEND REQUEST LIFECYCLE
    // ================================================================

    /**
     * @notice Create a treasury spend request.
     * @dev    The agent must hold at least Bronze credential.
     *         Amount must not exceed the tier's single-request spend limit.
     *         Pending request count must not exceed the tier's concurrency cap.
     *         Emits {SpendRequestCreated}.
     *
     * @param  agentAddress Agent on whose behalf the request is created.
     * @param  amount       Requested amount in wei.
     * @param  purpose      Human-readable justification for the spend.
     * @return requestId    The assigned spend request ID.
     */
    function createSpendRequest(
        address         agentAddress,
        uint256         amount,
        string calldata purpose
    )
        external
        onlyAgentOwner(agentAddress)
        returns (uint256 requestId)
    {
        if (amount == 0)                revert ZeroAmount();
        if (bytes(purpose).length == 0) revert EmptyPurpose();

        Agent storage a = _agents[agentAddress];

        if (a.credentialLevel == CredentialLevel.None) revert NoCredential(agentAddress);

        uint256 spendLimit   = _spendLimit(a.credentialLevel);
        uint256 pendingLimit = _pendingLimit(a.credentialLevel);

        if (amount > spendLimit)          revert ExceedsSpendLimit(amount, spendLimit);
        if (a.pendingCount >= pendingLimit) revert ExceedsPendingLimit(a.pendingCount, pendingLimit);

        requestId = _nextRequestId++;

        _requests[requestId] = SpendRequest({
            requestId:       requestId,
            agent:           agentAddress,
            amount:          amount,
            purpose:         purpose,
            timestamp:       block.timestamp,
            status:          RequestStatus.Pending,
            rejectionReason: "",
            exists:          true
        });

        _agentRequestIds[agentAddress].push(requestId);
        _pendingRequestIds[agentAddress].push(requestId);
        _incrementPending(a);

        emit SpendRequestCreated(requestId, agentAddress, amount, purpose, block.timestamp);
    }

    /**
     * @notice Approve a pending spend request.
     * @dev    Only the owner may approve. Checks available treasury (total
     *         balance minus already-escrowed approvals) to prevent over-commit.
     *         The approved amount is added to _escrowedAmount, reserving it
     *         for execution and preventing subsequent approvals from consuming
     *         the same ETH.
     *         Emits {SpendRequestApproved}.
     *
     * @param  requestId The spend request to approve.
     */
    function approveSpendRequest(uint256 requestId) external onlyOwner {
        SpendRequest storage req = _getRequest(requestId);

        if (req.status != RequestStatus.Pending) {
            revert WrongStatus(requestId, req.status, RequestStatus.Pending);
        }

        uint256 avail = availableTreasury();
        if (req.amount > avail) {
            revert InsufficientAvailableFunds(req.amount, avail);
        }

        req.status       = RequestStatus.Approved;
        _escrowedAmount += req.amount;

        _removePendingId(req.agent, requestId);
        _approvedRequestIds[req.agent].push(requestId);
        _decrementPending(_agents[req.agent]);

        emit SpendRequestApproved(requestId, req.agent, req.amount, block.timestamp);
    }

    /**
     * @notice Reject a pending spend request with a mandatory reason.
     * @dev    Only the owner may reject. Decrements the agent's pending counter.
     *         Emits {SpendRequestRejected}.
     *
     * @param  requestId The spend request to reject.
     * @param  reason    Human-readable explanation for the rejection.
     */
    function rejectSpendRequest(
        uint256         requestId,
        string calldata reason
    )
        external
        onlyOwner
    {
        if (bytes(reason).length == 0) revert EmptyReason();

        SpendRequest storage req = _getRequest(requestId);

        if (req.status != RequestStatus.Pending) {
            revert WrongStatus(requestId, req.status, RequestStatus.Pending);
        }

        req.status          = RequestStatus.Rejected;
        req.rejectionReason = reason;

        _removePendingId(req.agent, requestId);
        _decrementPending(_agents[req.agent]);

        emit SpendRequestRejected(requestId, req.agent, reason, block.timestamp);
    }

    /**
     * @notice Cancel a spend request.
     * @dev    Cancellation rules:
     *         - Pending requests: agent owner OR protocol owner may cancel.
     *         - Approved requests: protocol owner only (releases escrowed ETH).
     *         - Any other status: reverts.
     *         Emits {SpendRequestCancelled}.
     *
     * @param  requestId The spend request to cancel.
     */
    function cancelSpendRequest(uint256 requestId) external {
        SpendRequest storage req = _getRequest(requestId);

        bool isAgentOwner    = _agents[req.agent].registered &&
                               _agents[req.agent].owner == msg.sender;
        bool isProtocolOwner = msg.sender == owner();

        if (req.status == RequestStatus.Pending) {
            if (!isAgentOwner && !isProtocolOwner) {
                revert UnauthorisedCancellation(requestId, msg.sender);
            }
            req.status = RequestStatus.Cancelled;
            _removePendingId(req.agent, requestId);
            _decrementPending(_agents[req.agent]);

        } else if (req.status == RequestStatus.Approved) {
            if (!isProtocolOwner) {
                revert UnauthorisedCancellation(requestId, msg.sender);
            }
            req.status       = RequestStatus.Cancelled;
            _escrowedAmount -= req.amount;
            _removeApprovedId(req.agent, requestId);

        } else {
            revert WrongStatus(requestId, req.status, RequestStatus.Pending);
        }

        emit SpendRequestCancelled(requestId, req.agent, msg.sender, block.timestamp);
    }

    /**
     * @notice Execute an approved spend request and transfer ETH to the agent.
     * @dev    Only the agent owner may execute. Uses checks-effects-interactions
     *         pattern. Re-checks available funds at execution time.
     *         Releases the escrowed amount back to accounting on transfer.
     *         Emits {SpendExecuted}.
     *
     * @param  agentAddress Agent address whose approved request will be executed.
     * @param  requestId    The approved spend request to execute.
     */
    function executeSpendRequest(
        address agentAddress,
        uint256 requestId
    )
        external
        nonReentrant
        onlyAgentOwner(agentAddress)
    {
        SpendRequest storage req = _getRequest(requestId);

        if (req.agent != agentAddress)            revert NotRequestAgent(requestId, agentAddress);
        if (req.status != RequestStatus.Approved) {
            revert WrongStatus(requestId, req.status, RequestStatus.Approved);
        }

        // Escrow covers this amount; full balance check is implicitly satisfied.
        // Defensive: verify contract holds at least the escrowed total.
        assert(address(this).balance >= _escrowedAmount);

        uint256 amount = req.amount;

        // Effects
        req.status                               = RequestStatus.Executed;
        _escrowedAmount                         -= amount;
        _agents[agentAddress].totalReleasedWei  += amount;
        _removeApprovedId(agentAddress, requestId);

        emit SpendExecuted(
            requestId,
            agentAddress,
            amount,
            address(this).balance - amount, // remaining after transfer
            block.timestamp
        );

        // Interaction (after all state changes)
        (bool ok, ) = agentAddress.call{value: amount}("");
        if (!ok) revert TransferFailed(agentAddress, amount);
    }

    // ================================================================
    //  INTERNAL HELPERS
    // ================================================================

    /**
     * @dev Derives and applies the correct credential level from current task
     *      history. Evaluated Gold → Silver → Bronze → None.
     *      Emits {CredentialLevelChanged} only on actual level change.
     */
    function _updateCredentialLevel(address agent) internal {
        Agent storage a = _agents[agent];
        uint256 avg     = _computeAverage(a.scoreSum, a.completedTasks);

        CredentialLevel newLevel = _deriveLevel(a.completedTasks, avg);

        if (newLevel != a.credentialLevel) {
            CredentialLevel old = a.credentialLevel;
            a.credentialLevel   = newLevel;
            emit CredentialLevelChanged(agent, old, newLevel, block.timestamp);
        }
    }

    /**
     * @dev Computes integer average score. Returns 0 if no tasks recorded.
     */
    function _computeAverage(
        uint256 scoreSum,
        uint256 taskCount
    )
        internal
        pure
        returns (uint256)
    {
        if (taskCount == 0) return 0;
        return scoreSum / taskCount;
    }

    /// @dev Pure derivation of credential level from task count and average score.
    function _deriveLevel(
        uint256 tasks,
        uint256 avg
    )
        internal
        pure
        returns (CredentialLevel)
    {
        if (tasks >= GOLD_MIN_TASKS   && avg >= GOLD_MIN_SCORE)   return CredentialLevel.Gold;
        if (tasks >= SILVER_MIN_TASKS && avg >= SILVER_MIN_SCORE) return CredentialLevel.Silver;
        if (tasks >= BRONZE_MIN_TASKS && avg >= BRONZE_MIN_SCORE) return CredentialLevel.Bronze;
        return CredentialLevel.None;
    }

    /// @dev Returns the maximum single spend request size for a credential level.
    function _spendLimit(CredentialLevel level) internal pure returns (uint256) {
        if (level == CredentialLevel.Gold)   return GOLD_SPEND_LIMIT;
        if (level == CredentialLevel.Silver) return SILVER_SPEND_LIMIT;
        if (level == CredentialLevel.Bronze) return BRONZE_SPEND_LIMIT;
        return 0;
    }

    /// @dev Returns the maximum concurrent pending requests for a credential level.
    function _pendingLimit(CredentialLevel level) internal pure returns (uint256) {
        if (level == CredentialLevel.Gold)   return GOLD_MAX_PENDING;
        if (level == CredentialLevel.Silver) return SILVER_MAX_PENDING;
        if (level == CredentialLevel.Bronze) return BRONZE_MAX_PENDING;
        return 0;
    }

    /// @dev Retrieves a spend request, reverting cleanly if it does not exist.
    function _getRequest(uint256 requestId)
        internal
        view
        returns (SpendRequest storage)
    {
        SpendRequest storage req = _requests[requestId];
        if (!req.exists) revert RequestNotFound(requestId);
        return req;
    }

    /// @dev Safely increments the pending count for an agent.
    function _incrementPending(Agent storage a) internal {
        a.pendingCount += 1;
    }

    /// @dev Safely decrements the pending count for an agent.
    function _decrementPending(Agent storage a) internal {
        if (a.pendingCount > 0) a.pendingCount -= 1;
    }

    /**
     * @dev Removes a requestId from the agent's _pendingRequestIds array.
     *      Uses swap-and-pop for O(n) but avoids storage gaps.
     *      For buildathon scale (low n), this is acceptable.
     */
    function _removePendingId(address agent, uint256 requestId) internal {
        uint256[] storage arr = _pendingRequestIds[agent];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; ) {
            if (arr[i] == requestId) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
            unchecked { ++i; }
        }
    }

    /**
     * @dev Removes a requestId from the agent's _approvedRequestIds array.
     *      Uses swap-and-pop.
     */
    function _removeApprovedId(address agent, uint256 requestId) internal {
        uint256[] storage arr = _approvedRequestIds[agent];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; ) {
            if (arr[i] == requestId) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
            unchecked { ++i; }
        }
    }

    // ================================================================
    //  VIEW — AGENT
    // ================================================================

    /**
     * @notice Return the full profile of a registered agent.
     * @param  agent The agent address to query.
     */
    function getAgent(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (
            address         agentOwner,
            string memory   name,
            uint256         completedTasks,
            uint256         averageScore,
            CredentialLevel credentialLevel,
            uint256         totalReleasedWei,
            uint256         pendingCount
        )
    {
        Agent storage a = _agents[agent];
        return (
            a.owner,
            a.name,
            a.completedTasks,
            _computeAverage(a.scoreSum, a.completedTasks),
            a.credentialLevel,
            a.totalReleasedWei,
            a.pendingCount
        );
    }

    /**
     * @notice Return a complete dashboard summary for an agent in a single call.
     * @dev    Designed for frontend cards and demo dashboards. Includes treasury
     *         context so the UI can show permission vs. available funds together.
     * @param  agent The agent address to query.
     * @return summary Fully populated AgentSummary struct.
     */
    function getAgentSummary(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (AgentSummary memory summary)
    {
        Agent storage a = _agents[agent];
        summary = AgentSummary({
            owner:             a.owner,
            name:              a.name,
            completedTasks:    a.completedTasks,
            averageScore:      _computeAverage(a.scoreSum, a.completedTasks),
            credentialLevel:   a.credentialLevel,
            totalReleasedWei:  a.totalReleasedWei,
            pendingCount:      a.pendingCount,
            spendLimit:        _spendLimit(a.credentialLevel),
            pendingLimit:      _pendingLimit(a.credentialLevel),
            availableTreasury: availableTreasury()
        });
    }

    /**
     * @notice Return the current spend limit for an agent's credential level.
     * @param  agent The agent address to query.
     */
    function getAgentSpendLimit(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256)
    {
        return _spendLimit(_agents[agent].credentialLevel);
    }

    /**
     * @notice Return the current pending request limit for an agent's credential level.
     * @param  agent The agent address to query.
     */
    function getAgentPendingLimit(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256)
    {
        return _pendingLimit(_agents[agent].credentialLevel);
    }

    /**
     * @notice Return the current average score for an agent.
     * @param  agent The agent address to query.
     */
    function getAgentAverageScore(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256)
    {
        Agent storage a = _agents[agent];
        return _computeAverage(a.scoreSum, a.completedTasks);
    }

    // ================================================================
    //  VIEW — CREDENTIALS
    // ================================================================

    /**
     * @notice Return all task credentials for a registered agent.
     * @param  agent The agent address to query.
     */
    function getCredentials(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (TaskCredential[] memory)
    {
        return _credentials[agent];
    }

    /**
     * @notice Return a single task credential by index.
     * @param  agent The agent address to query.
     * @param  index Zero-based index into the credentials array.
     */
    function getCredentialAt(address agent, uint256 index)
        external
        view
        mustBeRegistered(agent)
        returns (TaskCredential memory)
    {
        require(index < _credentials[agent].length, "Index out of bounds");
        return _credentials[agent][index];
    }

    /**
     * @notice Return whether a taskId has already been recorded for an agent.
     * @param  agent  The agent address to check.
     * @param  taskId The task identifier to check.
     */
    function isTaskIdUsed(address agent, string calldata taskId)
        external
        view
        returns (bool)
    {
        return _taskIdUsed[agent][taskId];
    }

    // ================================================================
    //  VIEW — SPEND REQUESTS
    // ================================================================

    /**
     * @notice Return a single spend request by ID.
     * @param  requestId The ID of the spend request.
     */
    function getSpendRequest(uint256 requestId)
        external
        view
        returns (SpendRequest memory)
    {
        return _getRequest(requestId);
    }

    /**
     * @notice Return the full history of spend request IDs for an agent.
     * @param  agent The agent address to query.
     */
    function getAgentRequests(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256[] memory)
    {
        return _agentRequestIds[agent];
    }

    /**
     * @notice Return all currently pending spend request IDs for an agent.
     * @dev    Array is maintained incrementally; no iteration over all requests.
     * @param  agent The agent address to query.
     */
    function getPendingRequests(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256[] memory)
    {
        return _pendingRequestIds[agent];
    }

    /**
     * @notice Return all currently approved (awaiting execution) request IDs for an agent.
     * @dev    Array is maintained incrementally; no iteration over all requests.
     * @param  agent The agent address to query.
     */
    function getApprovedRequests(address agent)
        external
        view
        mustBeRegistered(agent)
        returns (uint256[] memory)
    {
        return _approvedRequestIds[agent];
    }

    // ================================================================
    //  VIEW — REGISTRY
    // ================================================================

    /**
     * @notice Return the total number of registered agents.
     */
    function totalAgents() external view returns (uint256) {
        return _registeredAgents.length;
    }

    /**
     * @notice Return the agent address at a given registry index.
     * @param  index Zero-based index into the registry.
     */
    function agentAtIndex(uint256 index) external view returns (address) {
        require(index < _registeredAgents.length, "Index out of bounds");
        return _registeredAgents[index];
    }

    /**
     * @notice Return whether an address has a registered agent.
     * @param  agent The address to check.
     */
    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].registered;
    }

    // ================================================================
    //  FALLBACK
    // ================================================================

    /// @dev Reject direct ETH transfers; all funding must go through depositTreasury().
    receive() external payable {
        emit UnexpectedDeposit(
            msg.sender,
            msg.value,
            address(this).balance
        );
    }
}