// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title PadCoin
/// @notice A coin created on ArkhamPad. The whole supply is minted once, to
/// its bonding curve, at creation. There is no owner and no way to mint more.
///
/// Optional creator lock: until `unlockTime`, the creator's own wallet cannot
/// move or sell this coin. It can still receive (buy) more. The lock length is
/// chosen at launch, can never be changed and is at most one day.
/// Supports EIP-2612 permit, so holders can approve by signature (no gas).
contract PadCoin is ERC20, ERC20Permit {
    uint256 public constant MAX_LOCK = 1 days;

    address public immutable creator;
    uint256 public immutable unlockTime;
    /// @notice Link to the coin's metadata (image, description, socials).
    string public metadataURI;

    error CreatorLocked(uint256 unlockTime);
    error LockTooLong();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 supply,
        address mintTo,
        address creator_,
        uint256 lockSeconds
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (lockSeconds > MAX_LOCK) revert LockTooLong();
        creator = creator_;
        unlockTime = lockSeconds == 0 ? 0 : block.timestamp + lockSeconds;
        metadataURI = metadataURI_;
        _mint(mintTo, supply);
    }

    function isLocked() public view returns (bool) {
        return block.timestamp < unlockTime;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == creator && from != address(0) && block.timestamp < unlockTime) revert CreatorLocked(unlockTime);
        super._update(from, to, value);
    }
}
