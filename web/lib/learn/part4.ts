import type { Post } from "./types";

export const part4: Post[] = [
  {
    slug: "create-a-token-on-elysium",
    cat: "create",
    title: "How to Create a Token on Elysium in 30 Seconds",
    desc: "Create a token on Elysium in about 30 seconds: what to prepare, how the launch works, the 1B supply, locked liquidity and how ArkhamPad creator fees work.",
    keywords: [
      "create a token on elysium",
      "how to launch a memecoin on elysium",
      "make a coin on elysium",
      "elysium token launchpad",
      "launch a token without coding",
      "how much does it cost to create a token on elysium",
      "what happens when you launch a coin on arkhampad",
      "memecoin starting market cap",
      "creator first buy",
      "token supply for a new memecoin",
    ],
    read: "6 min",
    short:
      "You can create a token on Elysium with ArkhamPad in about 30 seconds: enter a name, ticker and image, optionally add a description, links and a first buy, then confirm one transaction. Every coin has 1,000,000,000 tokens, all placed in a locked Uniswap v3 style pool against HYPE at a starting market cap of 60 HYPE, and the creator earns 30% of trading fees.",
    sections: [
      [
        "What does it mean to create a token on Elysium?",
        `Creating a token means deploying a new smart contract that defines a coin, and then giving it a market so people can buy and sell it. On Elysium, a Layer 2 for the Hyperliquid ecosystem built by Kinetiq, this works like on any EVM chain, because Elysium runs standard Arbitrum Nitro. If you are new to the chain, start with [what Elysium is](/learn/what-is-elysium/).

Doing this by hand takes code, testing and a separate step to add liquidity. A launchpad bundles all of it into one form and one transaction. On ArkhamPad you do not write code, choose a supply or set up a pool yourself. The launcher contract does that for you, the same way for every coin.`,
      ],
      [
        "What you need before you start",
        `The list is short:

- **An account.** Log in with email, Google or an existing wallet. Email and Google users get an embedded wallet created automatically, with no seed phrase to write down to get started. See [trading with just an email](/learn/trade-crypto-with-email-login/).
- **A little HYPE.** Elysium uses HYPE for gas, so you need some in your balance to pay the network fee. If you plan a first buy, you need HYPE for that too. You can add HYPE or USDC on the [Bridge page](/bridge/), or follow the guide to [bridge HYPE to Elysium](/learn/bridge-hype-to-elysium/).
- **A name, a ticker and an image.** Pick these before you open the form. They cannot be an afterthought, because they are what people see first on Discover.

Optional: a short description and links (website, X, Telegram). Coins with a clear story and working links are easier for buyers to trust.`,
      ],
      [
        "How to create a token on ArkhamPad, step by step",
        `1. Open [Create](/create/) and log in.
2. Enter the coin name and ticker. Keep the ticker short and easy to type.
3. Upload the image. A square image reads best in lists and on the token page.
4. Add a description and links if you have them.
5. Decide whether to make a first buy, and how much HYPE to spend on it.
6. Review and confirm. The coin is deployed, the pool is created and your first buy, if any, happens in the same transaction.

The whole process takes about 30 seconds. When it finishes, your coin has its own token page with a chart, a buy and sell box, live trades and a holders list, and it appears on Discover with the rest of the Elysium market.`,
      ],
      [
        "What happens at launch: supply, pool and starting market cap",
        `Every ArkhamPad coin follows the same rules, which makes them easy to compare:

- **Total supply:** 1,000,000,000 tokens.
- **Distribution:** the entire supply goes into the pool at launch. There is no team allocation and no presale.
- **Pool:** a Uniswap v3 style concentrated-liquidity pool paired against wrapped HYPE, with a 1% fee on every trade.
- **Starting market cap:** 60 HYPE for the whole supply.
- **Liquidity:** locked forever inside the launcher contract.

Because nobody receives tokens for free, everyone, including the creator, gets tokens the same way: by buying from the pool. The price then moves with demand. Buys push it up and sells push it down.`,
      ],
      [
        "Should you make a first buy?",
        `The first buy is optional. It lets the creator buy tokens in the same transaction that creates the coin, before anyone else can trade. Some creators like it because it shows they have something at stake. Others skip it so they hold nothing and the chart starts clean.

Things to weigh:

- A large first buy gives you a big share of supply. Traders check [top-10 holder concentration](/learn/token-holders-top-10/), and a creator holding a large share can make buyers cautious.
- Only spend what you can afford to lose. Memecoins are risky, and most new coins never get much trading.
- If you sell your first buy later, everyone can see it in the live trades list.`,
      ],
      [
        "How creators earn from their coin",
        `Every trade pays the 1% pool fee. ArkhamPad sends 30% of those trading fees to the coin's creator and keeps 70%. Fees are collected from the pool and paid out in HYPE and in the coin. In other words, the creator earns about 0.3% of the coin's trading volume.

The full breakdown has worked examples. The short version: fees depend on volume, not on price, so a coin that keeps trading keeps paying its creator.`,
      ],
      [
        "Why locked liquidity makes launches safer",
        `On many chains, the person who adds liquidity can later pull it out and leave holders with a coin nobody can sell. On ArkhamPad that is not possible. The pool position is held by the launcher contract and cannot be withdrawn by anyone, not the creator and not ArkhamPad. These coins show an "LP locked" label on Discover. Read more in [locked liquidity explained](/learn/locked-liquidity-explained/).

Locked liquidity removes one type of scam. It does not guarantee a price. Holders can still sell, and the price can still fall a long way.`,
      ],
      [
        "After you launch",
        `Launching is the easy part. Getting people to notice the coin is the real work. Share the token page to X from the token page itself, post the contract address so people do not buy copies, and be present where your community talks. For a plan covering the first day, use the [memecoin launch checklist](/learn/memecoin-launch-checklist/).`,
      ],
    ],
    faq: [
      [
        "How long does it take to create a token on Elysium?",
        "On ArkhamPad it takes about 30 seconds. You fill in a name, ticker and image, add optional details and an optional first buy, and confirm one transaction. The contract, the pool and your first buy are created together, and the coin appears on Discover with its own token page.",
      ],
      [
        "Do I need to know how to code to launch a token?",
        "No. ArkhamPad handles the token contract, the supply and the pool for you. You only provide the name, ticker, image and optional description and links. Because Elysium is a full EVM chain, developers can also deploy their own contracts with normal tools, but that is not needed to launch a coin.",
      ],
      [
        "What does it cost to create a token on ArkhamPad?",
        "You pay the Elysium network fee in HYPE, which is very low, plus whatever you choose to spend on an optional first buy. Keep a little HYPE in your balance so the transaction can go through. You can add HYPE or USDC on the Bridge page.",
      ],
      [
        "How many tokens does a new coin have?",
        "Every ArkhamPad coin has a total supply of 1,000,000,000 tokens. All of it goes into the pool at launch, with no team allocation and no presale. The starting market cap is 60 HYPE for the whole supply, and the price moves as people buy and sell.",
      ],
      [
        "Can I change my coin's name or ticker after launch?",
        "Plan as if you cannot. The name and ticker are part of the token itself and are what traders search for on Discover and see in their wallets. Check spelling and the image before you confirm, because launching a second coin to fix a typo splits attention and confuses buyers.",
      ],
    ],
    related: ["earn-creator-fees", "memecoin-launch-checklist", "locked-liquidity-explained"],
  },
  {
    slug: "earn-creator-fees",
    cat: "create",
    title: "Creator Fees: Earn 30% of Trading Fees on Your Coin",
    desc: "How memecoin creator fees work on ArkhamPad: 30% of the 1% pool fee goes to the creator, about 0.3% of volume, paid in HYPE and the coin. Examples inside.",
    keywords: [
      "memecoin creator fees",
      "how do memecoin creators make money",
      "creator rewards on trading volume",
      "how much do coin creators earn",
      "trading fee split launchpad",
      "1% pool fee explained",
      "creator fee calculation example",
      "are creator fees paid in hype",
      "do creators earn when people sell",
      "earn from your own token",
    ],
    read: "6 min",
    short:
      "On ArkhamPad, every trade of a coin pays a 1% pool fee, and 30% of those fees go to the coin's creator. That works out to about 0.3% of trading volume: for example, $100,000 of volume creates $1,000 in pool fees, of which $300 goes to the creator. Fees are paid out in HYPE and in the coin.",
    sections: [
      [
        "What are memecoin creator fees?",
        `Creator fees are a share of trading fees paid to the person who launched a coin. They reward creators for building activity around their coin instead of for selling their own tokens. On ArkhamPad, the creator is whoever launched the coin from the [Create](/create/) page, and the share is fixed for every coin: 30% of trading fees.

This matters because it changes incentives. Without fees, the only way a creator makes money is by buying early and selling later, which pushes the price down for everyone else. With fees, a creator can earn from steady trading while holding nothing at all.`,
      ],
      [
        "Where the fee comes from: the 1% pool fee",
        `Every ArkhamPad coin trades in a Uniswap v3 style concentrated-liquidity pool against wrapped HYPE. That pool charges a 1% fee on every trade, buys and sells alike. The fee is taken from the trade itself, so the trader pays it as part of the swap.

The fees are then split:

- **30%** to the coin's creator.
- **70%** to ArkhamPad.

So the creator's share equals 30% of 1%, which is **0.3% of trading volume**. This is separate from the Elysium network fee, which is paid in HYPE to the chain and is not shared with anyone on the launchpad. See [Elysium gas fees](/learn/elysium-gas-fees/) for how network costs work.`,
      ],
      [
        "How much can a creator earn? Worked examples",
        `The examples below are hypothetical. They show the math, not what any coin will do. Most coins see little volume.

- **$10,000 of volume:** pool fees are $100. The creator's 30% is **$30**.
- **$100,000 of volume:** pool fees are $1,000. The creator's 30% is **$300**.
- **$1,000,000 of volume:** pool fees are $10,000. The creator's 30% is **$3,000**.

The same math works in HYPE. If a coin trades 1,000 HYPE of volume, the pool collects 10 HYPE in fees and the creator's share is 3 HYPE.

A quick rule: multiply volume by 0.003 to estimate the creator's share. Volume counts both buys and sells. A trader who buys 50 HYPE worth and later sells 50 HYPE worth adds 100 HYPE of volume, which pays 1 HYPE in pool fees and 0.3 HYPE to the creator.`,
      ],
      [
        "Why creator fees follow volume, not price",
        `A common mistake is to think a higher market cap means higher fees. It does not, at least not directly. Fees are a percentage of what is traded, so a coin that stays at a modest market cap but trades actively can pay its creator more than a coin that spikes once and goes quiet.

If you want to understand the difference between those numbers, read [market cap vs price](/learn/market-cap-vs-price/). For creators, the takeaway is simple: activity over time is what pays. One busy hour after launch is worth less than a coin people keep trading for weeks.`,
      ],
      [
        "Are creator fees paid in HYPE or in the coin?",
        `Both. Fees are collected from the pool and paid out in HYPE and in the coin. In a Uniswap v3 style pool, the fee is charged in the token the trader puts in. That generally means fees on buys accrue in HYPE, and fees on sells accrue in the coin.

What this means for you:

- The HYPE part is a fixed amount of HYPE. Its dollar value moves with the HYPE price.
- The coin part is worth whatever your coin is worth. If you sell those tokens, that sale goes through the pool like any other trade and affects the price.
- Some creators keep the coin portion to show commitment. That choice is yours, and buyers can see creator wallet activity on the token page.`,
      ],
      [
        "Moving your earnings",
        `Creator fees are paid on Elysium, so you can use the HYPE to trade other coins right away. Keep a little HYPE for gas, since every transaction on Elysium pays its network fee in HYPE. To learn what else HYPE does on the chain, see [HYPE on Elysium](/learn/hype-on-elysium/).

If you want to move HYPE back to HyperEVM, the official bridge takes about 5.5 days because withdrawals finalize after a challenge period. The reasons are explained in [Elysium withdrawal time](/learn/elysium-withdrawal-time/). A faster exit route is being worked on, but there is no date yet.`,
      ],
      [
        "How to grow fees without hurting holders",
        `Fees reward creators who keep their coin alive. Practical habits that help:

- Keep links and the description accurate, and post the contract address so buyers do not get copies.
- Share updates, not price promises. Promising returns damages trust and can cause legal problems.
- Avoid holding a huge share of supply. A concentrated holder list scares traders away.
- Be visible. Coins with an active creator tend to keep conversations, and trading, going.

Fees are never guaranteed. A coin with no trading pays nothing. To get started, see [how to create a token on Elysium](/learn/create-a-token-on-elysium/).`,
      ],
    ],
    faq: [
      [
        "How much do memecoin creators earn on ArkhamPad?",
        "Creators get 30% of the 1% pool fee, which equals about 0.3% of their coin's trading volume. As a hypothetical example, $100,000 of volume produces $1,000 in pool fees and $300 for the creator. Earnings depend entirely on how much the coin trades, and many coins trade very little.",
      ],
      [
        "Do creators earn fees when people sell?",
        "Yes. The 1% pool fee applies to every trade, buys and sells. Both count toward volume, and the creator receives 30% of the fees from each. In a Uniswap v3 style pool the fee is charged in the token being sold into the pool, so sell fees generally accrue in the coin.",
      ],
      [
        "Do I need to hold my own coin to earn creator fees?",
        "No. Creator fees come from trading volume, not from the creator's holdings. You can launch without a first buy and still earn 30% of trading fees. Holding some tokens is a personal choice, and buyers often look at how much the creator holds before deciding.",
      ],
      [
        "Who gets the other 70% of trading fees?",
        "The other 70% of the pool fees goes to ArkhamPad. The split is the same for every coin launched on ArkhamPad. The Elysium network fee, paid in HYPE for each transaction, is separate and goes to the chain, not to the creator or ArkhamPad.",
      ],
      [
        "Is the 0.5% router fee shared with creators?",
        "No. The 0.5% router fee applies only when you trade tokens launched elsewhere through the ArkhamPad router. ArkhamPad coins pay no router fee at all. Creator fees come only from the 1% pool fee charged on trades of ArkhamPad coins, and the creator receives 30% of that pool fee.",
      ],
    ],
    related: ["create-a-token-on-elysium", "memecoin-launch-checklist", "market-cap-vs-price"],
  },
  {
    slug: "locked-liquidity-explained",
    cat: "create",
    title: "Locked Liquidity Explained: Why It Matters",
    desc: "What is locked liquidity? How liquidity pools work, why unlocked LP enables rug pulls, how ArkhamPad locks liquidity forever, and what risks still remain.",
    keywords: [
      "what is locked liquidity",
      "locked liquidity meaning crypto",
      "what does lp locked mean",
      "liquidity pool explained simply",
      "can developers remove liquidity",
      "locked vs burned liquidity",
      "is locked liquidity safe",
      "how to check if liquidity is locked",
      "liquidity rug pull",
      "permanently locked liquidity",
    ],
    read: "6 min",
    short:
      "Locked liquidity means the tokens and HYPE in a coin's trading pool cannot be withdrawn by the person who added them. It prevents a liquidity rug pull, where the creator removes the pool and leaves holders unable to sell. On ArkhamPad, every coin's pool position is held by the launcher contract forever and cannot be withdrawn by anyone, not the creator and not ArkhamPad.",
    sections: [
      [
        "What is liquidity in crypto?",
        `Liquidity is how easily you can buy or sell something without moving its price much. For a new token, liquidity usually lives in a liquidity pool: a smart contract that holds two assets, such as a memecoin and wrapped HYPE, and trades them against each other using a formula. When you buy, you put HYPE in and take tokens out. When you sell, you do the reverse.

The pool is what makes trading possible at all. No pool, no market. A deeper pool also means smaller price moves per trade, which is why [slippage](/learn/slippage-explained/) is lower on coins with more liquidity.`,
      ],
      [
        "What is an LP position?",
        `Whoever adds assets to a pool receives an LP position, short for liquidity provider position. In Uniswap v3 style pools this is usually an NFT that records how much was deposited and in which price range. The holder of that position can normally withdraw the assets at any time and collect the fees the position has earned.

That control is the key point. If one wallet owns the entire LP position of a new coin, that wallet effectively owns the market for that coin.`,
      ],
      [
        "How a liquidity rug pull works",
        `A liquidity rug pull is the classic memecoin scam:

1. Someone launches a token and adds it to a pool with some HYPE.
2. Buyers arrive and add more HYPE to the pool by buying.
3. The creator withdraws the LP position, taking out the HYPE and the tokens.
4. The pool is now empty or nearly empty. Holders still have tokens, but there is nothing to sell them into.

It can happen in seconds and cannot be undone. This is why experienced traders check liquidity before anything else. For the full list of warning signs, see [how to spot a rug pull](/learn/spot-a-rug-pull/).`,
      ],
      [
        "What does LP locked mean?",
        `"LP locked" means the LP position cannot be withdrawn by its creator, either for a set time or permanently. There are a few common ways this is done:

- **Time lock:** the position goes into a locking contract that releases it after a date. Safe until that date, then not.
- **Burned:** the position is sent to an address nobody controls. Permanent, but the fees it earns are usually lost too.
- **Held by a contract:** the position stays inside a contract that has no function to withdraw it, while still collecting trading fees.

The details matter. A lock that ends next week is very different from a permanent one, so always check which kind you are looking at.`,
      ],
      [
        "How ArkhamPad locks liquidity",
        `Every coin created on ArkhamPad uses the third approach. When a coin launches, its entire 1,000,000,000 token supply goes into a Uniswap v3 style pool against wrapped HYPE. The pool position is held by the launcher contract and cannot be withdrawn by anyone, not the creator and not ArkhamPad. There is no unlock date.

The position still collects the 1% pool fee on every trade. Those fees are collected from the pool and split 30% to the creator and 70% to ArkhamPad, paid in HYPE and in the coin. So the creator has a reason to keep the coin active, but no way to remove the market.

On Discover, ArkhamPad coins show an **LP locked** label, so you can tell them apart from tokens launched elsewhere at a glance.`,
      ],
      [
        "What locked liquidity does not protect you from",
        `Locked liquidity removes one specific risk. It is not a safety guarantee. Other ways to lose money remain:

- **Holders selling.** Anyone who bought can sell. If large holders sell, the price drops, even though the pool is still there. Check [top-10 holder concentration](/learn/token-holders-top-10/) before buying.
- **Demand fading.** Most memecoins lose interest quickly. A locked pool still lets you sell, but maybe at a much lower price.
- **Copycats.** Someone can launch a coin with the same name. Always check the contract address.
- **Tokens from elsewhere.** On Discover you can see every HYPE-paired token on Elysium, from every launchpad. Only ArkhamPad coins carry the LP locked label. Other tokens may have different rules, and some charge transfer taxes that stop them from being sold through the router.

Memecoins are high risk. Only use money you can afford to lose. For a wider overview, read the [Elysium memecoins guide](/learn/elysium-memecoins-guide/).`,
      ],
      [
        "How to check liquidity before you buy",
        `A quick routine before every buy:

1. Look for the LP locked label on Discover, or check the pool type on the token page.
2. Look at the holders list and the share held by the top 10 wallets.
3. Read the live trades list. A steady mix of buyers and sellers is healthier than a few big wallets.
4. Check the quote before you confirm. If a small buy moves the price a lot, liquidity is thin.

When you are ready, the steps to trade are in [how to buy Elysium tokens](/learn/how-to-buy-elysium-tokens/).`,
      ],
    ],
    faq: [
      [
        "What is locked liquidity in simple terms?",
        "Locked liquidity means the money and tokens in a coin's trading pool cannot be taken out by the person who put them there. Because the pool stays in place, holders can always sell into it. It protects against the creator emptying the pool, which is the most common memecoin scam.",
      ],
      [
        "Can the creator of an ArkhamPad coin remove liquidity?",
        "No. The pool position of every ArkhamPad coin is held by the launcher contract and cannot be withdrawn by anyone, including the creator and ArkhamPad. The lock has no end date, so a liquidity rug pull is not possible on ArkhamPad coins.",
      ],
      [
        "Does locked liquidity mean a token is safe?",
        "No. It removes the risk of the pool being withdrawn, but the price can still fall sharply if holders sell or interest fades. Check holder concentration, trading activity and the contract address, and treat every memecoin as high risk, even one with a permanent lock.",
      ],
      [
        "What is the difference between locked and burned liquidity?",
        "Burned liquidity is sent to an address nobody controls, so it is gone for good, along with any fees it earns. Locked liquidity is held by a contract that prevents withdrawal, either until a date or forever. A permanent contract lock, like ArkhamPad's, keeps the pool in place while still collecting trading fees.",
      ],
      [
        "How do I know if a token on Elysium has locked liquidity?",
        "On ArkhamPad's Discover page, coins launched on ArkhamPad show an LP locked label. Tokens launched elsewhere do not carry that label, so you need to check their own terms. The token page also shows the pool type, creator and contract address, so you can confirm you are looking at the right coin before you buy.",
      ],
    ],
    related: ["spot-a-rug-pull", "token-holders-top-10", "create-a-token-on-elysium"],
  },
  {
    slug: "memecoin-launch-checklist",
    cat: "create",
    title: "Memecoin Launch Checklist: Your First 24 Hours",
    desc: "A memecoin launch checklist for your first 24 hours: what to prepare, launch steps, the first hour, sharing the contract address and mistakes to avoid.",
    keywords: [
      "memecoin launch checklist",
      "how to launch a memecoin successfully",
      "what to do after launching a token",
      "memecoin launch plan",
      "first 24 hours after token launch",
      "how to promote a new memecoin",
      "memecoin launch mistakes",
      "how to get holders for a new coin",
      "prepare a memecoin launch",
      "share token contract address",
    ],
    read: "7 min",
    short:
      "A good memecoin launch is mostly preparation: have the name, ticker, image, description, links and a little HYPE ready before you open the create form. After launch, share the token page and contract address right away, stay active in your community for the first hours, and avoid price promises. Launching on ArkhamPad takes about 30 seconds, with liquidity locked and 30% of trading fees going to the creator.",
    sections: [
      [
        "Before launch: prepare the basics",
        `Most failed launches fail before the coin exists. Prepare these first:

- **Name and ticker.** Short, easy to spell and easy to search. Check Discover for existing coins with the same name so yours is not mistaken for a copy.
- **Image.** Square, clear at small sizes, recognisable in a list of hundreds of tokens.
- **One-sentence idea.** What is the coin about? If you cannot say it in one line, buyers will not repeat it.
- **Description and links.** An X account and a community chat set up before launch, so the links work on day one.
- **A launch post.** Written in advance, with a space for the contract address.

None of this guarantees interest. It just removes the reasons people skip a coin.`,
      ],
      [
        "Before launch: fund your wallet",
        `You need HYPE on Elysium to pay the network fee, and more if you plan a first buy. If you are starting from USDC on Base, you can deposit it on the [Bridge page](/bridge/) and it arrives as HYPE on Elysium. The steps are in [buy Elysium tokens with USDC](/learn/buy-elysium-tokens-with-usdc/).

Decide your first buy amount in advance, not in the moment. A large first buy means you hold a large share of supply, and traders read that as risk. Keep a small amount of HYPE aside for gas after launch, because every transaction on Elysium pays its network fee in HYPE.`,
      ],
      [
        "Launch: the 30-second part",
        `On ArkhamPad the launch itself is quick:

1. Open [Create](/create/).
2. Enter name, ticker, image, description and links.
3. Set your optional first buy.
4. Confirm the transaction.

Your coin goes live with 1,000,000,000 tokens in a Uniswap v3 style pool against HYPE, a starting market cap of 60 HYPE, and liquidity locked forever. The full walkthrough is in [how to create a token on Elysium](/learn/create-a-token-on-elysium/).

Before confirming, check spelling one more time. A typo in the ticker is permanent.`,
      ],
      [
        "The first hour: what to do right after launch",
        `The first hour sets the tone. A practical order:

1. Open your token page and copy the contract address.
2. Post your launch message on X with the token page link and the contract address. You can share to X directly from the token page.
3. Pin the contract address in your community chat.
4. Watch the live trades list and answer questions quickly.
5. Do not panic at early sells. Some buyers take quick profits. That is normal.

Posting the contract address early matters more than it seems. Copies of new coins can appear quickly, and buyers who cannot find the official address may buy the wrong one.`,
      ],
      [
        "Hours 2 to 24: keep the coin active",
        `After the first rush, attention fades fast. What helps in the rest of the day:

- **Post updates, not promises.** Share milestones like new holders, community posts and memes. Never promise price targets or profits.
- **Read the chart with your community.** If people ask what a big candle means, explain it plainly. Our guide to [reading a memecoin chart](/learn/how-to-read-a-memecoin-chart/) is a good link to share.
- **Watch holder concentration.** If a few wallets hold a large share, say so openly rather than hiding it. Traders check [top-10 holders](/learn/token-holders-top-10/) anyway.
- **Stay reachable.** A creator who disappears in the first day is the fastest way to lose a community.`,
      ],
      [
        "How creator fees fit into your plan",
        `On ArkhamPad, creators get 30% of the 1% pool fee, which is about 0.3% of trading volume. As a hypothetical example, $100,000 of volume creates $1,000 in pool fees and $300 for the creator. Fees come from activity, so a coin that keeps trading keeps paying, even if you never sell a token.

That changes the goal of the first 24 hours. The aim is not one big spike. It is a coin people want to keep trading and talking about. More on the math in [creator fees explained](/learn/earn-creator-fees/).`,
      ],
      [
        "Common memecoin launch mistakes",
        `Avoid these:

- Launching without working links, then adding them hours later.
- Spending most of your budget on the first buy and having nothing left for gas.
- Selling a large first buy in the first hour. Everyone sees it in live trades.
- Copying another coin's name or image. It confuses buyers and damages trust.
- Promising returns or listings you cannot deliver.
- Launching at a time when you cannot be online for the next few hours.

If you are planning around the chain itself, check [what traders should know about the Elysium mainnet launch](/learn/elysium-mainnet-launch/).`,
      ],
      [
        "A realistic view",
        `Most memecoins do not take off, however good the preparation. That is the nature of the market. Treat a launch as an experiment, spend only what you can afford to lose, and judge success by whether a community forms, not by one day of price action.`,
      ],
    ],
    faq: [
      [
        "What should I prepare before launching a memecoin?",
        "Have the name, ticker, square image, a one-line idea, a short description and working links ready. Set up your X account and community chat first. Fund your wallet with HYPE for gas and any first buy, and write your launch post in advance with a space for the contract address.",
      ],
      [
        "What should I do right after launching my token?",
        "Copy the contract address from the token page, post it on X with the token link, and pin it in your community chat. Then stay online, answer questions and watch the live trades list. Posting the official address early helps buyers avoid copycat coins.",
      ],
      [
        "How much should my first buy be?",
        "There is no right number. Spend only what you can afford to lose, and remember that a large first buy gives you a large share of supply, which many traders treat as a warning sign. Some creators skip the first buy entirely and rely on creator fees instead.",
      ],
      [
        "How do I get holders for a new memecoin?",
        "There is no shortcut. Clear branding, working links, an active creator and regular updates help people find the coin and stay. Sharing the token page and contract address widely, and replying to people who ask questions, does more than any single post.",
      ],
      [
        "Can my memecoin launch fail even if I do everything right?",
        "Yes. Most memecoins never get much trading, regardless of preparation. A checklist removes avoidable mistakes, but it cannot create demand or interest. Treat a launch as a risky experiment, judge it by whether a community forms, and never spend money you cannot afford to lose.",
      ],
    ],
    related: ["create-a-token-on-elysium", "earn-creator-fees", "how-to-read-a-memecoin-chart"],
  },
  {
    slug: "spot-a-rug-pull",
    cat: "safety",
    title: "How to Spot a Rug Pull on Elysium: 9 Red Flags",
    desc: "How to spot a rug pull on Elysium: 9 red flags to check before you buy, from unlocked liquidity and top-10 holders to sell taxes, copycats and thin pools.",
    keywords: [
      "how to spot a rug pull",
      "rug pull red flags",
      "what is a rug pull in crypto",
      "how to avoid memecoin scams",
      "soft rug vs hard rug",
      "can't sell token transfer tax",
      "check token before buying",
      "elysium token safety",
      "fake token contract address",
      "signs a memecoin is a scam",
    ],
    read: "7 min",
    short:
      "A rug pull is when the people behind a token take buyers' money and leave the token worthless, usually by removing liquidity or dumping a large hidden supply. To spot one, check whether liquidity is locked, how much the top 10 holders own, whether you can actually sell, and whether the contract address is the official one. On ArkhamPad, coins launched there show an LP locked label, so a liquidity rug pull is not possible on them.",
    sections: [
      [
        "What is a rug pull in crypto?",
        `A rug pull is a scam where a token's creators or insiders pull value out of a project and leave buyers holding something they cannot sell for much. There are two broad types:

- **Hard rug:** the creator removes the liquidity pool, or uses hidden contract powers, so the token becomes unsellable or worthless in one move.
- **Soft rug:** insiders quietly hold a large share of supply, build hype, and sell into buyers over hours or days until the price collapses.

Elysium is a normal EVM chain, the same as other networks in that respect. See [Elysium vs HyperEVM](/learn/elysium-vs-hyperevm/) for how the two chains differ. Any open chain where anyone can launch a token also has scams. The checks below work on any token you see on Discover.`,
      ],
      [
        "Red flags 1 to 3: liquidity and ownership",
        `**1. Liquidity is not locked.** If one wallet can withdraw the pool, it can empty it. This is the most direct rug. On ArkhamPad, coins launched there show an LP locked label on Discover, because the pool position is held by the launcher contract and cannot be withdrawn by anyone. Tokens from other launchpads may follow different rules. Learn more in [locked liquidity explained](/learn/locked-liquidity-explained/).

**2. A few wallets hold most of the supply.** If the top 10 holders own a large share, they can sell into you. Open the holders list on the token page and check the top-10 share shown on Discover. Remember that the pool itself often appears as a holder. Our guide to [top-10 holder concentration](/learn/token-holders-top-10/) explains how to read it.

**3. The creator holds a big chunk.** Check the creator address on the token page and look for it in the holders list. A creator with a large bag and no visible community is a classic soft rug setup.`,
      ],
      [
        "Red flags 4 to 6: the contract and selling",
        `**4. You may not be able to sell.** Some tokens charge their own transfer tax, or block sells entirely. On ArkhamPad, tokens that charge a transfer tax may not be sellable through the router. Before buying a large amount, look at the live trades list for successful sells by other wallets. A chart with only buys is a warning sign.

**5. It is a copy.** Scammers launch tokens with the same name and image as a coin that is getting attention. Always check the contract address against the one the real project posted. You can search Discover by address, not just by name.

**6. The pool is thin.** If a small buy moves the price a lot, liquidity is low and anyone selling will crash it. The quote and minimum received before you trade tell you a lot. Learn how in [slippage explained](/learn/slippage-explained/).`,
      ],
      [
        "Red flags 7 to 9: behaviour and promises",
        `**7. Volume comes from a handful of wallets.** Look at the live trades list. If the same few addresses trade back and forth, the activity may be staged to look popular. Buys and sells counts on Discover help here too.

**8. The chart only goes one way, then suddenly not.** A perfect straight climb with no sells, followed by one giant red candle, is often an insider exit. Our guide to [reading a memecoin chart](/learn/how-to-read-a-memecoin-chart/) shows how to read candles and volume together.

**9. Promises and pressure.** Guaranteed returns, "last chance to buy", fake partnerships, or claims of listings that cannot be checked. Real projects do not need to rush you. Anyone promising profit on a memecoin is either mistaken or lying.`,
      ],
      [
        "A two-minute safety routine before you buy",
        `1. Find the token on Discover and confirm the contract address.
2. Check for the LP locked label, or the pool type on the token page.
3. Check the top-10 holder share and the creator's holdings.
4. Scroll the live trades list for real sells from different wallets.
5. Look at the age of the token and its chart history.
6. Read the quote. If a small trade has a big price impact, size down.
7. Buy a small amount first if you are unsure, and confirm you can sell.

None of this makes a memecoin safe. It removes the most obvious traps.`,
      ],
      [
        "What ArkhamPad coins rule out, and what they do not",
        `Coins launched on ArkhamPad follow fixed rules: 1,000,000,000 tokens, all placed in the pool at launch, no team allocation, no presale, and liquidity locked forever. That rules out a liquidity rug pull and hidden insider allocations at launch.

It does not rule out a soft rug. The creator can make a first buy, and early buyers can accumulate a large share and sell later. Price can fall fast for many reasons. Check holders and trades on every coin, including ArkhamPad coins. For a broader view of the market, read the [Elysium memecoins guide](/learn/elysium-memecoins-guide/).`,
      ],
      [
        "If you think you have been rugged",
        `Act calmly. Check whether you can still sell part of your position, and use a higher slippage setting only if you understand the risk of a worse price. Do not follow links from strangers offering to recover funds. Those offers are almost always a second scam. Share the contract address with your community so others can avoid it.`,
      ],
    ],
    faq: [
      [
        "What is a rug pull in crypto?",
        "A rug pull is a scam where a token's creators or insiders take buyers' money and leave the token worthless. It usually happens by removing the liquidity pool, blocking sells, or dumping a large hidden supply. It is one of the most common risks with new memecoins.",
      ],
      [
        "Can ArkhamPad coins be rug pulled?",
        "A liquidity rug pull is not possible on ArkhamPad coins, because the pool position is held by the launcher contract and cannot be withdrawn by anyone. There is also no team allocation or presale. The price can still drop sharply if holders sell, so a soft rug remains possible.",
      ],
      [
        "Why can't I sell a token I bought?",
        "The token may charge its own transfer tax or restrict sells. On ArkhamPad, tokens with a transfer tax may not be sellable through the router. It can also be a slippage issue in a fast-moving or thin market. Check the live trades list for other wallets selling successfully before buying.",
      ],
      [
        "How do I check if a token is a copy?",
        "Compare the contract address with the one posted by the real project on its official channels. Names, tickers and images can be copied, but the contract address cannot. On ArkhamPad you can search Discover by address to find the exact token.",
      ],
      [
        "What is the difference between a soft rug and a hard rug?",
        "A hard rug is a single move that makes a token unsellable or worthless, like removing liquidity. A soft rug is slower: insiders holding a large share sell into buyers over time until the price collapses. Locked liquidity prevents hard rugs of the first kind but not soft rugs.",
      ],
    ],
    related: ["locked-liquidity-explained", "token-holders-top-10", "elysium-memecoins-guide"],
  },
];
