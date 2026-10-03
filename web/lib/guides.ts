// Learn articles. Written for people first, structured for search and AI answers:
// a short "In short" answer, simple sections and a FAQ.
export type Article = { slug: string; short: string; sections: [string, string][]; faq: [string, string][] };

export const articles: Record<string, Article> = {
  "what-is-arkhampad": {
    slug: "what-is-arkhampad",
    short: "ArkhamPad is a launchpad where anyone can create a coin by describing it in one sentence, and trade thousands of coins on Robinhood Chain and Base using only USDC.",
    sections: [
      ["What you can do", "Create a coin with AI in about a minute, buy and sell coins with one tap, follow top traders and copy their buys, set alerts and automatic take profit or stop loss orders."],
      ["Why USDC only", "You always see your balance in dollars. You deposit USDC, trade in USDC and withdraw USDC. There is no gas token to buy and no bridge to use."],
      ["Who it is for", "New creators who want a coin without code, and traders who want a fast, simple place to find new coins and coins from other DEXs in one list."],
    ],
    faq: [["Do I need a crypto wallet?", "No. You can log in with Google, email or X and we create a secure wallet for you. You can also connect your own wallet."], ["Which chains are supported?", "Robinhood Chain and Base. When you create a coin you pick one of them."]],
  },
  "deposit-and-withdraw-usdc": {
    slug: "deposit-and-withdraw-usdc",
    short: "Open Deposit, pick the network, and send only USDC to the address shown. It arrives in about a minute. To withdraw, enter an amount and an address, then confirm.",
    sections: [
      ["Depositing", "Tap Deposit, choose Base, Robinhood or another chain, then copy the address or scan the QR code from your wallet or exchange. Send only USDC. Your cash balance updates automatically."],
      ["Withdrawing", "Tap Withdraw, enter the amount or tap MAX, choose the network and paste the address. Check it twice. Blockchain transfers cannot be reversed."],
      ["Sending to an exchange", "Make sure the exchange supports USDC on the network you pick. If you are unsure, send a small test amount first."],
    ],
    faq: [["What happens if I send another coin?", "Coins other than USDC, or USDC on an unsupported network, can be lost. Always send USDC on the network shown."], ["How long does a withdrawal take?", "Usually under a minute, depending on the network."]],
  },
  "create-a-coin-with-ai": {
    slug: "create-a-coin-with-ai",
    short: "Open Create, describe your idea in one sentence in any language, pick one of the three AI suggestions, choose a chain and tap Launch. Launching is free and takes about a minute.",
    sections: [
      ["What you need", "An ArkhamPad account. Log in with Google, email, X or your own wallet. You do not need any USDC unless you want to be the first buyer."],
      ["Step by step", "Write your idea, for example a frog astronaut who only buys the dip. AI suggests three coins with a name, ticker, story and image. Edit anything, pick Robinhood Chain or Base, set a creator lock if you want, then tap Launch."],
      ["Tips for a better coin", "Keep the name short and easy to say. A clear image and a one line story help people remember it. Share it right after launch with the ready post and contract address."],
    ],
    faq: [["Can I write my idea in my own language?", "Yes. AI understands any language and creates the coin in English so it reaches everyone."], ["Does it cost anything to launch?", "No. Launching is free. You only pay if you choose to buy or boost your coin."], ["Can I use my own image?", "Yes. Tap Upload my own image instead of using the AI image."]],
  },
  "robinhood-chain-or-base": {
    slug: "robinhood-chain-or-base",
    short: "Both chains work the same way on ArkhamPad: fast trades in USDC. Pick the one where your community already is. You choose one chain per coin.",
    sections: [
      ["Robinhood Chain", "A newer network built for trading. Good if your audience follows Robinhood and wants to be early on a young chain."],
      ["Base", "A large, busy network with many traders and apps. Good if you want to reach an existing crowd quickly."],
      ["Does it change anything for buyers?", "No. Buyers just tap Buy. Prices, balances and fees are shown in USDC on both chains."],
    ],
    faq: [["Can my coin be on both chains?", "No. Each coin lives on the chain you pick at launch."], ["Can I change the chain later?", "No. The chain is fixed once the coin is live."]],
  },
  "creator-lock": {
    slug: "creator-lock",
    short: "A creator lock stops you from selling your own coins for 1 hour or 24 hours after launch. Buyers see a Dev locked badge, which builds trust.",
    sections: [
      ["How it works", "When you launch, choose No lock, 1 hour or 24 hours. Until the time ends, the coins you hold as the creator cannot be sold."],
      ["Why it helps", "The biggest fear of buyers is that the creator sells right away. A visible lock removes that fear for the first hours, when most buying happens."],
    ],
    faq: [["Can I unlock early?", "No. The lock is enforced by the smart contract and nobody can end it early."], ["Can I still buy more while locked?", "Yes. Only selling your own coins is blocked."]],
  },
  "creator-fees-vs-buyback-and-burn": {
    slug: "creator-fees-vs-buyback-and-burn",
    short: "Every trade pays a small creator fee. Choose To you to receive it in your balance, or Buyback and burn to use it to buy your coin and remove it from supply forever.",
    sections: [
      ["To you", "Fees collect in your account and you claim them to your cash balance whenever you like."],
      ["Buyback and burn", "Fees buy your coin from the market and burn it. Supply goes down over time, which holders usually like. The amount burned is shown on the coin page."],
    ],
    faq: [["Can I switch later?", "No. You pick the mode at launch so buyers know what to expect."]],
  },
  "what-is-a-bonding-curve": {
    slug: "what-is-a-bonding-curve",
    short: "A bonding curve sets the price by a formula: each buy raises the price a little and each sell lowers it. There is always someone to trade with, so you can buy or sell at any time.",
    sections: [
      ["Why it is used", "New coins have no market yet. The curve acts as the market, so anyone can buy from the first second and sell back whenever they want."],
      ["What it means for you", "Early buyers get a lower price. As more people buy, the price climbs until the coin graduates."],
    ],
    faq: [["Can the creator take the money in the curve?", "No. The money stays in the contract until graduation, when it moves to a locked pool."]],
  },
  "what-is-graduation": {
    slug: "what-is-graduation",
    short: "A coin starts at $4.5K market cap. When it reaches $7.5K it graduates: its money moves into a trading pool that is locked forever, and trading continues there.",
    sections: [
      ["What changes after graduation", "Nothing for you as a trader. You still tap Buy and Sell. Behind the scenes the coin now trades in a public pool."],
      ["Why the pool is locked", "Nobody, including the creator and us, can remove the money from the pool. This protects holders from a rug pull."],
    ],
    faq: [["How long does graduation take?", "It depends on buyers. Some coins graduate in minutes, some never do."]],
  },
  "take-profit-and-stop-loss": {
    slug: "take-profit-and-stop-loss",
    short: "Take profit sells when the price rises by the amount you choose. Stop loss sells when it falls by the amount you choose. Both run automatically, even when you are offline.",
    sections: [
      ["How to set them", "Open a coin in the Terminal, choose Auto, pick a take profit like +50% and a stop loss like -20%, then confirm."],
      ["When they are available", "Automatic orders are available on coins with more than $10K of daily volume, so there is enough liquidity to fill them."],
    ],
    faq: [["Is the sell price guaranteed?", "No. In fast markets the fill can be a little different from your level."]],
  },
  "copy-trading": {
    slug: "copy-trading",
    short: "Follow a trader, get an alert when they buy, and tap Copy to buy the same coin with your preset amount. You decide on every trade.",
    sections: [
      ["Finding traders", "The Traders page ranks people by profit, win rate and followers. Look at their history before you follow."],
      ["Copying", "Set your copy amount once, for example $25. When a trader you follow buys, your alert has a Copy button."],
    ],
    faq: [["Does it buy automatically?", "No. Nothing happens until you tap Copy."], ["Do past results guarantee future profit?", "No. Every trade carries risk."]],
  },
  "spot-a-rug-pull": {
    slug: "spot-a-rug-pull",
    short: "Check the AI safety check on every coin page: who holds the most, whether the creator is locked, and how old the coin is. Many signs together are a warning.",
    sections: [
      ["Warning signs", "A few wallets holding most of the supply, a creator holding a big share with no lock, and sudden volume from the same wallets."],
      ["Good signs", "A creator lock, holders spread across many wallets, steady volume and an active community in the comments."],
    ],
    faq: [["Can AI promise a coin is safe?", "No. It summarises on-chain facts to help you decide. It is information, not financial advice."]],
  },
  "account-safety": {
    slug: "account-safety",
    short: "We never ask for your seed phrase or password, and we never send the first message. Only use arkhampad.com and turn on the strongest login your provider offers.",
    sections: [
      ["Common scams", "Fake support accounts, look-alike websites and messages promising free coins. If someone asks for your seed phrase, it is a scam."],
      ["Protect your login", "Use Google or email with two-factor authentication, and keep your own wallet's recovery phrase offline."],
    ],
    faq: [["Does ArkhamPad support ever DM first?", "No. Treat any unexpected message as a scam."]],
  },
};
