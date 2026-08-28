// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentRegistry} from "./interfaces/IPraxis.sol";

/// @title AgentRegistry
/// @notice Identity + bonding layer for Praxis Protocol.
///         An autonomous agent registers under an owner address, publishes a
///         metadata URI describing its declared policy, and posts an ERC-20 bond
///         that is at risk if it is successfully disputed.
contract AgentRegistry is IAgentRegistry, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Agent {
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

    IERC20 public immutable bondToken;

    /// @notice Contract permitted to lock/slash bonds (the DisputeSlashing module).
    address public slasher;

    uint256 public minBond;
    uint256 public agentCount;

    mapping(uint256 => Agent) private _agents;
    /// @dev agentId => operator => allowed. Operators may attest on the agent's behalf.
    mapping(uint256 => mapping(address => bool)) public operators;
    mapping(address => uint256[]) private _agentsByOwner;

    event AgentRegistered(
        uint256 indexed agentId, address indexed owner, string name, string metadataURI, uint256 bond
    );
    event AgentDeregistered(uint256 indexed agentId, address indexed owner, uint256 refunded);
    event MetadataUpdated(uint256 indexed agentId, string metadataURI);
    event OperatorSet(uint256 indexed agentId, address indexed operator, bool allowed);
    event BondIncreased(uint256 indexed agentId, address indexed from, uint256 amount, uint256 newBond);
    event BondWithdrawn(uint256 indexed agentId, address indexed to, uint256 amount, uint256 newBond);
    event BondLocked(uint256 indexed agentId, uint256 amount, uint256 totalLocked);
    event BondUnlocked(uint256 indexed agentId, uint256 amount, uint256 totalLocked);
    event AgentSlashed(uint256 indexed agentId, uint256 amount, uint256 bps, uint256 remainingBond);
    event SlasherUpdated(address indexed previousSlasher, address indexed newSlasher);
    event MinBondUpdated(uint256 previousMinBond, uint256 newMinBond);

    error UnknownAgent(uint256 agentId);
    error NotAgentOwner(uint256 agentId, address caller);
    error NotSlasher(address caller);
    error BondBelowMinimum(uint256 provided, uint256 required);
    error AgentInactive(uint256 agentId);
    error BondLockedForDispute(uint256 agentId, uint256 locked);
    error InsufficientFreeBond(uint256 requested, uint256 available);
    error InvalidBps(uint256 bps);
    error EmptyName();
    error ZeroAddress();

    modifier onlySlasher() {
        if (msg.sender != slasher) revert NotSlasher(msg.sender);
        _;
    }

    modifier agentExists(uint256 agentId) {
        if (agentId == 0 || agentId > agentCount) revert UnknownAgent(agentId);
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        _;
    }

    constructor(address bondToken_, uint256 minBond_, address admin) Ownable(admin) {
        if (bondToken_ == address(0) || admin == address(0)) revert ZeroAddress();
        bondToken = IERC20(bondToken_);
        minBond = minBond_;
    }

    // ---------------------------------------------------------------- registration

    /// @notice Register a new agent and post its opening bond.
    /// @param name Human-readable agent name shown in the dashboard.
    /// @param metadataURI Pointer to the off-chain profile + declared policy.
    /// @param bondAmount ERC-20 bond to post, must be >= minBond.
    function register(string calldata name, string calldata metadataURI, uint256 bondAmount)
        external
        nonReentrant
        returns (uint256 agentId)
    {
        if (bytes(name).length == 0) revert EmptyName();
        if (bondAmount < minBond) revert BondBelowMinimum(bondAmount, minBond);

        agentId = ++agentCount;
        Agent storage agent = _agents[agentId];
        agent.owner = msg.sender;
        agent.name = name;
        agent.metadataURI = metadataURI;
        agent.bond = bondAmount;
        agent.registeredAt = block.timestamp;
        agent.active = true;

        _agentsByOwner[msg.sender].push(agentId);

        bondToken.safeTransferFrom(msg.sender, address(this), bondAmount);

        emit AgentRegistered(agentId, msg.sender, name, metadataURI, bondAmount);
    }

    /// @notice Exit the protocol and reclaim the full remaining bond.
    function deregister(uint256 agentId)
        external
        agentExists(agentId)
        onlyAgentOwner(agentId)
        nonReentrant
    {
        Agent storage agent = _agents[agentId];
        if (!agent.active) revert AgentInactive(agentId);
        if (agent.lockedBond != 0) revert BondLockedForDispute(agentId, agent.lockedBond);

        uint256 refund = agent.bond;
        agent.bond = 0;
        agent.active = false;

        if (refund > 0) {
            bondToken.safeTransfer(msg.sender, refund);
        }
        emit AgentDeregistered(agentId, msg.sender, refund);
    }

    function updateMetadata(uint256 agentId, string calldata metadataURI)
        external
        agentExists(agentId)
        onlyAgentOwner(agentId)
    {
        _agents[agentId].metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    /// @notice Authorise an orchestrator to submit attestations for this agent.
    function setOperator(uint256 agentId, address operator, bool allowed)
        external
        agentExists(agentId)
        onlyAgentOwner(agentId)
    {
        if (operator == address(0)) revert ZeroAddress();
        operators[agentId][operator] = allowed;
        emit OperatorSet(agentId, operator, allowed);
    }

    // ---------------------------------------------------------------- bonding

    /// @notice Add to an agent's bond. Anyone may top up on an agent's behalf.
    function topUpBond(uint256 agentId, uint256 amount) external agentExists(agentId) nonReentrant {
        Agent storage agent = _agents[agentId];
        if (!agent.active) revert AgentInactive(agentId);

        agent.bond += amount;
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BondIncreased(agentId, msg.sender, amount, agent.bond);
    }

    /// @inheritdoc IAgentRegistry
    function creditBond(uint256 agentId, uint256 amount)
        external
        override
        agentExists(agentId)
        onlySlasher
        nonReentrant
    {
        Agent storage agent = _agents[agentId];
        agent.bond += amount;
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        emit BondIncreased(agentId, msg.sender, amount, agent.bond);
    }

    /// @notice Withdraw free (unlocked) bond, keeping the balance at or above minBond.
    function withdrawBond(uint256 agentId, uint256 amount)
        external
        agentExists(agentId)
        onlyAgentOwner(agentId)
        nonReentrant
    {
        Agent storage agent = _agents[agentId];
        if (!agent.active) revert AgentInactive(agentId);

        uint256 free = agent.bond - agent.lockedBond;
        if (amount > free) revert InsufficientFreeBond(amount, free);

        uint256 remaining = agent.bond - amount;
        if (remaining < minBond) revert BondBelowMinimum(remaining, minBond);

        agent.bond = remaining;
        bondToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, msg.sender, amount, remaining);
    }

    /// @inheritdoc IAgentRegistry
    function lockBond(uint256 agentId, uint256 amount) external override agentExists(agentId) onlySlasher {
        Agent storage agent = _agents[agentId];
        uint256 free = agent.bond - agent.lockedBond;
        uint256 toLock = amount > free ? free : amount;
        agent.lockedBond += toLock;
        emit BondLocked(agentId, toLock, agent.lockedBond);
    }

    /// @inheritdoc IAgentRegistry
    function unlockBond(uint256 agentId, uint256 amount) external override agentExists(agentId) onlySlasher {
        Agent storage agent = _agents[agentId];
        uint256 toUnlock = amount > agent.lockedBond ? agent.lockedBond : amount;
        agent.lockedBond -= toUnlock;
        emit BondUnlocked(agentId, toUnlock, agent.lockedBond);
    }

    /// @inheritdoc IAgentRegistry
    /// @dev Slashed tokens are pushed to the slasher, which splits them between the
    ///      challenger reward and the protocol treasury.
    function slash(uint256 agentId, uint256 bps)
        external
        override
        agentExists(agentId)
        onlySlasher
        nonReentrant
        returns (uint256 amount)
    {
        if (bps == 0 || bps > BPS_DENOMINATOR) revert InvalidBps(bps);

        Agent storage agent = _agents[agentId];
        amount = (agent.bond * bps) / BPS_DENOMINATOR;

        agent.bond -= amount;
        agent.totalSlashed += amount;
        agent.slashCount += 1;

        // A slash can push the remaining bond under what was reserved; clamp.
        if (agent.lockedBond > agent.bond) {
            agent.lockedBond = agent.bond;
        }
        // An agent whose bond falls below the minimum is no longer trusted to act.
        if (agent.bond < minBond) {
            agent.active = false;
        }

        if (amount > 0) {
            bondToken.safeTransfer(msg.sender, amount);
        }
        emit AgentSlashed(agentId, amount, bps, agent.bond);
    }

    // ---------------------------------------------------------------- admin

    function setSlasher(address newSlasher) external onlyOwner {
        if (newSlasher == address(0)) revert ZeroAddress();
        emit SlasherUpdated(slasher, newSlasher);
        slasher = newSlasher;
    }

    function setMinBond(uint256 newMinBond) external onlyOwner {
        emit MinBondUpdated(minBond, newMinBond);
        minBond = newMinBond;
    }

    // ---------------------------------------------------------------- views

    function exists(uint256 agentId) external view override returns (bool) {
        return agentId != 0 && agentId <= agentCount;
    }

    function isActive(uint256 agentId) external view override returns (bool) {
        return agentId != 0 && agentId <= agentCount && _agents[agentId].active;
    }

    function isAuthorized(uint256 agentId, address account) external view override returns (bool) {
        if (agentId == 0 || agentId > agentCount) return false;
        return _agents[agentId].owner == account || operators[agentId][account];
    }

    function bondOf(uint256 agentId) external view override returns (uint256) {
        return _agents[agentId].bond;
    }

    function ownerOfAgent(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function getAgent(uint256 agentId)
        external
        view
        override
        agentExists(agentId)
        returns (AgentView memory)
    {
        Agent storage a = _agents[agentId];
        return AgentView({
            id: agentId,
            owner: a.owner,
            name: a.name,
            metadataURI: a.metadataURI,
            bond: a.bond,
            lockedBond: a.lockedBond,
            registeredAt: a.registeredAt,
            totalSlashed: a.totalSlashed,
            slashCount: a.slashCount,
            active: a.active
        });
    }

    /// @notice Page through registered agents. `start` is 1-based; returns up to `limit` agents.
    function listAgents(uint256 start, uint256 limit) external view returns (AgentView[] memory page) {
        if (start == 0) start = 1;
        if (start > agentCount) return new AgentView[](0);

        uint256 end = start + limit - 1;
        if (limit == 0 || end > agentCount) end = agentCount;

        page = new AgentView[](end - start + 1);
        for (uint256 i = start; i <= end; i++) {
            Agent storage a = _agents[i];
            page[i - start] = AgentView({
                id: i,
                owner: a.owner,
                name: a.name,
                metadataURI: a.metadataURI,
                bond: a.bond,
                lockedBond: a.lockedBond,
                registeredAt: a.registeredAt,
                totalSlashed: a.totalSlashed,
                slashCount: a.slashCount,
                active: a.active
            });
        }
    }

    function agentsOfOwner(address owner_) external view returns (uint256[] memory) {
        return _agentsByOwner[owner_];
    }
}
