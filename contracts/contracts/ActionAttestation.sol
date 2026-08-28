// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAgentRegistry, IActionAttestation} from "./interfaces/IPraxis.sol";

/// @title ActionAttestation
/// @notice Append-only log of agent decisions. Agents (or their authorised
///         orchestrator) commit the keccak256 hash of a full decision trail
///         — inputs, reasoning summary, output — plus a short public summary.
///         The pre-image lives off-chain and is revealed if the action is disputed.
contract ActionAttestation is IActionAttestation, Ownable {
    struct Attestation {
        uint256 agentId;
        bytes32 trailHash;
        string actionType;
        string summary;
        uint256 timestamp;
        address submitter;
        bool disputed;
        bool slashed;
    }

    IAgentRegistry public immutable registry;

    /// @notice DisputeSlashing module, the only contract allowed to flag attestations.
    address public disputeModule;

    uint256 public attestationCount;

    mapping(uint256 => Attestation) private _attestations;
    mapping(uint256 => uint256[]) private _byAgent;
    mapping(uint256 => uint256) public slashedByAgent;
    /// @dev Guards against replaying the same decision trail twice.
    mapping(bytes32 => uint256) public attestationIdByHash;

    event AttestationSubmitted(
        uint256 indexed attestationId,
        uint256 indexed agentId,
        bytes32 indexed trailHash,
        string actionType,
        string summary,
        address submitter,
        uint256 timestamp
    );
    event AttestationDisputed(uint256 indexed attestationId, uint256 indexed agentId);
    event AttestationResolved(uint256 indexed attestationId, uint256 indexed agentId, bool upheld);
    event DisputeModuleUpdated(address indexed previousModule, address indexed newModule);

    error UnknownAttestation(uint256 attestationId);
    error NotAuthorizedForAgent(uint256 agentId, address caller);
    error AgentNotActive(uint256 agentId);
    error NotDisputeModule(address caller);
    error EmptyTrailHash();
    error DuplicateTrailHash(bytes32 trailHash, uint256 existingAttestationId);
    error ZeroAddress();

    modifier onlyDisputeModule() {
        if (msg.sender != disputeModule) revert NotDisputeModule(msg.sender);
        _;
    }

    modifier attestationExists(uint256 attestationId) {
        if (attestationId == 0 || attestationId > attestationCount) revert UnknownAttestation(attestationId);
        _;
    }

    constructor(address registry_, address admin) Ownable(admin) {
        if (registry_ == address(0) || admin == address(0)) revert ZeroAddress();
        registry = IAgentRegistry(registry_);
    }

    /// @notice Commit a hashed decision trail on behalf of an agent.
    /// @param agentId Registered agent taking the action.
    /// @param trailHash keccak256 of the canonical JSON decision trail held off-chain.
    /// @param actionType Short machine tag, e.g. "TRADE", "VOTE", "LOAN".
    /// @param summary One-line human-readable summary shown in the live feed.
    function attest(uint256 agentId, bytes32 trailHash, string calldata actionType, string calldata summary)
        external
        returns (uint256 attestationId)
    {
        if (trailHash == bytes32(0)) revert EmptyTrailHash();
        if (!registry.isAuthorized(agentId, msg.sender)) revert NotAuthorizedForAgent(agentId, msg.sender);
        if (!registry.isActive(agentId)) revert AgentNotActive(agentId);

        uint256 existing = attestationIdByHash[trailHash];
        if (existing != 0) revert DuplicateTrailHash(trailHash, existing);

        attestationId = ++attestationCount;
        _attestations[attestationId] = Attestation({
            agentId: agentId,
            trailHash: trailHash,
            actionType: actionType,
            summary: summary,
            timestamp: block.timestamp,
            submitter: msg.sender,
            disputed: false,
            slashed: false
        });
        _byAgent[agentId].push(attestationId);
        attestationIdByHash[trailHash] = attestationId;

        emit AttestationSubmitted(
            attestationId, agentId, trailHash, actionType, summary, msg.sender, block.timestamp
        );
    }

    /// @notice Verify a revealed decision trail against its on-chain commitment.
    function verifyTrail(uint256 attestationId, bytes calldata trail)
        external
        view
        attestationExists(attestationId)
        returns (bool)
    {
        return keccak256(trail) == _attestations[attestationId].trailHash;
    }

    // ---------------------------------------------------------------- dispute hooks

    function markDisputed(uint256 attestationId)
        external
        override
        attestationExists(attestationId)
        onlyDisputeModule
    {
        Attestation storage a = _attestations[attestationId];
        a.disputed = true;
        emit AttestationDisputed(attestationId, a.agentId);
    }

    function markResolved(uint256 attestationId, bool upheld)
        external
        override
        attestationExists(attestationId)
        onlyDisputeModule
    {
        Attestation storage a = _attestations[attestationId];
        a.disputed = false;
        if (upheld && !a.slashed) {
            a.slashed = true;
            slashedByAgent[a.agentId] += 1;
        }
        emit AttestationResolved(attestationId, a.agentId, upheld);
    }

    function setDisputeModule(address newModule) external onlyOwner {
        if (newModule == address(0)) revert ZeroAddress();
        emit DisputeModuleUpdated(disputeModule, newModule);
        disputeModule = newModule;
    }

    // ---------------------------------------------------------------- views

    function exists(uint256 attestationId) external view override returns (bool) {
        return attestationId != 0 && attestationId <= attestationCount;
    }

    function agentOf(uint256 attestationId) external view override returns (uint256) {
        return _attestations[attestationId].agentId;
    }

    function timestampOf(uint256 attestationId) external view override returns (uint256) {
        return _attestations[attestationId].timestamp;
    }

    function totalByAgent(uint256 agentId) external view override returns (uint256) {
        return _byAgent[agentId].length;
    }

    /// @notice Attestations by this agent that were never upheld as violations.
    function cleanByAgent(uint256 agentId) external view returns (uint256) {
        return _byAgent[agentId].length - slashedByAgent[agentId];
    }

    function getAttestation(uint256 attestationId)
        external
        view
        override
        attestationExists(attestationId)
        returns (AttestationView memory)
    {
        Attestation storage a = _attestations[attestationId];
        return _toView(attestationId, a);
    }

    function attestationIdsOfAgent(uint256 agentId) external view returns (uint256[] memory) {
        return _byAgent[agentId];
    }

    /// @notice Most recent attestations first, for the dashboard live feed.
    /// @param offset Number of newest attestations to skip.
    /// @param limit Maximum entries to return.
    function listRecent(uint256 offset, uint256 limit)
        external
        view
        returns (AttestationView[] memory page)
    {
        if (offset >= attestationCount) return new AttestationView[](0);

        uint256 available = attestationCount - offset;
        uint256 size = (limit == 0 || limit > available) ? available : limit;

        page = new AttestationView[](size);
        uint256 cursor = attestationCount - offset; // newest id in range
        for (uint256 i = 0; i < size; i++) {
            uint256 id = cursor - i;
            page[i] = _toView(id, _attestations[id]);
        }
    }

    function _toView(uint256 id, Attestation storage a) private view returns (AttestationView memory) {
        return AttestationView({
            id: id,
            agentId: a.agentId,
            trailHash: a.trailHash,
            actionType: a.actionType,
            summary: a.summary,
            timestamp: a.timestamp,
            submitter: a.submitter,
            disputed: a.disputed,
            slashed: a.slashed
        });
    }
}
