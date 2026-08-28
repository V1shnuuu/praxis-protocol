// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal views/mutators the Praxis contracts need from one another.
///         Kept as interfaces so the deployment graph stays acyclic.

interface IAgentRegistry {
    struct AgentView {
        uint256 id;
        address owner;
        string name;
        string metadataURI;
        uint256 bond;
        uint256 lockedBond;
        uint256 registeredAt;
        uint256 totalSlashed;
        uint256 slashCount;
        bool active;
    }

    function agentCount() external view returns (uint256);

    function exists(uint256 agentId) external view returns (bool);

    function isActive(uint256 agentId) external view returns (bool);

    function isAuthorized(uint256 agentId, address account) external view returns (bool);

    function getAgent(uint256 agentId) external view returns (AgentView memory);

    function bondOf(uint256 agentId) external view returns (uint256);

    function minBond() external view returns (uint256);

    /// @notice Slash `bps` of the agent's remaining bond. Tokens are pushed to the caller.
    function slash(uint256 agentId, uint256 bps) external returns (uint256 amount);

    /// @notice Reserve part of an agent's bond while a dispute is pending.
    function lockBond(uint256 agentId, uint256 amount) external;

    function unlockBond(uint256 agentId, uint256 amount) external;

    /// @notice Add to an agent's bond. Pulls `amount` from the caller.
    function creditBond(uint256 agentId, uint256 amount) external;
}

interface IActionAttestation {
    struct AttestationView {
        uint256 id;
        uint256 agentId;
        bytes32 trailHash;
        string actionType;
        string summary;
        uint256 timestamp;
        address submitter;
        bool disputed;
        bool slashed;
    }

    function attestationCount() external view returns (uint256);

    function exists(uint256 attestationId) external view returns (bool);

    function getAttestation(uint256 attestationId) external view returns (AttestationView memory);

    function agentOf(uint256 attestationId) external view returns (uint256);

    function timestampOf(uint256 attestationId) external view returns (uint256);

    function totalByAgent(uint256 agentId) external view returns (uint256);

    function slashedByAgent(uint256 agentId) external view returns (uint256);

    function markDisputed(uint256 attestationId) external;

    function markResolved(uint256 attestationId, bool upheld) external;
}

interface IDisputeSlashing {
    function openDisputesByAgent(uint256 agentId) external view returns (uint256);

    function upheldDisputesByAgent(uint256 agentId) external view returns (uint256);

    function rejectedDisputesByAgent(uint256 agentId) external view returns (uint256);
}
