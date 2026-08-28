// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentRegistry, IActionAttestation, IDisputeSlashing} from "./interfaces/IPraxis.sol";

/// @title DisputeSlashing
/// @notice Challenge-and-slash layer. Anyone may stake a fee to dispute an
///         attestation inside the challenge window. An arbiter address — the
///         stand-in for a future decentralised arbitration layer — resolves it.
///
///         Upheld  : the agent's bond is slashed; the challenger gets their fee
///                   back plus a share of the slash. The remainder goes to the treasury.
///         Rejected: the challenger forfeits their fee, which is credited to the
///                   agent's bond as compensation for the false accusation.
contract DisputeSlashing is IDisputeSlashing, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum Status {
        None,
        Open,
        Upheld,
        Rejected
    }

    struct Dispute {
        uint256 id;
        uint256 attestationId;
        uint256 agentId;
        address challenger;
        uint256 fee;
        string reason;
        uint256 openedAt;
        uint256 resolvedAt;
        uint256 lockedAmount;
        uint256 slashedAmount;
        uint256 challengerPayout;
        uint256 bondBefore;
        uint256 bondAfter;
        Status status;
    }

    IAgentRegistry public immutable registry;
    IActionAttestation public immutable attestations;
    IERC20 public immutable bondToken;

    /// @notice Address permitted to resolve disputes (admin / oracle role).
    address public arbiter;
    /// @notice Destination for the protocol's share of slashed bonds.
    address public treasury;

    /// @notice How long after an attestation it may still be challenged.
    uint256 public challengeWindow;
    /// @notice Stake required to open a dispute.
    uint256 public challengeFee;
    /// @notice Share of the agent's remaining bond burned on an upheld dispute.
    uint256 public slashBps;
    /// @notice Share of the slashed amount paid to the challenger.
    uint256 public challengerRewardBps;

    uint256 public disputeCount;

    mapping(uint256 => Dispute) private _disputes;
    /// @dev attestationId => open dispute id (0 when none is pending).
    mapping(uint256 => uint256) public openDisputeOf;
    mapping(uint256 => uint256[]) private _byAgent;
    mapping(uint256 => uint256) public openDisputesByAgent;
    mapping(uint256 => uint256) public upheldDisputesByAgent;
    mapping(uint256 => uint256) public rejectedDisputesByAgent;

    event DisputeOpened(
        uint256 indexed disputeId,
        uint256 indexed attestationId,
        uint256 indexed agentId,
        address challenger,
        uint256 fee,
        string reason,
        uint256 openedAt
    );
    event DisputeResolved(
        uint256 indexed disputeId,
        uint256 indexed attestationId,
        uint256 indexed agentId,
        bool upheld,
        uint256 slashedAmount,
        uint256 challengerPayout,
        uint256 bondBefore,
        uint256 bondAfter
    );
    event ArbiterUpdated(address indexed previousArbiter, address indexed newArbiter);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event ParametersUpdated(
        uint256 challengeWindow, uint256 challengeFee, uint256 slashBps, uint256 challengerRewardBps
    );

    error NotArbiter(address caller);
    error UnknownAttestation(uint256 attestationId);
    error UnknownDispute(uint256 disputeId);
    error ChallengeWindowClosed(uint256 attestationId, uint256 deadline);
    error DisputeAlreadyOpen(uint256 attestationId, uint256 disputeId);
    error DisputeNotOpen(uint256 disputeId);
    error AgentCannotChallengeSelf(uint256 agentId);
    error InvalidBps(uint256 bps);
    error ZeroAddress();

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter(msg.sender);
        _;
    }

    constructor(
        address registry_,
        address attestations_,
        address bondToken_,
        address arbiter_,
        address treasury_,
        uint256 challengeWindow_,
        uint256 challengeFee_,
        uint256 slashBps_,
        uint256 challengerRewardBps_,
        address admin
    ) Ownable(admin) {
        if (
            registry_ == address(0) || attestations_ == address(0) || bondToken_ == address(0)
                || arbiter_ == address(0) || treasury_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        if (slashBps_ == 0 || slashBps_ > BPS_DENOMINATOR) revert InvalidBps(slashBps_);
        if (challengerRewardBps_ > BPS_DENOMINATOR) revert InvalidBps(challengerRewardBps_);

        registry = IAgentRegistry(registry_);
        attestations = IActionAttestation(attestations_);
        bondToken = IERC20(bondToken_);
        arbiter = arbiter_;
        treasury = treasury_;
        challengeWindow = challengeWindow_;
        challengeFee = challengeFee_;
        slashBps = slashBps_;
        challengerRewardBps = challengerRewardBps_;

        // Needed so the registry can pull a forfeited fee back into an agent's bond.
        IERC20(bondToken_).forceApprove(registry_, type(uint256).max);
    }

    // ---------------------------------------------------------------- disputes

    /// @notice Stake the challenge fee and open a dispute against an attestation.
    /// @param attestationId Attestation being challenged.
    /// @param reason Plain-language description of the alleged policy violation.
    function openDispute(uint256 attestationId, string calldata reason)
        external
        nonReentrant
        returns (uint256 disputeId)
    {
        if (!attestations.exists(attestationId)) revert UnknownAttestation(attestationId);

        uint256 existing = openDisputeOf[attestationId];
        if (existing != 0) revert DisputeAlreadyOpen(attestationId, existing);

        uint256 deadline = attestations.timestampOf(attestationId) + challengeWindow;
        if (block.timestamp > deadline) revert ChallengeWindowClosed(attestationId, deadline);

        uint256 agentId = attestations.agentOf(attestationId);
        if (registry.isAuthorized(agentId, msg.sender)) revert AgentCannotChallengeSelf(agentId);

        disputeId = ++disputeCount;
        uint256 fee = challengeFee;

        uint256 lockAmount = (registry.bondOf(agentId) * slashBps) / BPS_DENOMINATOR;

        _disputes[disputeId] = Dispute({
            id: disputeId,
            attestationId: attestationId,
            agentId: agentId,
            challenger: msg.sender,
            fee: fee,
            reason: reason,
            openedAt: block.timestamp,
            resolvedAt: 0,
            lockedAmount: lockAmount,
            slashedAmount: 0,
            challengerPayout: 0,
            bondBefore: registry.bondOf(agentId),
            bondAfter: 0,
            status: Status.Open
        });

        openDisputeOf[attestationId] = disputeId;
        _byAgent[agentId].push(disputeId);
        openDisputesByAgent[agentId] += 1;

        if (fee > 0) {
            bondToken.safeTransferFrom(msg.sender, address(this), fee);
        }

        // Reserve the amount at risk so the agent cannot withdraw out from under the dispute.
        registry.lockBond(agentId, lockAmount);
        attestations.markDisputed(attestationId);

        emit DisputeOpened(disputeId, attestationId, agentId, msg.sender, fee, reason, block.timestamp);
    }

    /// @notice Resolve an open dispute. Stand-in for a decentralised arbitration layer.
    /// @param disputeId Dispute to resolve.
    /// @param upheld True if the agent did violate its declared policy.
    function resolve(uint256 disputeId, bool upheld) external onlyArbiter nonReentrant {
        if (disputeId == 0 || disputeId > disputeCount) revert UnknownDispute(disputeId);

        Dispute storage d = _disputes[disputeId];
        if (d.status != Status.Open) revert DisputeNotOpen(disputeId);

        uint256 agentId = d.agentId;
        uint256 bondBefore = registry.bondOf(agentId);
        d.bondBefore = bondBefore;

        // Release this dispute's reservation before touching the bond.
        registry.unlockBond(agentId, d.lockedAmount);

        uint256 slashed;
        uint256 payout;

        if (upheld) {
            d.status = Status.Upheld;
            upheldDisputesByAgent[agentId] += 1;

            slashed = registry.slash(agentId, slashBps);

            uint256 reward = (slashed * challengerRewardBps) / BPS_DENOMINATOR;
            payout = reward + d.fee; // challenge fee is returned on a successful challenge
            uint256 toTreasury = slashed - reward;

            if (payout > 0) bondToken.safeTransfer(d.challenger, payout);
            if (toTreasury > 0) bondToken.safeTransfer(treasury, toTreasury);
        } else {
            d.status = Status.Rejected;
            rejectedDisputesByAgent[agentId] += 1;

            // Forfeited fee compensates the agent for the false accusation.
            if (d.fee > 0) {
                registry.creditBond(agentId, d.fee);
            }
        }

        openDisputesByAgent[agentId] -= 1;
        openDisputeOf[d.attestationId] = 0;
        d.resolvedAt = block.timestamp;
        d.slashedAmount = slashed;
        d.challengerPayout = payout;
        d.bondAfter = registry.bondOf(agentId);

        attestations.markResolved(d.attestationId, upheld);

        emit DisputeResolved(
            disputeId, d.attestationId, agentId, upheld, slashed, payout, bondBefore, d.bondAfter
        );
    }

    // ---------------------------------------------------------------- admin

    function setArbiter(address newArbiter) external onlyOwner {
        if (newArbiter == address(0)) revert ZeroAddress();
        emit ArbiterUpdated(arbiter, newArbiter);
        arbiter = newArbiter;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setParameters(
        uint256 challengeWindow_,
        uint256 challengeFee_,
        uint256 slashBps_,
        uint256 challengerRewardBps_
    ) external onlyOwner {
        if (slashBps_ == 0 || slashBps_ > BPS_DENOMINATOR) revert InvalidBps(slashBps_);
        if (challengerRewardBps_ > BPS_DENOMINATOR) revert InvalidBps(challengerRewardBps_);

        challengeWindow = challengeWindow_;
        challengeFee = challengeFee_;
        slashBps = slashBps_;
        challengerRewardBps = challengerRewardBps_;

        emit ParametersUpdated(challengeWindow_, challengeFee_, slashBps_, challengerRewardBps_);
    }

    // ---------------------------------------------------------------- views

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        if (disputeId == 0 || disputeId > disputeCount) revert UnknownDispute(disputeId);
        return _disputes[disputeId];
    }

    function disputeIdsOfAgent(uint256 agentId) external view returns (uint256[] memory) {
        return _byAgent[agentId];
    }

    function isChallengeable(uint256 attestationId) external view returns (bool) {
        if (!attestations.exists(attestationId)) return false;
        if (openDisputeOf[attestationId] != 0) return false;
        return block.timestamp <= attestations.timestampOf(attestationId) + challengeWindow;
    }

    /// @notice Most recent disputes first, for the dashboard dispute view.
    function listRecent(uint256 offset, uint256 limit) external view returns (Dispute[] memory page) {
        if (offset >= disputeCount) return new Dispute[](0);

        uint256 available = disputeCount - offset;
        uint256 size = (limit == 0 || limit > available) ? available : limit;

        page = new Dispute[](size);
        uint256 cursor = disputeCount - offset;
        for (uint256 i = 0; i < size; i++) {
            page[i] = _disputes[cursor - i];
        }
    }
}
