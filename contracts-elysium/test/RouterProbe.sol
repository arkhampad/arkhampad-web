// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ArkhamRouter} from "../src/ArkhamRouter.sol";

interface IApprove {
    function approve(address, uint256) external returns (bool);
}

/// Used only inside eth_call (never deployed): buy then sell one token through the router and
/// report each step, so the router can be checked against every real pool on Elysium.
contract RouterProbe {
    function run(ArkhamRouter r, ArkhamRouter.Pool calldata p)
        external
        payable
        returns (uint8 stage, uint256 qb, uint256 bought, uint256 qs, uint256 back, bytes memory err)
    {
        try r.quote(p, true, msg.value) returns (uint256 v) { qb = v; } catch (bytes memory e) { return (1, 0, 0, 0, 0, e); }
        try r.buy{value: msg.value}(p, 0, block.timestamp + 60) returns (uint256 v) { bought = v; } catch (bytes memory e) { return (2, qb, 0, 0, 0, e); }
        IApprove(p.token).approve(address(r), type(uint256).max);
        try r.quote(p, false, bought) returns (uint256 v) { qs = v; } catch (bytes memory e) { return (3, qb, bought, 0, 0, e); }
        try r.sell(p, bought, 0, block.timestamp + 60) returns (uint256 v) { back = v; } catch (bytes memory e) { return (4, qb, bought, qs, 0, e); }
        stage = 5;
    }

    receive() external payable {}
}
