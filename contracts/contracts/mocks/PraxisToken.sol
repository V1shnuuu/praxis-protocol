// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PraxisToken
/// @notice Test bonding asset for Praxis Protocol on Polygon Amoy.
///         Includes an open faucet so demo wallets can self-fund. Testnet only.
contract PraxisToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000e18;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    event FaucetClaimed(address indexed account, uint256 amount);

    error FaucetCooldownActive(uint256 availableAt);

    constructor(address initialHolder, uint256 initialSupply)
        ERC20("Praxis Bond Token", "PRAX")
        Ownable(initialHolder)
    {
        if (initialSupply > 0) {
            _mint(initialHolder, initialSupply);
        }
    }

    /// @notice Anyone may claim demo tokens once per cooldown window.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldownActive(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
