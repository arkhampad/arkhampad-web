// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Pool { uint8 venue; address target; address token; address hype; bool tokenIs0; uint24 fee; int24 tickSpacing; address hooks; }
interface IRouter {
    function buy(Pool calldata p, uint256 minOut, uint256 deadline) external payable returns (uint256);
    function sell(Pool calldata p, uint256 amountIn, uint256 minOut, uint256 deadline) external returns (uint256);
}
interface IERC20 { function approve(address, uint256) external returns (bool); function balanceOf(address) external view returns (uint256); }

/// Never deployed: placed at a throwaway address through an eth_call state override. Buys a little of a
/// coin through ArkhamPad's router and tries to sell it straight back. ok = false means the sell reverts
/// (taxed / blocked coin): buyers could get stuck.
contract SellCheck {
    receive() external payable {}
    function check(address router, Pool calldata p, uint256 buyWei) external returns (bool ok, uint256 bought, uint256 back) {
        bought = IRouter(router).buy{value: buyWei}(p, 0, block.timestamp + 600);
        uint256 bal = IERC20(p.token).balanceOf(address(this));
        IERC20(p.token).approve(router, type(uint256).max);
        try IRouter(router).sell(p, bal, 0, block.timestamp + 600) returns (uint256 got) { ok = got > 0; back = got; } catch { ok = false; }
    }
}
