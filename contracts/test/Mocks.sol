// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPadPoolBuilder} from "../src/interfaces.sol";

contract MockUSDC is ERC20, ERC20Permit {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockPoolBuilder is IPadPoolBuilder {
    address public lastCoin;
    uint256 public lastCoins;
    uint256 public lastUsdc;
    uint256 public buybackFunds;
    IERC20 public usdc;
    constructor(IERC20 u) { usdc = u; }
    function buildPool(address coin, uint256 coinAmount, uint256 usdcAmount) external {
        require(IERC20(coin).balanceOf(address(this)) >= coinAmount, "coins not sent");
        require(usdc.balanceOf(address(this)) >= usdcAmount, "usdc not sent");
        lastCoin = coin; lastCoins = coinAmount; lastUsdc = usdcAmount;
    }
    function fundBuyback(address, uint256 usdcAmount) external {
        usdc.transferFrom(msg.sender, address(this), usdcAmount);
        buybackFunds += usdcAmount;
    }
}

/// BNB-style dollar: 18 decimals and no permit (users must approve once).
contract MockUSD18 is ERC20 {
    constructor() ERC20("Binance-Peg USD Coin", "USDC") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
