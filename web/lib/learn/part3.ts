import type { Post } from "./types";

export const part3: Post[] = [
  {
    slug: "elysium-memecoins-guide",
    cat: "trade",
    title: "Elysium Memecoins: The Complete Guide",
    desc: "Elysium memecoins explained: where to find every HYPE-paired token, how ArkhamPad coins work, how to buy one and what to check before you trade.",
    keywords: [
      "elysium memecoins",
      "elysium meme tokens",
      "how to buy memecoins on elysium",
      "where to find elysium memecoins",
      "hype paired tokens on elysium",
      "are elysium memecoins safe",
      "memecoins on a hyperliquid layer 2",
      "elysium launchpad coins",
      "what does lp locked mean",
      "elysium memecoin risks",
      "launch a memecoin on elysium",
    ],
    read: "6 min",
    short:
      "Elysium memecoins are community tokens launched on Elysium, Kinetiq's Layer 2 for the Hyperliquid ecosystem, and traded against HYPE. You can find every HYPE-paired Elysium token on ArkhamPad's Discover page and buy or sell it from one token page. Memecoins are highly speculative, so only trade money you can afford to lose.",
    sections: [
      [
        "What are Elysium memecoins?",
        "A memecoin is a token whose value comes mostly from attention, community and culture rather than from cash flows or a product. Most start as a joke, a mascot or a running theme on social media. Their prices can rise or fall by large amounts in minutes.\n\nElysium memecoins are memecoins that live on [Elysium](/learn/what-is-elysium/), a Layer 2 network for the Hyperliquid ecosystem built by Kinetiq. Almost all of them trade in pools paired with HYPE, Hyperliquid's native token. You buy them with HYPE and receive HYPE when you sell.\n\nBecause Elysium is a full EVM chain, these are standard EVM tokens that work with normal EVM wallets and tools.",
      ],
      [
        "Why are memecoins launching on Elysium?",
        "Memecoin trading creates a lot of small, fast transactions. Hyperliquid deliberately keeps HyperEVM blocks small, so busy trading apps compete for limited space there. Elysium was built to give trading apps, launchpads and AMMs (automated market makers, the pools that let you swap tokens without an order book) much more block space.\n\nA few design choices matter for traders:\n\n- **Fast blocks.** Elysium targets blocks of roughly 100 to 200 milliseconds, so trades confirm quickly.\n- **HYPE for gas.** Network fees are paid in HYPE bridged 1:1 from HyperEVM. There is no separate gas token to buy.\n- **Low fees.** Gas costs are very low, which matters when you make many small trades.\n- **Settlement to HyperEVM.** Elysium is an Arbitrum Orbit chain that settles to HyperEVM, so it stays connected to the wider Hyperliquid ecosystem.\n\nKinetiq has announced November 9, 2026 as the public mainnet launch date. For more on how HYPE moves between the two networks, see [HYPE on Elysium](/learn/hype-on-elysium/).",
      ],
      [
        "Where can you find every Elysium memecoin?",
        "New tokens appear on Elysium from several launchpads. ArkhamPad's [Discover page](/) lists every HYPE-paired token on Elysium from every launchpad in one place. That is hundreds of tokens, not only those launched on ArkhamPad.\n\nFor each token, Discover shows:\n\n- Market cap and 24-hour price change\n- Trading volume and the number of buys and sells\n- Holder count and the share of supply held by the top 10 wallets\n- Live trades as they happen\n\nYou can search by name or paste a contract address. Searching by address is the safest way to find a specific coin, because anyone can create a token with the same name or ticker as a popular one.",
      ],
      [
        "How does a coin launched on ArkhamPad work?",
        "Coins created on ArkhamPad follow one fixed setup, which makes them easier to compare:\n\n- **Supply:** 1,000,000,000 tokens per coin.\n- **Fair start:** the entire supply goes into the trading pool at launch. There is no team allocation and no presale. The creator may make an optional first buy in the same transaction, paid through the pool like any other buy.\n- **Starting market cap:** 60 HYPE for the whole supply.\n- **Pool:** a Uniswap v3 style concentrated-liquidity pool against wrapped HYPE, with a 1% pool fee on every trade.\n- **Fees:** 30% of trading fees go to the coin's creator and 70% to ArkhamPad.\n- **Locked liquidity:** the pool position is held by the launcher contract and cannot be withdrawn by anyone, including the creator and ArkhamPad.\n\nA common way people lose money on memecoins is a liquidity rug pull, where the creator removes the pool's funds and leaves holders with tokens they cannot sell. That is not possible on ArkhamPad coins, which carry an LP locked label on Discover. [Locked liquidity explained](/learn/locked-liquidity-explained/) covers how this works. Locked liquidity does not stop the price from falling, though. Holders can still sell, and the price can still drop sharply.",
      ],
      [
        "How do you buy an Elysium memecoin?",
        "You can trade any Elysium token from its ArkhamPad token page, including tokens launched elsewhere.\n\n1. Log in with email, Google or an existing wallet. Email and Google users get an embedded wallet created automatically.\n2. Add funds. Bridge HYPE from HyperEVM on the [Bridge page](/bridge/), or send USDC from Base, which arrives as HYPE on Elysium.\n3. Open the token from Discover and check its contract address.\n4. Enter an amount of HYPE, review the quote and the minimum you will receive, and confirm.\n\nKeep a little HYPE in your balance for network fees. Tokens launched on other launchpads carry a 0.5% router fee; ArkhamPad coins pay no router fee. The full walkthrough is in [how to buy and sell Elysium tokens](/learn/how-to-buy-elysium-tokens/).",
      ],
      [
        "What should you check before buying a memecoin?",
        "A minute of checking can save you from the most common mistakes:\n\n- **Contract address.** Confirm it matches the one the project shares. Copycat tokens are common.\n- **Liquidity status.** Look for the LP locked label, or find out how the pool is held for tokens from elsewhere.\n- **Top-10 holder share.** If a handful of wallets hold most of the supply, a few sellers can crash the price.\n- **Buys versus sells and volume.** Real activity from many traders is a better sign than a few large trades.\n- **Age.** Very new tokens move fastest and carry the most risk.\n- **Transfer tax.** Some tokens charge their own tax on transfers, and these may not be sellable through the router.\n\nFor a longer list of warning signs, read [how to spot a rug pull](/learn/spot-a-rug-pull/).",
      ],
      [
        "What are the risks of Elysium memecoins?",
        "Memecoins are among the riskiest assets in crypto. Most lose most of their value, and many go to zero. Treat any money you put into memecoins as money you are prepared to lose entirely.\n\nThere are also risks specific to a new network. Elysium mainnet is new. At launch, one sequencer orders transactions and validators are permissioned, with permissionless fraud proofs planned for later. Withdrawals through the official bridge back to HyperEVM take about 5.5 days, so you cannot move funds out instantly. Plan for that before you deposit.\n\nNothing on ArkhamPad is financial advice. A locked pool, a high holder count or a rising chart does not mean a coin will go up.",
      ],
      [
        "Can you launch your own Elysium memecoin?",
        "Yes. On ArkhamPad you can [create a coin](/create/) with a name, ticker, image and an optional description and links. It takes about 30 seconds, and you can add an optional first buy in the same transaction. As the creator, you earn 30% of the trading fees your coin generates, paid out in HYPE and in the coin. Step-by-step instructions are in [how to create a token on Elysium](/learn/create-a-token-on-elysium/).",
      ],
    ],
    faq: [
      [
        "Do I need HYPE to buy Elysium memecoins?",
        "Yes, in practice. Elysium memecoins trade in pools paired with HYPE, and network fees on Elysium are paid in HYPE. On ArkhamPad you can bridge HYPE from HyperEVM, or send USDC from Base, which is converted to HYPE on the way in. Keep a small amount of HYPE aside for gas so you can still sell later.",
      ],
      [
        "Is there an Elysium token or airdrop?",
        "There is no Elysium token and no official points program at this time. Be careful with anyone claiming to sell or airdrop an Elysium token. Half of Elysium sequencer fees are earmarked for open-market buybacks of KNTQ, the Kinetiq token, but that is separate from any memecoin you trade on the network.",
      ],
      [
        "Can I trade Elysium tokens that were not launched on ArkhamPad?",
        "Yes. ArkhamPad's Discover page lists every HYPE-paired token on Elysium from every launchpad, and you can trade any of them from its token page through the ArkhamPad router. Those trades carry a 0.5% router fee. Tokens that charge their own transfer tax may not be sellable through the router, so check before you buy.",
      ],
      [
        "What does LP locked mean on an Elysium memecoin?",
        "It means the coin's trading pool cannot be withdrawn. On ArkhamPad coins, the pool position is held by the launcher contract forever, so neither the creator nor ArkhamPad can pull the liquidity. This rules out a liquidity rug pull. It does not protect the price, which can still fall if holders sell.",
      ],
      [
        "How fast are trades on Elysium?",
        "Elysium is designed for very fast blocks, with a target of roughly 100 to 200 milliseconds, and high throughput. In practice, trades usually confirm quickly. Deposits from HyperEVM arrive within seconds to a few minutes, while withdrawals through the official bridge back to HyperEVM take about 5.5 days.",
      ],
    ],
    related: ["how-to-buy-elysium-tokens", "spot-a-rug-pull", "create-a-token-on-elysium"],
  },
  {
    slug: "how-to-read-a-memecoin-chart",
    cat: "trade",
    title: "How to Read a Memecoin Chart: Candles, Volume, Market Cap",
    desc: "How to read a memecoin chart: what candles and wicks mean, which timeframe to use, market cap vs price view, and what the chart cannot tell you.",
    keywords: [
      "how to read a memecoin chart",
      "how to read crypto candlestick charts",
      "what do candle wicks mean",
      "green and red candles meaning",
      "best timeframe for memecoins",
      "market cap chart vs price chart",
      "memecoin volume explained",
      "buys vs sells crypto",
      "memecoin chart patterns",
      "what does a long upper wick mean",
      "how to read a token chart on elysium",
    ],
    read: "6 min",
    short:
      "A memecoin chart shows how a token's price or market cap moved over time, using candles that record the open, high, low and close for each period. Read it together with volume, buys and sells, and holder data, because a chart alone cannot tell you whether a move came from many traders or a few wallets.",
    sections: [
      [
        "What does each candle on a memecoin chart show?",
        "A candlestick chart splits time into equal periods. Each candle summarises trading in one period with four values:\n\n- **Open:** the price at the start of the period.\n- **Close:** the price at the end of the period.\n- **High:** the highest price traded during the period.\n- **Low:** the lowest price traded during the period.\n\nThe thick part of the candle, called the body, runs from the open to the close. The thin lines above and below, called wicks or shadows, reach the high and the low. On most charts a green candle means the close was above the open, and a red candle means it closed lower.\n\nWicks carry useful information. A long upper wick means buyers pushed the price up during the period, but sellers pushed it back down before the close. A long lower wick means the opposite: the price dropped, then buyers stepped in. On memecoins, long wicks are common because a single large trade can move the price a lot in a pool with modest liquidity.",
      ],
      [
        "Which timeframe should you use on a memecoin chart?",
        "The timeframe sets how much time each candle covers. ArkhamPad token pages offer 1-minute, 5-minute, 15-minute, 1-hour and 4-hour candles.\n\n- **1m and 5m** show every burst of activity. They are useful in the first hours after a coin launches, when the whole history may be only a few dozen candles long.\n- **15m and 1h** smooth out noise and make the overall direction easier to see over a day or two.\n- **4h** works best for coins that have traded for several days or longer.\n\nA useful habit is to check two timeframes. A sharp green run on the 1-minute chart may look very different on the 1-hour chart, where it might be a small bounce inside a longer decline. On a new network, most tokens also have short histories. In the first weeks after the [Elysium mainnet launch](/learn/elysium-mainnet-launch/), longer timeframes may show only a handful of candles.",
      ],
      [
        "Should you view the chart in market cap or price?",
        "ArkhamPad charts can show either market cap or price. The shape of the chart is the same in both views, because for a fixed supply, market cap is simply price multiplied by the number of tokens. Only the numbers on the axis change.\n\nMemecoin prices are often tiny. A coin launched on ArkhamPad starts at a market cap of 60 HYPE for a supply of 1,000,000,000 tokens, which works out to a starting price of 0.00000006 HYPE per token. Numbers with that many zeros are hard to read and easy to misjudge.\n\nMarket cap is usually easier. Saying a coin went from 60 HYPE to 600 HYPE in market cap is clearer than comparing two prices with seven zeros after the decimal point. It also lets you compare coins with different supplies fairly. The difference is explained in detail in [market cap vs price](/learn/market-cap-vs-price/).",
      ],
      [
        "How do you read volume, buys and sells?",
        "Price shows where a token traded. Volume shows how much traded. A price move on high volume, with many separate trades, says more than the same move on a few trades.\n\nOn ArkhamPad, the [Discover page](/) shows each token's 24-hour volume and the number of buys and sells, and every token page has a live trades list. Use them together with the chart:\n\n- **Rising price, rising volume, many buys:** demand is broad. That does not guarantee it continues.\n- **Rising price on a few large buys:** one or two wallets may be driving the move, and they can sell just as quickly.\n- **Falling price with sells outnumbering buys:** holders are taking profit or leaving.\n- **Flat price, very low volume:** interest has faded, and even a small sell may move the price.\n\nIf the live trades list shows most volume coming from a few large trades, the chart reflects those traders more than the wider market.",
      ],
      [
        "What do common memecoin chart patterns mean?",
        "Charts do not predict the future, but some shapes appear again and again on new tokens. Recognising them explains what already happened.\n\n- **Launch spike:** a run of tall green candles right after launch, often followed by a sharp pullback as early buyers sell.\n- **Long upper wicks near a top:** buyers keep pushing higher, but sellers take the price back each time.\n- **Staircase:** a series of higher lows, where each dip is bought at a higher level than the last.\n- **Slow bleed:** many small red candles on falling volume. Attention is moving elsewhere.\n- **One giant red candle:** a large holder sold into the pool. Check the holders list to see whether other large holders remain.\n\nNone of these patterns is a reliable signal on its own. Memecoins can ignore every pattern when news or a single social post shifts attention.",
      ],
      [
        "What can a memecoin chart not tell you?",
        "A chart only shows trades that already happened. It does not show who holds the supply or whether the pool can be drained. Before you buy, also check:\n\n- **Holder concentration.** The top-10 holder share on Discover and the holders list on the token page show how much supply a few wallets control. See [token holders and top-10 concentration](/learn/token-holders-top-10/).\n- **Liquidity.** ArkhamPad coins have liquidity locked forever and show an LP locked label. For tokens from elsewhere, find out how the pool is held.\n- **Contract and creator.** The token page shows the contract address, creator, pool type, supply and age.\n\nA clean-looking chart on a token where one wallet holds half the supply is far riskier than the chart suggests.",
      ],
      [
        "A simple routine for reading a memecoin chart",
        "1. Open the token from Discover and confirm the contract address.\n2. Switch the chart to market cap view so the numbers are easy to compare.\n3. Look at the 1-hour or 4-hour chart for the overall direction, then the 1-minute or 5-minute chart for recent action.\n4. Check 24-hour volume and buys versus sells.\n5. Scan the live trades list for unusually large trades.\n6. Check the holders list and the top-10 share.\n7. If you trade, size your order so it does not move the price too much, and set slippage with care. See [slippage explained](/learn/slippage-explained/).\n\nIf you launched the coin yourself, the same routine shows you how people are trading it. The [memecoin launch checklist](/learn/memecoin-launch-checklist/) covers what to watch in the first 24 hours. Whatever the chart shows, memecoins stay high risk.",
      ],
    ],
    faq: [
      [
        "What do green and red candles mean on a crypto chart?",
        "On most charts, a green candle means the price closed higher than it opened during that period, and a red candle means it closed lower. The body shows the open-to-close range, and the wicks show the highest and lowest prices traded. Colour alone does not tell you how much volume was behind the move.",
      ],
      [
        "What is the best timeframe for trading memecoins?",
        "There is no single best timeframe. Short timeframes such as 1-minute and 5-minute candles suit brand-new coins with little history. Longer timeframes such as 1-hour and 4-hour candles show the broader trend for coins that have traded for days. Checking one short and one long timeframe gives a more balanced view.",
      ],
      [
        "Why does a memecoin chart have such long wicks?",
        "Memecoin pools often hold modest liquidity, so one large buy or sell can move the price far within a single candle. If the price then returns before the candle closes, a long wick remains. Frequent long wicks usually mean the price is easy to move, which also means your own trades may have more price impact.",
      ],
      [
        "Is a market cap chart the same as a price chart?",
        "For a token with a fixed supply, yes in shape. Market cap equals price multiplied by supply, so both lines move by the same percentage. Only the numbers differ. Market cap view is often easier to read for memecoins, whose prices can have many zeros after the decimal point.",
      ],
      [
        "Can a chart show if a memecoin is a rug pull?",
        "Not on its own. A chart shows past trades, not who holds the supply or whether liquidity can be removed. Check holder concentration, liquidity status, the contract address and the creator as well. On ArkhamPad coins, liquidity is locked forever, so a liquidity rug pull is not possible, though the price can still fall.",
      ],
    ],
    related: ["market-cap-vs-price", "token-holders-top-10", "slippage-explained"],
  },
  {
    slug: "market-cap-vs-price",
    cat: "trade",
    title: "Market Cap vs Price: What Memecoin Traders Should Watch",
    desc: "Market cap vs price in crypto: how market cap is calculated, why a low token price is not cheap, and why market cap is not money you can cash out.",
    keywords: [
      "market cap vs price crypto",
      "what is market cap in crypto",
      "how to calculate market cap",
      "does a low price mean a coin is cheap",
      "unit bias crypto",
      "circulating supply vs total supply",
      "fully diluted value explained",
      "market cap vs liquidity",
      "memecoin market cap",
      "why market cap is not real money",
      "arkhampad starting market cap",
    ],
    read: "6 min",
    short:
      "Price is what one token costs; market cap is that price multiplied by the token supply, so it shows the value of the whole token. For memecoins, market cap is usually the more useful number, because supplies differ enormously and a low price per token does not mean a coin is cheap.",
    sections: [
      [
        "What is the difference between market cap and price?",
        "**Price** is what one token costs right now, based on the most recent trade. **Market cap** (market capitalisation) is the price multiplied by the number of tokens in supply. It is the value the market is currently placing on the whole token.\n\nMarket cap = price × supply\n\nSay a coin has a supply of 1,000,000,000 tokens and the last trade was at 0.000001 HYPE per token. Its market cap is 1,000 HYPE. If the price doubles to 0.000002 HYPE, the market cap doubles to 2,000 HYPE. Price and market cap move by the same percentage, as long as the supply does not change.\n\nPrice describes one token. Market cap describes the whole coin.",
      ],
      [
        "Why a low token price does not mean a coin is cheap",
        "Many new traders look for coins with a very low price, expecting that a token worth a tiny fraction of a cent has more room to grow. This is called unit bias, and it is one of the most common mistakes in memecoin trading.\n\nPrice alone tells you nothing about value, because supplies vary enormously. Consider two hypothetical coins:\n\n- Coin A has 1,000,000 tokens at 1 HYPE each. Market cap: 1,000,000 HYPE.\n- Coin B has 1,000,000,000,000 tokens at 0.000001 HYPE each. Market cap: 1,000,000 HYPE.\n\nCoin B's price looks a million times cheaper, yet both coins are valued the same. For either one to double, the market has to add another 1,000,000 HYPE of value. The low price of Coin B gives it no advantage.\n\nWhen you compare coins, compare market caps. Ask how large a market cap the coin would need to reach for the return you have in mind, and whether that is realistic for a memecoin.",
      ],
      [
        "Circulating supply, total supply and fully diluted value",
        "Not every token has its whole supply in the market. Many crypto projects reserve tokens for a team, investors or future releases. That is why you will see several related terms:\n\n- **Total supply:** every token that exists.\n- **Circulating supply:** tokens that are actually in the market and can be traded.\n- **Fully diluted value (FDV):** price multiplied by total supply, including tokens not yet circulating.\n\nWhen a large share of supply is reserved, market cap based on circulating supply can look small while FDV is much larger. When those reserved tokens are released later, they can add heavy selling pressure.\n\nCoins launched on ArkhamPad avoid this gap. The total supply of 1,000,000,000 tokens goes into the pool at launch, with no team allocation and no presale. Circulating supply and total supply are the same from the start, so market cap and FDV match. For tokens launched elsewhere, check the supply details and the holders list before relying on any market cap figure.",
      ],
      [
        "How does buying change a memecoin's market cap?",
        "On Elysium, memecoins trade in automated pools rather than on an order book. When you buy, you add HYPE to the pool and take tokens out. Fewer tokens remain in the pool, so the pool's price rises. Selling does the reverse.\n\nA coin launched on ArkhamPad starts at a market cap of 60 HYPE. Every buy moves that number up and every sell moves it down. Because the pool is small early on, even modest buys can move the market cap a long way. That is why young memecoins can multiply in value within minutes, and fall just as fast.\n\nThis also explains price impact: the bigger your trade compared with the pool, the further it moves the price against you. A large order in a thin pool gets a worse average price than a small one.",
      ],
      [
        "Is market cap the money you could actually cash out?",
        "No. Market cap is the last trade price multiplied by the supply. It assumes every token could be sold at that price, which is never true.\n\nIf holders tried to sell a large share of the supply, each sale would push the price lower, and the HYPE they received would be far less than the market cap suggested. How much HYPE can actually come out depends on the liquidity in the pool and how much is sold.\n\nSay a hypothetical coin shows a market cap of 10,000 HYPE. That does not mean 10,000 HYPE is sitting in the pool waiting to be withdrawn. Selling even a modest fraction of the supply could drop the price sharply. Treat market cap as a measure of how the market values a coin at this moment, not as money that exists.",
      ],
      [
        "How do you use market cap when trading Elysium memecoins?",
        "ArkhamPad's [Discover page](/) shows market cap, 24-hour change, volume, buys and sells, and holders for every HYPE-paired token on Elysium. To trade, you can [log in with just an email](/learn/trade-crypto-with-email-login/).\n\nA few practical habits:\n\n- **Use the launch as a reference point.** ArkhamPad coins all start at 60 HYPE. A coin at 600 HYPE has grown about 10 times since launch.\n- **Read charts in market cap view.** Token pages let you switch the chart between market cap and price. See [how to read a memecoin chart](/learn/how-to-read-a-memecoin-chart/).\n- **Remember the price of HYPE.** These coins trade against HYPE, the same asset used on HyperEVM and bridged 1:1 to Elysium (see [Elysium vs HyperEVM](/learn/elysium-vs-hyperevm/)). A coin's value in dollars moves with both its own HYPE price and the price of HYPE itself.\n- **Compare like with like.** Compare coins by market cap, never by price per token.\n\nFor a broader overview of the tokens on the network, see the [Elysium memecoins guide](/learn/elysium-memecoins-guide/).",
      ],
      [
        "Why can volume matter more than market cap?",
        "Market cap tells you how a coin is valued. Volume tells you how actively it trades. A coin with a high market cap and almost no volume can be hard to sell without moving the price. A coin with steady volume relative to its size usually has more active interest.\n\nVolume also drives creator earnings. On ArkhamPad coins, every trade pays a 1% pool fee, and 30% of those fees go to the coin's creator. Creator income depends on how much the coin trades, not on its market cap. See [creator fees](/learn/earn-creator-fees/) for how this works.\n\nNeither number makes a memecoin safe. Market caps on new coins can fall to a fraction of their peak within hours. Only trade amounts you can afford to lose.",
      ],
    ],
    faq: [
      [
        "Is it better to buy a coin with a low price?",
        "No. A low price per token says nothing about value, because the supply can be huge. A coin priced at a tiny fraction of a cent can have the same market cap as a coin priced at 1 HYPE. Compare market caps instead, and ask how much value the market would need to add for the coin to reach your target.",
      ],
      [
        "How do you calculate market cap in crypto?",
        "Multiply the current price per token by the supply. A coin with 1,000,000,000 tokens trading at 0.000001 HYPE has a market cap of 1,000 HYPE. Some sites use circulating supply and show fully diluted value separately using total supply. For ArkhamPad coins the two match, because the whole supply goes into the pool at launch.",
      ],
      [
        "What is the starting market cap of an ArkhamPad coin?",
        "Every coin created on ArkhamPad starts at a market cap of 60 HYPE for its full supply of 1,000,000,000 tokens. That equals a starting price of 0.00000006 HYPE per token. Because every coin starts from the same point, you can quickly see how much a coin has grown since launch by comparing its current market cap with 60 HYPE.",
      ],
      [
        "Can a memecoin's market cap go to zero?",
        "In practice it can get very close. If buyers disappear and holders keep selling, the price falls toward zero and so does the market cap. Locked liquidity, as on ArkhamPad coins, means the pool cannot be withdrawn, but it does not hold the price up. Many memecoins lose most of their value, so trade with that in mind.",
      ],
      [
        "What is the difference between market cap and liquidity?",
        "Market cap is the last price multiplied by the supply. Liquidity is the amount of assets actually available in the pool to trade against. A coin can show a large market cap while its pool holds far less, so selling a big position can push the price well below what the market cap implies.",
      ],
    ],
    related: ["how-to-read-a-memecoin-chart", "token-holders-top-10", "slippage-explained"],
  },
  {
    slug: "slippage-explained",
    cat: "trade",
    title: "Slippage Explained: What to Set and Why Trades Fail",
    desc: "What is slippage in crypto? How slippage and price impact differ, which setting to choose (1%, 3%, 5% or 10%) and the common reasons trades fail.",
    keywords: [
      "what is slippage in crypto",
      "slippage tolerance explained",
      "what slippage to set for memecoins",
      "best slippage setting",
      "slippage vs price impact",
      "minimum received meaning",
      "slippage exceeded error",
      "why did my crypto trade fail",
      "how to reduce slippage",
      "why can't i sell a token",
      "transaction failed not enough gas",
    ],
    read: "6 min",
    short:
      "Slippage is the difference between the result you are quoted and the result your trade actually gets, caused mainly by other trades landing before yours. Your slippage setting is the most you will accept; if the price moves further, the trade fails instead of filling at a worse price. On ArkhamPad you can choose 1%, 3%, 5% (the default) or 10%.",
    sections: [
      [
        "What is slippage in crypto?",
        "When you swap tokens in a pool, you see a quote first: how many tokens you should receive for the HYPE you pay, or how much HYPE you should receive for the tokens you sell. That quote is based on the state of the pool at the moment you looked.\n\nBy the time your transaction is processed, the pool may have changed. Other traders may have bought or sold in between. **Slippage** is the difference between the quoted result and the result you actually get.\n\nSlippage can work in either direction. If other traders sold just before your buy, you may receive slightly more tokens than quoted. On busy memecoins, though, it usually works against you, because many people buy into the same moves at the same time.",
      ],
      [
        "What is the difference between slippage and price impact?",
        "The two are related but not the same.\n\n- **Price impact** is how much your own trade moves the price. In a pool, buying takes tokens out and pushes the price up as your order fills. The larger your trade compared with the liquidity in the pool, the bigger the impact. The quote you see already includes it.\n- **Slippage** is any further change between the quote and execution, mostly caused by other trades landing first.\n\nPrice impact matters a lot on new memecoins. A coin launched on ArkhamPad starts at a market cap of 60 HYPE, so early on the pool is small and even a modest buy can move the price noticeably. Check the quote before you confirm. If it gives you far fewer tokens than you expected, your order is large for that pool. How price relates to pool size is covered in [market cap vs price](/learn/market-cap-vs-price/).",
      ],
      [
        "How does minimum received protect you?",
        "Your slippage setting turns into a hard limit called **minimum received**. It is the least you will accept from the trade. If the trade would deliver less, it does not go through.\n\nSay you want to buy a coin and the quote shows 1,000,000 tokens. With slippage set to 5%, the minimum received is 950,000 tokens. If the price moves so that your HYPE would buy only 940,000 tokens when the trade executes, the transaction is rejected and your HYPE stays in your wallet. If it would buy 980,000, the trade goes through and you receive 980,000.\n\nThe same applies to sells. If you sell tokens with a quote of 10 HYPE and 3% slippage, the minimum received is 9.7 HYPE.\n\nOn ArkhamPad, the quote and the minimum received are shown before you trade, so you can see exactly what your setting allows.",
      ],
      [
        "What slippage should you set?",
        "ArkhamPad offers four settings: 1%, 3%, 5% and 10%. The default is 5%. There is no single right answer, but a simple guide helps:\n\n- **1%:** for calm tokens and small orders. Lowest risk of a poor fill, but trades fail more often when the price is moving.\n- **3%:** a reasonable choice for tokens that trade steadily without big swings.\n- **5% (default):** a balance for typical memecoin trading, where prices move quickly.\n- **10%:** for very fast markets, such as the first minutes after a launch, when lower settings keep failing. You accept that you may get a noticeably worse price.\n\nA higher setting does not make your trade more expensive by itself. It only raises how much worse than the quote you are willing to accept. On a fast-moving coin, though, a wide setting means you may actually receive that worse result. Start lower and only raise it when you understand why trades are failing.",
      ],
      [
        "Why do crypto trades fail?",
        "A failed trade is frustrating, but it usually has a clear cause. The most common ones:\n\n1. **Slippage exceeded.** The price moved more than your setting allowed, so the minimum received could not be met. This is the protection working as intended. Get a fresh quote and try again, or raise slippage one step.\n2. **Not enough HYPE for gas.** Network fees on Elysium are paid in HYPE from your balance. If you spend your entire balance on a buy, there may be nothing left for the fee. Keep a little HYPE aside. See [Elysium gas fees](/learn/elysium-gas-fees/).\n3. **Token transfer tax.** Some tokens charge their own tax whenever they are transferred. These may not be sellable through the ArkhamPad router.\n4. **Insufficient balance.** The amount entered is more than your wallet holds, often because a previous trade or fee already used part of it.\n\nOn EVM networks, a transaction that fails after reaching the chain can still use some gas. On Elysium that cost is very low, but repeated failures still add up.",
      ],
      [
        "How do you reduce slippage on memecoins?",
        "- **Trade smaller amounts.** A smaller order has less price impact and is less likely to fail. You can split a large buy into a few smaller ones, keeping in mind that each trade pays its own fees.\n- **Avoid the busiest moments.** The first minutes after a launch, or right after a coin is shared widely, are when prices move fastest.\n- **Refresh the quote.** If you waited a while before confirming, get a new quote so the minimum received reflects the current price.\n- **Check the pool before a big trade.** If what you receive drops sharply as you increase the amount, the pool is thin for that size.\n- **Have funds ready.** Bridge HYPE in advance on the [Bridge page](/bridge/) so you are not rushing. The guides to [bridging HYPE to Elysium](/learn/bridge-hype-to-elysium/) and [buying with USDC](/learn/buy-elysium-tokens-with-usdc/) cover both ways in.\n\nFor the full buy and sell flow, see [how to buy and sell Elysium tokens](/learn/how-to-buy-elysium-tokens/).",
      ],
      [
        "Does Elysium's design affect slippage?",
        "Partly. Elysium is designed for very fast blocks, with a target of about 100 to 200 milliseconds. A shorter gap between your quote and the block that includes your trade gives the price less time to drift.\n\nAt launch, a single sequencer orders transactions by priority fee, and there is no public mempool where pending trades sit in view of everyone. Even so, other trades can still land before yours, especially on popular coins. Your slippage setting and minimum received remain your real protection.\n\nNo setting protects you from the price falling after your trade completes. Memecoins are highly volatile, so only trade amounts you can afford to lose.",
      ],
    ],
    faq: [
      [
        "What is a good slippage setting for memecoins?",
        "On ArkhamPad the default is 5%, which suits most memecoin trades. Use 1% or 3% for calmer tokens and small orders. Use 10% only in very fast markets, such as right after a launch, when lower settings keep failing. Remember that a higher setting means you accept a possibly worse price in exchange for a better chance the trade fills.",
      ],
      [
        "Why did my trade fail with a slippage error?",
        "The price moved more than your slippage setting allowed between the quote and execution, so the trade could not deliver your minimum received and was rejected. Your funds stay in your wallet. Refresh the quote and try again, trade a smaller amount, or raise slippage one step if you accept a possibly worse price.",
      ],
      [
        "Does high slippage mean I pay more?",
        "Not automatically. Slippage tolerance is a limit, not a fee. With 10% slippage you may still receive close to the quote if the price barely moves. But you allow the trade to fill up to 10% worse, and on fast-moving coins that can happen. Fees, such as the 1% pool fee on ArkhamPad coins, are separate from slippage.",
      ],
      [
        "What is minimum received in crypto?",
        "Minimum received is the smallest amount your trade will accept, calculated from the quote and your slippage setting. For example, a quote of 1,000,000 tokens with 5% slippage gives a minimum of 950,000 tokens. If the trade would deliver less, it fails instead of filling. ArkhamPad shows the minimum received before you confirm.",
      ],
      [
        "Why can't I sell a token through the router?",
        "Some tokens charge their own tax whenever they are transferred. The amount that arrives is then less than a normal swap expects, so these tokens may not be sellable through the ArkhamPad router. Check whether a token has a transfer tax before you buy, because being unable to sell easily is a serious risk.",
      ],
    ],
    related: ["how-to-buy-elysium-tokens", "market-cap-vs-price", "elysium-gas-fees"],
  },
  {
    slug: "token-holders-top-10",
    cat: "trade",
    title: "Top 10 Holders in Crypto: What Concentration Tells You",
    desc: "Top 10 holders in crypto explained: what holder concentration means, which addresses to ignore, how to check holders on Elysium and why it matters.",
    keywords: [
      "top 10 holders crypto",
      "token holder concentration",
      "how to check token holders",
      "what top 10 holder percentage is safe",
      "whale concentration memecoin",
      "holder count vs concentration",
      "why is the liquidity pool the top holder",
      "can whales dump tokens with locked liquidity",
      "how to check token holders on elysium",
      "creator wallet holdings",
      "soft rug pull meaning",
    ],
    read: "6 min",
    short:
      "Top-10 holder concentration is the share of a token's supply held by its ten largest wallets. A high share means a few wallets can push the price down sharply by selling, so it is one of the first things to check before buying a memecoin. On ArkhamPad, Discover shows each token's top-10 share and every token page lists holders with their percentage of supply.",
    sections: [
      [
        "What does top-10 holder concentration mean?",
        "Every token balance sits in a wallet address, and anyone can see which addresses hold how much. **Holder concentration** describes how that supply is spread out. The most common way to measure it is the **top-10 holder share**: the percentage of total supply held by the ten largest addresses combined.\n\nSay a coin has a supply of 1,000,000,000 tokens and its ten largest wallets hold 400,000,000 between them. Its top-10 share is 40%. The other 60% is spread across every remaining holder.\n\nIt is a simple number, but it answers an important question: how few people would need to sell to move the price a lot?",
      ],
      [
        "Why do top 10 holders matter for memecoins?",
        "Memecoins trade in pools. When a holder sells, they put tokens into the pool and take HYPE out, which pushes the price down. The bigger the sale compared with the pool, the bigger the drop.\n\nIf supply is spread across many small holders, no single seller can do much damage. If a few wallets hold a large share, any one of them can cause a sharp fall by selling, and others often follow when they see it happen. Large holders are often called whales.\n\nHigh concentration also makes charts less trustworthy. A steady climb may simply reflect one or two wallets buying, and those wallets can reverse at any time. That is why holder data should be read alongside the chart, as covered in [how to read a memecoin chart](/learn/how-to-read-a-memecoin-chart/).",
      ],
      [
        "Which addresses in a holder list are not real holders?",
        "Not every large address is a person who can sell. Before you judge a top-10 share, look at who the largest addresses are.\n\n- **The liquidity pool.** The pool contract holds the tokens available to trade, and it often appears as the largest holder. Those tokens are not held by a trader; they are what buyers purchase from.\n- **Burn addresses.** Tokens sent to an address nobody controls are effectively destroyed.\n- **Other contracts.** Some addresses belong to smart contracts rather than individuals.\n\nThis matters most for brand-new coins. On ArkhamPad, the whole supply of 1,000,000,000 tokens goes into the pool at launch, so at first almost everything sits in the pool. As people buy, tokens move from the pool into wallets. A very high top-10 share on a coin that is minutes old may simply mean the pool still holds most of the supply. Check whether the largest holder is the pool before drawing conclusions.",
      ],
      [
        "What top-10 holder percentage is safe?",
        "There is no universal safe number. What counts as risky depends on the token's age, how much of the supply is still in the pool and who the large wallets belong to. A few guidelines help:\n\n- **Look at individual wallets, not only the total.** Ten wallets holding 3% each is very different from one wallet holding 25% and nine holding 0.5% each.\n- **Set aside the pool and burn addresses** when you think about how much supply traders control.\n- **Check the creator.** The token page shows the creator's address. If the creator's wallet is among the largest holders, they can sell into anyone who buys after them. On ArkhamPad, a creator can make an optional first buy at launch, and those tokens appear in the holders list like any other.\n- **Watch for linked wallets.** Several mid-sized wallets that all bought at the same moment may belong to the same person.\n- **Watch the trend.** Concentration falling over time as more people buy is generally healthier than concentration rising.\n\nLow concentration does not make a coin safe. It only reduces one specific risk.",
      ],
      [
        "How do you check token holders on ArkhamPad?",
        "1. Open [Discover](/). Every HYPE-paired token on Elysium is listed with its holder count and top-10 holder share.\n2. Use the top-10 share to decide which coins deserve a closer look.\n3. Open the token page and go to the holders list. Each address is shown with its percentage of supply.\n4. Note the creator address shown on the token page and look for it in the list.\n5. Watch the live trades list for unusually large sells.\n6. Check again later. Concentration changes as people buy and sell.",
      ],
      [
        "Does a high holder count mean a coin is safe?",
        "Not by itself. Holder count only tells you how many addresses hold at least some of the token. It says nothing about how the supply is divided.\n\nA coin can have thousands of holders and still have most of its supply in five wallets. Holder counts can also be inflated by sending tiny amounts to many new addresses. Read holder count and top-10 share together. A growing number of holders with a falling top-10 share is a better sign than either number alone.",
      ],
      [
        "How does holder concentration relate to rug pulls?",
        "A classic rug pull happens when a creator removes the pool's liquidity, leaving holders unable to sell. On ArkhamPad coins this is not possible, because the pool position is held by the launcher contract forever and nobody can withdraw it. [Locked liquidity explained](/learn/locked-liquidity-explained/) covers how this works.\n\nConcentration creates a different risk, sometimes called a dump or soft rug: a large holder sells a big position into the pool. Locked liquidity means there is always a pool to sell into, but it does not stop the price falling when a whale sells. That is why top-10 share is worth checking even on coins with locked liquidity. Other warning signs are listed in [how to spot a rug pull](/learn/spot-a-rug-pull/).\n\nWhen a large sell hits, prices can drop within seconds. If you are selling at the same time, a tight [slippage setting](/learn/slippage-explained/) may cause your trade to fail, while a wide one may fill at a much lower price. Selling into the pool is quick, but moving HYPE back to HyperEVM through the official bridge takes about 5.5 days, as explained in [Elysium withdrawal time](/learn/elysium-withdrawal-time/). Memecoins are high risk, so size positions with that in mind.",
      ],
    ],
    faq: [
      [
        "What does top 10 holders mean in crypto?",
        "It is the share of a token's total supply held by its ten largest wallet addresses combined. If the ten biggest wallets hold 400 million tokens of a 1 billion supply, the top-10 share is 40%. A high share means a small group can move the price sharply by selling, so traders use it as a quick concentration check.",
      ],
      [
        "Is it bad if one wallet holds a lot of a token?",
        "It depends whose wallet it is. If it is the liquidity pool or a burn address, those tokens are not held by a trader. If it is the creator or another individual, that wallet can sell a large amount at once and push the price down sharply. Check the address before you judge the number.",
      ],
      [
        "Why does a new ArkhamPad coin show such high concentration?",
        "At launch, the entire supply of 1,000,000,000 tokens goes into the pool, so the pool holds nearly everything. As people buy, tokens move from the pool into their wallets and the supply spreads out. Early on, a high top-10 share often reflects the pool rather than a few traders, so check the largest address first.",
      ],
      [
        "Where can I see token holders on Elysium?",
        "On ArkhamPad, the Discover page shows the holder count and top-10 holder share for every HYPE-paired token on Elysium. Each token page has a holders list with every address and its percentage of supply, alongside the contract address, creator, pool type, supply and age of the token.",
      ],
      [
        "Can whales dump a token with locked liquidity?",
        "Yes. Locked liquidity only means the pool itself cannot be withdrawn. Any holder, including a large one, can still sell tokens into the pool. A big sale pushes the price down, sometimes sharply. Locked liquidity prevents a liquidity rug pull, but it does not protect the price from falling.",
      ],
    ],
    related: ["spot-a-rug-pull", "locked-liquidity-explained", "how-to-read-a-memecoin-chart"],
  },
];
