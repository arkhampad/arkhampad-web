// Help centre: short answers to the questions people ask most, plus the full fee list.
// Fees are listed only here and in the Terms of Use, never on trade, coin or create screens.
export type HelpTopic = { id: string; title: string; items: [string, string][] };

export const CONTACT_EMAIL = "team@arkhampad.com";

export const fees: { what: string; fee: string; note: string }[] = [
  { what: "Creating a coin", fee: "Free", note: "No platform fee to launch." },
  { what: "Trading a coin launched on ArkhamPad", fee: "2%", note: "Pool fee on every trade, in any app. 30% goes to the coin: to its creator or into buyback and burn, as chosen at launch." },
  { what: "A coin's first five minutes", fee: "30% → 2%", note: "Launch fee against sniping bots: starts at 30% and falls in a straight line to 2% over five minutes. Same 70/30 split." },
  { what: "Creator's own buy at launch", fee: "2%", note: "At least $5, always at the normal 2% (never the launch fee)." },
  { what: "Trading coins from other DEXs", fee: "1%", note: "Of the trade amount, on top of the other DEX's own pool fee." },
  { what: "Deposits from other chains", fee: "0.25%", note: "Only when you deposit from a chain ArkhamPad doesn't trade on directly." },
  { what: "Network costs", fee: "Varies", note: "The blockchain's own cost for your transaction, paid from your USDC balance. You never need ETH or another gas token." },
  { what: "Copy trading", fee: "No extra fee", note: "A copied buy pays the normal trading fee only." },
  { what: "Deposits and withdrawals", fee: "No platform fee", note: "Network costs apply." },
];

export const promotePrices: [string, string][] = [["6 hours", "$10"], ["24 hours", "$20"], ["7 days", "$99"]];

export const help: HelpTopic[] = [
  {
    id: "account", title: "Account and login",
    items: [
      ["How do I sign up?", "Tap Log in and choose Google, email, X or your own wallet. If you don't connect a wallet, a secure one is created for your account automatically."],
      ["I logged in and my balance is gone.", "You probably used a different login method. Each method creates its own account. Log out and log in with the method you used first."],
      ["Do I need a seed phrase?", "Not with Google, email or X. If you connect your own wallet, its recovery phrase is yours to keep safe. ArkhamPad will never ask for it."],
      ["Can I use ArkhamPad on my phone?", "Yes. It works in any mobile browser. Add it to your home screen to open it like an app and get push alerts."],
      ["How do I log out?", "Tap the account icon at the top right, then Log out."],
    ],
  },
  {
    id: "money", title: "Deposits, withdrawals and balance",
    items: [
      ["How do I deposit?", "Tap Deposit, choose a network and send only USDC to the address shown. It usually arrives in about a minute."],
      ["How do I withdraw?", "Tap the account icon, then Withdraw. Enter the amount, choose the network, paste the address and confirm. Check the address twice: transfers can't be reversed."],
      ["Why do I see one balance and not one per chain?", "ArkhamPad shows your total USDC as one cash balance, so you don't have to think about chains before you trade."],
      ["I sent the wrong token or used the wrong network.", "Tokens other than USDC, or USDC on an unsupported network, may be lost. Email us with the transaction link and we'll check what can be done, but we can't promise recovery."],
      ["Where do I get test USDC?", "On testnet, log in and tap Get test USDC. Test USDC has no value and can't be withdrawn to an exchange."],
      ["Do I need ETH for gas?", "No. Network costs are paid from your USDC balance."],
    ],
  },
  {
    id: "trading", title: "Trading",
    items: [
      ["How do I buy a coin?", "Open the coin, type an amount in USDC and tap Buy. Your coins appear on your Profile."],
      ["How do I sell?", "Open the coin, switch to Sell, pick a share or type an amount and confirm. The USDC goes back to your cash balance."],
      ["My trade failed. Did I lose money?", "No. If the price moves too far before your trade confirms, it's cancelled and your USDC stays in your balance. Try again."],
      ["What are Limit and Auto orders?", "Limit buys or sells when a coin reaches the market cap you set. Auto sets a take profit and a stop loss on a coin you hold. Both run even when the site is closed."],
      ["Where are my orders?", "On your Profile under Orders, and on the Alerts page. You can cancel them there."],
      ["How does copy trading work?", "Follow a trader. When they buy, you get an alert with a Copy button that buys the same coin with your preset amount. Nothing is bought until you tap Copy."],
      ["Why is a coin's price different from the chart?", "Prices move every second on busy coins. The trade panel always shows the latest estimate before you confirm."],
    ],
  },
  {
    id: "creating", title: "Creating a coin",
    items: [
      ["How do I create a coin?", "Open Create, describe your idea in any language, pick one of the AI suggestions, choose a chain and tap Launch."],
      ["Can I change the name, ticker, description or links later?", "No. They're saved with the coin at launch. The creator can change the coin image later from the coin page."],
      ["What is a creator lock?", "An optional 1 hour or 24 hour period when the creator can't sell their own coins. It's enforced by the contract and can't be ended early."],
      ["How do I get creator fees?", "Automatically. Pool fees are collected every 30 minutes and your 30% goes to your cash balance (or to buyback and burn). Your coin's page shows what you've earned."],
      ["Does a coin graduate?", "No. Every ArkhamPad coin opens straight into a Uniswap pool at launch, with its liquidity locked forever."],
      ["Why do I need to buy at least $5 when I launch?", "Your first buy is the pool's first trade, which lets DEX screeners see the coin right away. It also keeps out empty spam launches."],
    ],
  },
  {
    id: "promote", title: "Promote",
    items: [
      ["What does Promote do?", "It shows a coin in the Promoted row at the top of Discover for the time you choose. Anyone can promote any coin, including coins from other DEXs."],
      ["How do I pay for it?", "From your USDC balance. Prices are 6 hours $10, 24 hours $20 and 7 days $99."],
      ["Can I get a refund?", "Promotions start right away, so they can't be refunded once confirmed."],
    ],
  },
  {
    id: "alerts", title: "Alerts and notifications",
    items: [
      ["How do I set a price alert?", "Open a coin and tap Price alert. Pick the market cap and confirm."],
      ["I don't get push notifications.", "Allow notifications for arkhampad.com in your browser. On iPhone, add ArkhamPad to your home screen first and open it from there."],
      ["Do you send emails?", "No. Alerts come through the bell at the top of the site and push notifications only."],
    ],
  },
  {
    id: "invites", title: "Invites",
    items: [
      ["How do invites work?", "Share your invite link from Invite & earn. For 12 months you get 25% of ArkhamPad's share of the fees on trades by people who joined with your link."],
      ["Why wasn't an invite counted?", "The person must open your link before they log in for the first time. Self-invites and fake accounts aren't paid."],
    ],
  },
  {
    id: "safety", title: "Safety",
    items: [
      ["Will ArkhamPad ever message me first?", "No. We never DM first and never ask for your seed phrase, password or a payment to unlock anything."],
      ["How do I know a coin is the real one?", "Check the contract address. Names and tickers can be copied, the address can't."],
      ["Is ArkhamPad giving investment advice?", "No. Everything on the site, including AI features, is information only. Meme coins are very risky and can lose all their value."],
      ["How do I report a coin or a user?", `Email ${CONTACT_EMAIL} with the coin link and what you saw.`],
    ],
  },
];
