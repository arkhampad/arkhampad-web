// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title PadExtSwap
/// @notice Gasless trading of coins listed on other DEXs (Uniswap, Aerodrome, PancakeSwap...).
/// The user signs a swap; a relayer submits it and pays the gas. The swap runs through an
/// allowlisted DEX aggregator with calldata the user signed (by hash). ArkhamPad takes a 1%
/// trading fee in USDC plus a small network fee, and the user never gets less than the
/// minimum they signed.
///
/// Buy:  USDC -> coin. 1% of the USDC goes to the treasury, the rest is swapped.
/// Sell: coin -> USDC. The swap runs first; 1% of the USDC out goes to the treasury.
contract PadExtSwap is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 100; // 1% trading fee
    uint256 public constant BPS = 10_000;

    bytes32 public constant EXT_SWAP_TYPEHASH = keccak256(
        "ExtSwap(address user,bool isBuy,address coin,uint256 amountIn,uint256 minOut,address target,bytes32 dataHash,uint256 fee,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdc;
    address public admin;
    address public treasury;
    mapping(address => bool) public allowedTarget; // DEX aggregator routers
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    struct Swap {
        address user;
        bool isBuy;
        address coin;
        uint256 amountIn; // USDC for buys, coins for sells
        uint256 minOut; // coins for buys, USDC (after all fees) for sells
        address target;
        bytes data;
        uint256 fee; // network fee in USDC, paid to the relayer
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    event ExtSwapped(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 tradeFee, uint256 networkFee, uint256 nonce);
    event TargetSet(address indexed target, bool allowed);
    event AdminChanged(address indexed admin);
    event TreasuryChanged(address indexed treasury);

    error Expired();
    error NonceAlreadyUsed();
    error BadSignature();
    error TargetNotAllowed();
    error SwapFailed(bytes reason);
    error Slippage(uint256 got, uint256 min);
    error FeeTooHigh();
    error NotAdmin();
    error ZeroAddress();
    error BadCoin();

    constructor(IERC20 usdc_, address admin_, address treasury_) EIP712("ArkhamPad Swap", "1") {
        if (address(usdc_) == address(0) || admin_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        admin = admin_;
        treasury = treasury_;
    }

    // ------------------------------------------------------------------ admin

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function setTarget(address target, bool allowed) external onlyAdmin {
        if (target == address(0)) revert ZeroAddress();
        allowedTarget[target] = allowed;
        emit TargetSet(target, allowed);
    }

    function setAdmin(address a) external onlyAdmin {
        if (a == address(0)) revert ZeroAddress();
        admin = a;
        emit AdminChanged(a);
    }

    function setTreasury(address t) external onlyAdmin {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryChanged(t);
    }

    // ------------------------------------------------------------------ swaps

    function swap(Swap calldata s) external nonReentrant returns (uint256 out) {
        if (block.timestamp > s.deadline) revert Expired();
        if (nonceUsed[s.user][s.nonce]) revert NonceAlreadyUsed();
        if (!allowedTarget[s.target]) revert TargetNotAllowed();
        if (s.coin == address(usdc) || s.coin == address(0) || s.coin == s.target) revert BadCoin();
        bytes32 structHash = keccak256(abi.encode(
            EXT_SWAP_TYPEHASH, s.user, s.isBuy, s.coin, s.amountIn, s.minOut, s.target, keccak256(s.data), s.fee, s.nonce, s.deadline
        ));
        if (!SignatureChecker.isValidSignatureNow(s.user, _hashTypedDataV4(structHash), s.signature)) revert BadSignature();
        nonceUsed[s.user][s.nonce] = true;

        if (s.isBuy) out = _buy(s);
        else out = _sell(s);
    }

    function _buy(Swap calldata s) private returns (uint256 coinsOut) {
        // pull USDC for the trade + the network fee, pay both fees, swap the rest
        usdc.safeTransferFrom(s.user, address(this), s.amountIn + s.fee);
        uint256 tradeFee = (s.amountIn * FEE_BPS) / BPS;
        if (s.fee > 0) usdc.safeTransfer(msg.sender, s.fee);
        usdc.safeTransfer(treasury, tradeFee);
        uint256 spend = s.amountIn - tradeFee;

        IERC20 coin = IERC20(s.coin);
        uint256 before = coin.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));
        _call(usdc, spend, s.target, s.data);
        coinsOut = coin.balanceOf(address(this)) - before;
        if (coinsOut < s.minOut) revert Slippage(coinsOut, s.minOut);
        // any USDC the aggregator didn't use goes back to the user
        uint256 usdcAfter = usdc.balanceOf(address(this));
        uint256 unused = usdcAfter + spend > usdcBefore ? usdcAfter + spend - usdcBefore : 0;
        coin.safeTransfer(s.user, coinsOut);
        if (unused > 0) usdc.safeTransfer(s.user, unused);
        emit ExtSwapped(s.user, s.coin, true, s.amountIn, coinsOut, tradeFee, s.fee, s.nonce);
    }

    function _sell(Swap calldata s) private returns (uint256 usdcToUser) {
        IERC20 coin = IERC20(s.coin);
        uint256 coinBefore = coin.balanceOf(address(this));
        coin.safeTransferFrom(s.user, address(this), s.amountIn);
        uint256 received = coin.balanceOf(address(this)) - coinBefore; // fee-on-transfer coins
        uint256 before = usdc.balanceOf(address(this));
        _call(coin, received, s.target, s.data);
        uint256 got = usdc.balanceOf(address(this)) - before;
        uint256 tradeFee = (got * FEE_BPS) / BPS;
        if (got < tradeFee + s.fee) revert FeeTooHigh();
        usdcToUser = got - tradeFee - s.fee;
        if (usdcToUser < s.minOut) revert Slippage(usdcToUser, s.minOut);
        // coins the aggregator didn't take go back to the user
        uint256 left = coin.balanceOf(address(this)) - coinBefore;
        usdc.safeTransfer(treasury, tradeFee);
        if (s.fee > 0) usdc.safeTransfer(msg.sender, s.fee);
        usdc.safeTransfer(s.user, usdcToUser);
        if (left > 0) coin.safeTransfer(s.user, left);
        emit ExtSwapped(s.user, s.coin, false, got, s.amountIn, tradeFee, s.fee, s.nonce);
    }

    /// @dev Approve exactly what the swap may take, call the aggregator, then reset the approval.
    function _call(IERC20 tokenIn, uint256 amount, address target, bytes calldata data) private {
        tokenIn.forceApprove(target, amount);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) revert SwapFailed(ret);
        tokenIn.forceApprove(target, 0);
    }

    function cancel(uint256 nonce) external {
        nonceUsed[msg.sender][nonce] = true;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
