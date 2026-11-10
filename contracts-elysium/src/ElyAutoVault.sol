// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// ElyScreener Auto Trade vault.
///
/// Users deposit HYPE (and coins) into their own balance here. Their rules (limit buy, take-profit,
/// stop-loss, whale copy) are executed by a keeper once the on-chain price says so. The keeper can only make
/// the vault trade through the ArkhamRouter: it can never withdraw, send or approve anything to anyone.
/// Only the balance owner can withdraw, at any time, even while the vault is paused or the keeper is gone.
///
/// Trust boundaries:
///  - limit buy / take-profit / stop-loss: the pool is chosen and fixed by the user when the rule is created;
///    the keeper only picks the moment, and the vault re-checks the price itself (router.quote) in the same tx.
///  - whale copy: the keeper also picks WHICH coin/pool to buy (the vault cannot know what a whale did), so
///    the user's loss is capped by the rule's budget and per-trade size; exits (take-profit / stop-loss on the
///    copied position) are checked on-chain like the other rules.
interface IERC20V {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IV3PoolV {
    function factory() external view returns (address);
}

interface IV3FactoryV {
    function getPool(address, address, uint24) external view returns (address);
}

interface IRouterV {
    struct Pool {
        uint8 venue;
        address target;
        address token;
        address hype;
        bool tokenIs0;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function buy(Pool calldata p, uint256 minOut, uint256 deadline) external payable returns (uint256);
    function sell(Pool calldata p, uint256 amountIn, uint256 minOut, uint256 deadline) external returns (uint256);
    function quote(Pool calldata p, bool isBuy, uint256 amountIn) external returns (uint256);
}

contract ElyAutoVault {
    uint8 public constant LIMIT_BUY = 0;
    uint8 public constant TAKE_PROFIT = 1;
    uint8 public constant STOP_LOSS = 2;
    uint8 public constant COPY = 3;
    uint16 public constant MAX_SLIP_BPS = 3000; // a rule never accepts more than 30% slippage

    struct Rule {
        address owner;
        uint8 kind;
        bool active;
        uint16 slipBps;
        uint40 expiry; // 0 = never
        IRouterV.Pool pool; // fixed by the user (not used by COPY)
        uint256 amount; // LIMIT_BUY: HYPE to spend. TAKE_PROFIT / STOP_LOSS: coins to sell. COPY: unused
        uint256 trigger; // LIMIT_BUY: coins wanted for `amount` (executes when the quote is at least this).
        //                  TAKE_PROFIT: HYPE wanted for `amount` (at least). STOP_LOSS: HYPE (at most).
        uint256 floor; // STOP_LOSS only: do not sell if the quote is below this (0 = sell at any price)
        // COPY
        address whale; // for the keeper's reference only
        uint256 budget; // HYPE the rule may still spend
        uint256 maxPerTrade;
        uint16 tpBps; // close a copied position at +tp% (0 = off)
        uint16 slBps; // close a copied position at -sl% (0 = off)
    }

    struct Pos {
        bool open;
        address token;
        uint256 amt;
        uint256 cost; // HYPE spent
        IRouterV.Pool pool;
    }

    error NotOwner();
    error NotKeeper();
    error Paused();
    error Locked();
    error BadInput();
    error NotActive();
    error NotReady();
    error NoBalance();
    error BadPool();
    error SendFailed();
    error TransferFailed();

    event KeeperSet(address indexed keeper, bool on);
    event PausedSet(bool paused);
    event OwnerChanged(address owner);
    event Deposit(address indexed user, address indexed token, uint256 amount);
    event Withdraw(address indexed user, address indexed token, uint256 amount);
    event RuleCreated(uint256 indexed id, address indexed user, uint8 kind, address token);
    event RuleCancelled(uint256 indexed id);
    event RuleFilled(uint256 indexed id, address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount);
    event PositionOpened(uint256 indexed id, uint256 index, address token, uint256 tokenAmount, uint256 cost);
    event PositionClosed(uint256 indexed id, uint256 index, uint256 hypeBack);

    address public owner; // admin: keepers and pause only; no access to any user balance
    IRouterV public immutable router;
    address public immutable poolManager; // the only v4 pool manager copy buys may use
    address public immutable v3Factory; // the only v3 factory copy buys may use
    mapping(address => bool) public keepers;
    bool public paused; // stops new rules and executions; never withdrawals or cancels

    mapping(address => uint256) public hypeOf;
    mapping(address => mapping(address => uint256)) public coinOf;
    mapping(uint256 => Rule) internal rules;
    mapping(uint256 => Pos[]) internal positions;
    uint256 public nextId = 1;

    uint256 private _lock = 1;
    bool private _busy; // true only while the router may send HYPE back to us

    modifier guard() {
        if (_lock != 1) revert Locked();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address router_, address poolManager_, address v3Factory_) {
        owner = owner_;
        router = IRouterV(router_);
        poolManager = poolManager_;
        v3Factory = v3Factory_;
        emit OwnerChanged(owner_);
    }

    receive() external payable {
        if (!_busy) revert SendFailed(); // plain sends are refused; use deposit()
    }

    // ------------------------------------------------------------------ admin (cannot touch user funds)
    function setKeeper(address k, bool on) external onlyOwner {
        keepers[k] = on;
        emit KeeperSet(k, on);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setOwner(address o) external onlyOwner {
        if (o == address(0)) revert BadInput();
        owner = o;
        emit OwnerChanged(o);
    }

    // ------------------------------------------------------------------ the user's balance
    function deposit() external payable guard {
        if (msg.value == 0) revert BadInput();
        hypeOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, address(0), msg.value);
    }

    function depositCoin(address token, uint256 amount) external guard {
        if (amount == 0 || token == address(0)) revert BadInput();
        uint256 before = IERC20V(token).balanceOf(address(this));
        _pull(token, msg.sender, amount);
        uint256 got = IERC20V(token).balanceOf(address(this)) - before;
        coinOf[msg.sender][token] += got;
        emit Deposit(msg.sender, token, got);
    }

    function withdraw(uint256 amount) external guard {
        if (amount == 0 || hypeOf[msg.sender] < amount) revert NoBalance();
        hypeOf[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert SendFailed();
        emit Withdraw(msg.sender, address(0), amount);
    }

    function withdrawCoin(address token, uint256 amount) external guard {
        if (amount == 0 || coinOf[msg.sender][token] < amount) revert NoBalance();
        coinOf[msg.sender][token] -= amount;
        _push(token, msg.sender, amount);
        emit Withdraw(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------ rules
    function createLimitBuy(IRouterV.Pool calldata pool, uint256 hypeAmount, uint256 minCoins, uint16 slipBps, uint40 expiry) external guard returns (uint256 id) {
        if (paused) revert Paused();
        if (hypeAmount == 0 || minCoins == 0 || pool.token == address(0) || slipBps > MAX_SLIP_BPS) revert BadInput();
        id = _new(LIMIT_BUY, slipBps, expiry, pool.token);
        Rule storage r = rules[id];
        r.pool = pool;
        r.amount = hypeAmount;
        r.trigger = minCoins;
    }

    function createSell(uint8 kind, IRouterV.Pool calldata pool, uint256 coins, uint256 trigger, uint256 floor_, uint16 slipBps, uint40 expiry) external guard returns (uint256 id) {
        if (paused) revert Paused();
        if ((kind != TAKE_PROFIT && kind != STOP_LOSS) || coins == 0 || trigger == 0 || pool.token == address(0) || slipBps > MAX_SLIP_BPS) revert BadInput();
        if (kind == STOP_LOSS && floor_ >= trigger) revert BadInput();
        id = _new(kind, slipBps, expiry, pool.token);
        Rule storage r = rules[id];
        r.pool = pool;
        r.amount = coins;
        r.trigger = trigger;
        r.floor = kind == STOP_LOSS ? floor_ : 0;
    }

    function createCopy(address whale, uint256 budget, uint256 maxPerTrade, uint16 tpBps, uint16 slBps, uint16 slipBps, uint40 expiry) external guard returns (uint256 id) {
        if (paused) revert Paused();
        if (whale == address(0) || budget == 0 || maxPerTrade == 0 || maxPerTrade > budget || slipBps > MAX_SLIP_BPS || slBps >= 10_000) revert BadInput();
        id = _new(COPY, slipBps, expiry, address(0));
        Rule storage r = rules[id];
        r.whale = whale;
        r.budget = budget;
        r.maxPerTrade = maxPerTrade;
        r.tpBps = tpBps;
        r.slBps = slBps;
    }

    function cancel(uint256 id) external guard {
        Rule storage r = rules[id];
        if (r.owner != msg.sender) revert NotOwner();
        if (!r.active) revert NotActive();
        r.active = false;
        emit RuleCancelled(id);
    }

    function _new(uint8 kind, uint16 slipBps, uint40 expiry, address token) private returns (uint256 id) {
        id = nextId++;
        Rule storage r = rules[id];
        r.owner = msg.sender;
        r.kind = kind;
        r.active = true;
        r.slipBps = slipBps;
        r.expiry = expiry;
        emit RuleCreated(id, msg.sender, kind, token);
    }

    // ------------------------------------------------------------------ execution
    /// Fire a limit buy, take-profit or stop-loss whose price condition holds right now.
    function execute(uint256 id) external guard {
        Rule storage r = rules[id];
        _may(r);
        if (r.kind == COPY) revert BadInput();
        uint256 deadline = block.timestamp;
        if (r.kind == LIMIT_BUY) {
            uint256 q = router.quote(r.pool, true, r.amount);
            if (q < r.trigger) revert NotReady();
            r.active = false;
            (uint256 spent, uint256 got) = _buy(r.owner, r.pool, r.amount, (r.trigger * (10_000 - r.slipBps)) / 10_000, deadline);
            emit RuleFilled(id, r.owner, r.pool.token, true, spent, got);
        } else {
            uint256 q = router.quote(r.pool, false, r.amount);
            if (r.kind == TAKE_PROFIT ? q < r.trigger : (q > r.trigger || q < r.floor)) revert NotReady();
            r.active = false;
            uint256 min = (q * (10_000 - r.slipBps)) / 10_000;
            (uint256 sold, uint256 back) = _sell(r.owner, r.pool, r.amount, min, deadline);
            emit RuleFilled(id, r.owner, r.pool.token, false, back, sold);
        }
    }

    /// Keeper only: a whale bought `pool.token`; buy `hypeAmount` for the rule's owner.
    function copyBuy(uint256 id, IRouterV.Pool calldata pool, uint256 hypeAmount) external guard returns (uint256 index) {
        Rule storage r = rules[id];
        _may(r);
        if (r.kind != COPY || !keepers[msg.sender]) revert NotKeeper();
        if (hypeAmount == 0 || hypeAmount > r.maxPerTrade || hypeAmount > r.budget || pool.token == address(0)) revert BadInput();
        _validCopyPool(pool);
        uint256 q = router.quote(pool, true, hypeAmount);
        if (q == 0) revert NotReady();
        r.budget -= hypeAmount;
        (uint256 spent, uint256 got) = _buy(r.owner, pool, hypeAmount, (q * (10_000 - r.slipBps)) / 10_000, block.timestamp);
        r.budget += hypeAmount - spent; // anything the pool did not take stays in the budget
        Pos storage p = positions[id].push();
        p.open = true;
        p.token = pool.token;
        p.amt = got;
        p.cost = spent;
        p.pool = pool;
        index = positions[id].length - 1;
        emit RuleFilled(id, r.owner, pool.token, true, spent, got);
        emit PositionOpened(id, index, pool.token, got, spent);
    }

    /// Close a copied position once its take-profit or stop-loss holds on the live quote.
    function closePosition(uint256 id, uint256 index) external guard {
        Rule storage r = rules[id];
        if (r.owner == address(0) || r.kind != COPY) revert BadInput();
        if (msg.sender != r.owner && !keepers[msg.sender]) revert NotKeeper();
        if (paused && msg.sender != r.owner) revert Paused();
        Pos storage p = positions[id][index];
        if (!p.open) revert NotActive();
        uint256 q = router.quote(p.pool, false, p.amt);
        bool tp = r.tpBps > 0 && q >= (p.cost * (10_000 + r.tpBps)) / 10_000;
        bool sl = r.slBps > 0 && q <= (p.cost * (10_000 - r.slBps)) / 10_000;
        if (msg.sender != r.owner && !tp && !sl) revert NotReady();
        p.open = false;
        (uint256 sold, uint256 back) = _sell(r.owner, p.pool, p.amt, (q * (10_000 - r.slipBps)) / 10_000, block.timestamp);
        emit RuleFilled(id, r.owner, p.pool.token, false, back, sold);
        emit PositionClosed(id, index, back);
    }

    function _may(Rule storage r) private view {
        if (paused) revert Paused();
        if (!r.active) revert NotActive();
        if (r.expiry != 0 && block.timestamp > r.expiry) revert NotReady();
        if (msg.sender != r.owner && !keepers[msg.sender]) revert NotKeeper();
    }

    function _validCopyPool(IRouterV.Pool calldata p) private view {
        if (p.venue == 4) {
            if (p.target != poolManager) revert BadPool();
        } else if (p.venue == 3) {
            if (IV3PoolV(p.target).factory() != v3Factory) revert BadPool();
            (address a, address b) = p.tokenIs0 ? (p.token, p.hype) : (p.hype, p.token);
            if (IV3FactoryV(v3Factory).getPool(a, b, p.fee) != p.target) revert BadPool();
        } else {
            revert BadPool();
        }
    }

    // ------------------------------------------------------------------ the two router calls (balance deltas, not return values)
    function _buy(address user, IRouterV.Pool memory pool, uint256 hypeAmount, uint256 minOut, uint256 deadline) private returns (uint256 spent, uint256 got) {
        if (hypeOf[user] < hypeAmount) revert NoBalance();
        uint256 c0 = IERC20V(pool.token).balanceOf(address(this));
        uint256 h0 = address(this).balance;
        hypeOf[user] -= hypeAmount;
        _busy = true;
        router.buy{value: hypeAmount}(pool, minOut, deadline);
        _busy = false;
        spent = h0 - address(this).balance;
        got = IERC20V(pool.token).balanceOf(address(this)) - c0;
        hypeOf[user] += hypeAmount - spent; // refund of what the router sent back
        coinOf[user][pool.token] += got;
    }

    function _sell(address user, IRouterV.Pool memory pool, uint256 coins, uint256 minOut, uint256 deadline) private returns (uint256 sold, uint256 back) {
        if (coinOf[user][pool.token] < coins) revert NoBalance();
        uint256 c0 = IERC20V(pool.token).balanceOf(address(this));
        uint256 h0 = address(this).balance;
        coinOf[user][pool.token] -= coins;
        IERC20V(pool.token).approve(address(router), coins);
        _busy = true;
        router.sell(pool, coins, minOut, deadline);
        _busy = false;
        IERC20V(pool.token).approve(address(router), 0);
        sold = c0 - IERC20V(pool.token).balanceOf(address(this));
        back = address(this).balance - h0;
        coinOf[user][pool.token] += coins - sold; // coins the pool did not take stay with the user
        hypeOf[user] += back;
    }

    // ------------------------------------------------------------------ views
    function ruleOf(uint256 id) external view returns (Rule memory) {
        return rules[id];
    }

    function positionsOf(uint256 id) external view returns (Pos[] memory) {
        return positions[id];
    }

    // ------------------------------------------------------------------ token plumbing
    function _pull(address token, address from, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(IERC20V.transferFrom.selector, from, address(this), amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }

    function _push(address token, address to, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeWithSelector(IERC20V.transfer.selector, to, amount));
        if (!ok || (r.length != 0 && !abi.decode(r, (bool)))) revert TransferFailed();
    }
}
