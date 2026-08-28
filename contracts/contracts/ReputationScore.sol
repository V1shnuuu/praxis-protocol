// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAgentRegistry, IActionAttestation, IDisputeSlashing} from "./interfaces/IPraxis.sol";

/// @title ReputationScore
/// @notice Stateless, portable reputation derived from registry + attestation +
///         dispute history. Nothing is stored: any protocol can read a live score
///         for an agent without trusting an off-chain indexer.
///
///         score = BASE
///               + clean-attestation bonus   (capped)
///               + longevity bonus           (capped)
///               + over-collateralisation bonus (capped)
///               + successfully-defended bonus (capped)
///               - slash penalty             (count + severity)
///               - pending-dispute penalty
///         clamped to [0, MAX_SCORE]. An inactive/slashed-out agent scores 0.
contract ReputationScore is Ownable {
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant BASE_SCORE = 500;

    // --- bonuses ---
    uint256 public constant POINTS_PER_CLEAN_ATTESTATION = 5;
    uint256 public constant MAX_ATTESTATION_BONUS = 250;

    uint256 public constant POINTS_PER_DAY = 2;
    uint256 public constant MAX_LONGEVITY_BONUS = 100;

    /// @dev 25 points per multiple of minBond held above the minimum.
    uint256 public constant POINTS_PER_EXCESS_BOND_MULTIPLE = 25;
    uint256 public constant MAX_BOND_BONUS = 100;

    uint256 public constant POINTS_PER_DEFENDED_DISPUTE = 20;
    uint256 public constant MAX_DEFENSE_BONUS = 60;

    // --- penalties ---
    uint256 public constant PENALTY_PER_SLASH = 150;
    /// @dev Extra penalty scaled by how much of the agent's lifetime bond was burned.
    uint256 public constant MAX_SEVERITY_PENALTY = 200;
    uint256 public constant PENALTY_PER_OPEN_DISPUTE = 40;

    IAgentRegistry public immutable registry;
    IActionAttestation public immutable attestations;
    IDisputeSlashing public disputes;

    event DisputeModuleUpdated(address indexed previousModule, address indexed newModule);

    error ZeroAddress();

    struct Breakdown {
        uint256 score;
        uint256 base;
        uint256 attestationBonus;
        uint256 longevityBonus;
        uint256 bondBonus;
        uint256 defenseBonus;
        uint256 slashPenalty;
        uint256 severityPenalty;
        uint256 disputePenalty;
        uint256 totalAttestations;
        uint256 cleanAttestations;
        uint256 slashCount;
        uint256 openDisputes;
        bool active;
    }

    constructor(address registry_, address attestations_, address disputes_, address admin) Ownable(admin) {
        if (registry_ == address(0) || attestations_ == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        registry = IAgentRegistry(registry_);
        attestations = IActionAttestation(attestations_);
        disputes = IDisputeSlashing(disputes_);
    }

    /// @dev Set once after DisputeSlashing is deployed, if it was not known at construction.
    function setDisputeModule(address newModule) external onlyOwner {
        if (newModule == address(0)) revert ZeroAddress();
        emit DisputeModuleUpdated(address(disputes), newModule);
        disputes = IDisputeSlashing(newModule);
    }

    /// @notice Live reputation score for an agent, 0..1000.
    function scoreOf(uint256 agentId) public view returns (uint256) {
        return breakdownOf(agentId).score;
    }

    /// @notice Full component breakdown, so the dashboard can explain the number.
    function breakdownOf(uint256 agentId) public view returns (Breakdown memory b) {
        if (!registry.exists(agentId)) return b;

        IAgentRegistry.AgentView memory agent = registry.getAgent(agentId);

        b.base = BASE_SCORE;
        b.active = agent.active;
        b.slashCount = agent.slashCount;
        b.totalAttestations = attestations.totalByAgent(agentId);
        uint256 slashedAttestations = attestations.slashedByAgent(agentId);
        b.cleanAttestations =
            b.totalAttestations > slashedAttestations ? b.totalAttestations - slashedAttestations : 0;

        // An agent that has been slashed below the minimum bond is out of the system.
        if (!agent.active) {
            b.score = 0;
            return b;
        }

        b.attestationBonus = _cap(b.cleanAttestations * POINTS_PER_CLEAN_ATTESTATION, MAX_ATTESTATION_BONUS);

        uint256 daysActive =
            block.timestamp > agent.registeredAt ? (block.timestamp - agent.registeredAt) / 1 days : 0;
        b.longevityBonus = _cap(daysActive * POINTS_PER_DAY, MAX_LONGEVITY_BONUS);

        uint256 floor = registry.minBond();
        if (floor > 0 && agent.bond > floor) {
            uint256 excessMultiples = (agent.bond - floor) / floor;
            b.bondBonus = _cap(excessMultiples * POINTS_PER_EXCESS_BOND_MULTIPLE, MAX_BOND_BONUS);
        }

        if (address(disputes) != address(0)) {
            b.openDisputes = disputes.openDisputesByAgent(agentId);
            uint256 defended = disputes.rejectedDisputesByAgent(agentId);
            b.defenseBonus = _cap(defended * POINTS_PER_DEFENDED_DISPUTE, MAX_DEFENSE_BONUS);
            b.disputePenalty = b.openDisputes * PENALTY_PER_OPEN_DISPUTE;
        }

        b.slashPenalty = agent.slashCount * PENALTY_PER_SLASH;

        // Severity: how much of the bond the agent has ever posted was burned.
        uint256 lifetimeBond = agent.bond + agent.totalSlashed;
        if (lifetimeBond > 0 && agent.totalSlashed > 0) {
            b.severityPenalty = (agent.totalSlashed * MAX_SEVERITY_PENALTY) / lifetimeBond;
        }

        uint256 positive =
            b.base + b.attestationBonus + b.longevityBonus + b.bondBonus + b.defenseBonus;
        uint256 negative = b.slashPenalty + b.severityPenalty + b.disputePenalty;

        b.score = positive > negative ? _cap(positive - negative, MAX_SCORE) : 0;
    }

    /// @notice Coarse label for the dashboard badge.
    function tierOf(uint256 agentId) external view returns (string memory) {
        uint256 s = scoreOf(agentId);
        if (s >= 800) return "TRUSTED";
        if (s >= 600) return "RELIABLE";
        if (s >= 400) return "NEUTRAL";
        if (s >= 200) return "WATCH";
        return "UNTRUSTED";
    }

    /// @notice Batch read for the agent list view.
    function scoresOf(uint256[] calldata agentIds) external view returns (uint256[] memory out) {
        out = new uint256[](agentIds.length);
        for (uint256 i = 0; i < agentIds.length; i++) {
            out[i] = scoreOf(agentIds[i]);
        }
    }

    function _cap(uint256 value, uint256 maxValue) private pure returns (uint256) {
        return value > maxValue ? maxValue : value;
    }
}
