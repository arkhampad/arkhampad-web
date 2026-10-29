import type { Post } from "./types";

export const part1: Post[] = [
  {
    slug: "what-is-elysium",
    cat: "elysium",
    title: "What Is Elysium? Kinetiq's Hyperliquid Layer 2 Explained",
    desc: "What is Elysium? A plain guide to Kinetiq's Layer 2 for Hyperliquid: how it works, why it exists, HYPE as gas, chain ID 99901 and how to get started.",
    keywords: [
      "what is elysium",
      "elysium layer 2",
      "kinetiq elysium",
      "elysium hyperliquid",
      "elysium chain id",
      "elysium arbitrum orbit",
      "is there an elysium token",
      "elysium gas token",
      "how does elysium work",
      "elysium blockchain explained",
      "elysium sequencer",
      "elysium data availability",
    ],
    read: "7 min",
    short:
      "Elysium is a Layer 2 blockchain for the Hyperliquid ecosystem, built by Kinetiq, the team behind kHYPE liquid staking. It is an Arbitrum Orbit chain that settles to HyperEVM, runs standard EVM contracts and wallets, and uses HYPE as its gas token. It exists to give trading apps, launchpads and AMMs far more block space than HyperEVM offers.",
    sections: [
      [
        "What is Elysium in simple terms?",
        `Elysium is a separate blockchain that sits on top of HyperEVM, the smart contract chain of Hyperliquid. This kind of chain is called a Layer 2 (L2): it produces its own blocks and processes its own transactions, but it settles back to a base chain. For Elysium, that base chain is HyperEVM.

Elysium was built by Kinetiq, the team known for kHYPE, a liquid staking token for HYPE. The chain is operated with Conduit, an infrastructure provider that runs rollup chains.

For a user, Elysium feels like any other EVM network. You add it to a wallet, hold some HYPE for gas, and use apps. The difference is speed and room. Elysium is designed for very fast blocks, with a target of 100 to 200 milliseconds, and much higher throughput than its base layer.`,
      ],
      [
        "Why does Hyperliquid need a Layer 2?",
        `Hyperliquid keeps HyperEVM blocks small on purpose. That choice keeps the base layer lean, but it limits how many transactions apps can push through at once.

Some apps need a lot of block space. Trading interfaces, token launchpads and AMMs (automated market makers, the pools that let you swap one token for another) all create many transactions, and demand spikes when many people trade at the same moment.

Elysium gives those apps their own lane. Activity on Elysium does not compete for space in HyperEVM blocks. HyperEVM only receives compact records that let the L2 settle. For a side-by-side comparison of the two chains, read [Elysium vs HyperEVM](/learn/elysium-vs-hyperevm/).`,
      ],
      [
        "How does Elysium work under the hood?",
        `Elysium is an Arbitrum Orbit chain. Orbit is the framework for launching chains on the Arbitrum Nitro stack and ArbOS, the operating layer of Arbitrum chains. Because the stack is standard, Elysium is fully EVM compatible. Solidity contracts deploy unchanged, and normal tools and wallets such as MetaMask work as they do elsewhere.

Four parts are worth knowing:

- **Sequencer.** One sequencer orders transactions at launch. It sorts them by priority fee, and there is no public mempool where pending transactions wait in view.
- **Data availability.** An AnyTrust-style committee stores the full transaction data and posts compact certificates to HyperEVM. If the committee cannot do its job, the chain falls back to posting full data on HyperEVM.
- **Validators.** Validators are permissioned at launch. Permissionless fraud proofs, through Arbitrum's BoLD system, are planned for later.
- **Escape hatch.** If the sequencer ever refuses your transaction, you can force-include it through the delayed inbox on HyperEVM.

The design is optimistic. The chain treats posted results as correct unless someone challenges them within a set window. That window is why withdrawals through the official bridge take time, as explained in [Elysium withdrawal time](/learn/elysium-withdrawal-time/).`,
      ],
      [
        "What token does Elysium use for gas?",
        `Elysium uses HYPE, Hyperliquid's native token, as its gas token. HYPE is bridged 1:1 from HyperEVM, so there is no new coin to buy just to pay fees. Gas costs on Elysium are very low, but you still need a small HYPE balance to send any transaction. [HYPE on Elysium](/learn/hype-on-elysium/) covers how HYPE moves between chains and how it is used for trading.

There is no Elysium token at this time, and there is no official points program. Be careful with anyone selling an "Elysium token" or promising points. One related fact: half of Elysium sequencer fees are earmarked for open-market buybacks of KNTQ, the Kinetiq token.`,
      ],
      [
        "Elysium mainnet: chain ID and launch date",
        `The key network details:

- Network: Elysium mainnet
- Chain ID: 99901
- Gas token: HYPE
- Settles to: HyperEVM (chain ID 999)
- Public mainnet launch date announced by Kinetiq: November 9, 2026

Some features come after launch. Kinetiq plans an ArbOS upgrade about a month after mainnet that would let smart contracts read live HyperCore market data and route orders to HyperCore, the trading engine at the center of Hyperliquid. That upgrade is not live at launch. For a trader's view of the launch period, read [Elysium mainnet launch](/learn/elysium-mainnet-launch/).`,
      ],
      [
        "What can you do on Elysium?",
        `Most early activity on Elysium is trading and launching tokens. People swap HYPE for new tokens, many of them memecoins, and create tokens of their own.

ArkhamPad is a launchpad and trading site built for this. Its [Discover page](/) lists every HYPE-paired token on Elysium from every launchpad, with market cap, volume, holders and live trades in one place. You can trade any of them from a single token page.

You can also launch your own coin. On ArkhamPad it takes about 30 seconds, and the whole supply goes into a pool with liquidity locked forever. The steps are in [create a token on Elysium](/learn/create-a-token-on-elysium/).

Memecoins are high risk. Prices can move sharply within minutes, and many tokens fall to near zero. Only use money you can afford to lose.`,
      ],
      [
        "How do you get started on Elysium?",
        `1. Get a wallet. On ArkhamPad you can log in with email or Google and an embedded wallet is created for you, or you can connect a wallet you already use.
2. Fund it. Bridge HYPE from HyperEVM on the [Bridge page](/bridge/), or bring USDC from Base, which is converted to HYPE on the way in.
3. Keep a little HYPE for gas, then explore tokens or launch one.

Deposits arrive within seconds to a few minutes. Moving funds back to HyperEVM through the official bridge takes about 5.5 days, so plan your exits ahead of time.`,
      ],
    ],
    faq: [
      [
        "Is Elysium a Layer 2 or a sidechain?",
        "Elysium is a Layer 2. It is an Arbitrum Orbit chain that settles to HyperEVM and uses an optimistic design: results are treated as valid unless challenged within a set period. Transaction data is held by an AnyTrust-style committee that posts compact certificates to HyperEVM, with a fallback to full data. Validators are permissioned at launch, and permissionless fraud proofs are planned for later.",
      ],
      [
        "Who built Elysium?",
        "Elysium was built by Kinetiq, the team behind kHYPE, a liquid staking token for HYPE. The chain is operated with Conduit, an infrastructure provider for rollup chains. Elysium belongs to the Hyperliquid ecosystem and settles to HyperEVM, Hyperliquid's smart contract layer, rather than to Ethereum.",
      ],
      [
        "Does Elysium have its own token or airdrop?",
        "No. There is no Elysium token and no official points program at this time. Gas is paid in HYPE. Half of Elysium sequencer fees are earmarked for open-market buybacks of KNTQ, Kinetiq's token. Treat any offer of an Elysium token, presale or points claim as a likely scam unless Kinetiq announces it through its official channels.",
      ],
      [
        "What is the Elysium chain ID?",
        "The Elysium mainnet chain ID is 99901. HyperEVM, the chain Elysium settles to, uses chain ID 999. If you add Elysium to a wallet by hand, check the chain ID carefully and take network details only from official sources, because a wrong setting can point your wallet at a different network.",
      ],
      [
        "Can I use MetaMask on Elysium?",
        "Yes. Elysium runs the standard Arbitrum Nitro stack, so it is fully EVM compatible. MetaMask and other common EVM wallets work once the network is added. You need some HYPE in the wallet to pay gas. If you prefer not to manage a wallet extension, ArkhamPad also supports email or Google login with an embedded wallet.",
      ],
    ],
    related: ["elysium-vs-hyperevm", "hype-on-elysium", "elysium-mainnet-launch"],
  },
  {
    slug: "elysium-vs-hyperevm",
    cat: "elysium",
    title: "Elysium vs HyperEVM: What's the Difference?",
    desc: "Elysium vs HyperEVM compared: block space, speed, security model, gas, chain IDs and bridging. Learn when to use each chain in the Hyperliquid ecosystem.",
    keywords: [
      "elysium vs hyperevm",
      "difference between elysium and hyperevm",
      "is elysium faster than hyperevm",
      "hyperevm chain id",
      "elysium chain id 99901",
      "hyperevm block space",
      "elysium security model",
      "move funds from hyperevm to elysium",
      "same wallet address elysium hyperevm",
      "hyperliquid layer 2 comparison",
    ],
    read: "7 min",
    short:
      "HyperEVM is Hyperliquid's own smart contract chain (chain ID 999), and it keeps its blocks small on purpose. Elysium (chain ID 99901) is a Layer 2 built by Kinetiq that settles to HyperEVM and offers much more block space and very fast blocks for trading apps. Both are EVM chains and both use HYPE for gas.",
    sections: [
      [
        "What is HyperEVM?",
        `HyperEVM is the EVM smart contract layer of Hyperliquid. It is part of Hyperliquid's base network, alongside HyperCore, the trading engine behind Hyperliquid's markets. HYPE is its native token and its chain ID is 999.

Hyperliquid keeps HyperEVM blocks small on purpose. That protects the base layer, but it caps how much activity apps can fit into each block. For most transfers and everyday contract calls this is fine. For apps that generate a constant stream of trades, it becomes a limit.`,
      ],
      [
        "What is Elysium, and how does it relate to HyperEVM?",
        `Elysium is a Layer 2 built by Kinetiq. It runs its own blocks and settles to HyperEVM, the way many Ethereum Layer 2s settle to Ethereum. It is an Arbitrum Orbit chain, so it uses the standard Arbitrum Nitro stack and ArbOS. The full background is in [what is Elysium](/learn/what-is-elysium/).

The relationship is simple. HyperEVM is the base. Elysium is an extra lane built on top of it for busy trading apps, launchpads and AMMs.`,
      ],
      [
        "Elysium vs HyperEVM: the key differences",
        `- **Layer.** HyperEVM is part of Hyperliquid's base network. Elysium is a Layer 2 that settles to HyperEVM.
- **Block space.** HyperEVM blocks are small by design. Elysium is built for much more block space and high throughput.
- **Block speed.** Elysium targets very fast blocks, in the range of 100 to 200 milliseconds.
- **Gas token.** Both use HYPE. On Elysium it is HYPE bridged 1:1 from HyperEVM.
- **Chain ID.** HyperEVM is 999. Elysium mainnet is 99901.
- **Compatibility.** Both are EVM chains. Solidity contracts and common wallets work on both.
- **Transaction ordering.** On Elysium at launch, a single sequencer orders transactions by priority fee, with no public mempool.
- **Exits.** Leaving Elysium through the official bridge takes about 5.5 days. Moving into Elysium takes seconds to a few minutes.`,
      ],
      [
        "Is Elysium as secure as HyperEVM?",
        `They use different trust models, and it helps to know where the trust sits.

On Elysium, one sequencer orders transactions at launch. Validators are permissioned, which means only approved parties can post and check results for now. Permissionless fraud proofs, through Arbitrum's BoLD system, are planned for later, which would let anyone challenge an invalid result.

Two protections exist from day one. First, if the sequencer refuses your transaction, you can force-include it through the delayed inbox on HyperEVM. Second, the data needed to rebuild the chain is stored by an AnyTrust-style committee that posts compact certificates to HyperEVM, with a fallback to posting full data on HyperEVM.

The optimistic design also explains the exit delay. Withdrawals wait for a challenge period so any invalid result can be disputed first. The details are in [Elysium withdrawal time](/learn/elysium-withdrawal-time/).`,
      ],
      [
        "How do you move funds between HyperEVM and Elysium?",
        `Deposits go from HyperEVM to Elysium through the official Elysium bridge and arrive within seconds to a few minutes. Your HYPE arrives 1:1. You can start from the [Bridge page](/bridge/), and the full walkthrough is in [bridge HYPE to Elysium](/learn/bridge-hype-to-elysium/).

If your funds are on Base instead, ArkhamPad also accepts USDC from Base and converts it to HYPE on the way in, so you land on Elysium ready to trade. See [buy Elysium tokens with USDC](/learn/buy-elysium-tokens-with-usdc/).

Withdrawals back to HyperEVM through the official bridge take about 5.5 days (around 132 hours) on mainnet. ArkhamPad is working on a faster exit route, but there is no date yet.`,
      ],
      [
        "Which chain should you use?",
        `It depends on what you want to do.

- **Trading new Elysium tokens or launching a coin:** Elysium. That is where those tokens and pools live, and the extra block space is built for frequent trading.
- **Using apps that only exist on HyperEVM:** HyperEVM. Contracts and balances are separate per chain.
- **Funds you may need quickly:** think before bridging. Getting in is fast. Getting out through the official bridge takes about 5.5 days.

Fees are another factor. Gas on Elysium is very low, but trading costs include more than gas. [Elysium gas fees](/learn/elysium-gas-fees/) breaks down what a trade really costs.`,
      ],
      [
        "What changes after the planned HyperCore upgrade?",
        `Kinetiq plans an ArbOS upgrade about a month after Elysium mainnet. It would let smart contracts on Elysium read live HyperCore market data and route orders to HyperCore.

That would connect Elysium more closely to the rest of Hyperliquid. Apps on Elysium could use live market data from HyperCore inside their contracts. This upgrade is not live at launch, so treat it as planned until it ships.`,
      ],
    ],
    faq: [
      [
        "Is Elysium faster than HyperEVM?",
        "Elysium is designed for very fast blocks, with a target of 100 to 200 milliseconds, and for much higher throughput. HyperEVM keeps its blocks small on purpose. For apps that send many transactions, such as launchpads and trading sites, Elysium offers far more room. Keep in mind that the block time is a design target, and real conditions can vary.",
      ],
      [
        "Do I need a different token for gas on Elysium?",
        "No. Both Elysium and HyperEVM use HYPE for gas. On Elysium, HYPE is bridged 1:1 from HyperEVM through the official bridge, so there is no separate gas token to buy. Keep a small amount of HYPE on Elysium at all times, because every transaction, including selling a token, needs some gas.",
      ],
      [
        "Can I use the same wallet address on Elysium and HyperEVM?",
        "Yes. Both are EVM chains, so a normal EVM wallet address works on both. Balances are separate, though. HYPE on HyperEVM does not show up on Elysium until you bridge it, and tokens bought on Elysium stay on Elysium. Always check which network your wallet is connected to before you send funds.",
      ],
      [
        "Why does leaving Elysium take longer than entering it?",
        "Elysium is an optimistic Layer 2. Deposits from HyperEVM arrive within seconds to a few minutes. Withdrawals through the official bridge must wait for a challenge period, currently about 5.5 days on mainnet, so that any invalid result can be disputed before funds are released on HyperEVM.",
      ],
      [
        "Are tokens on HyperEVM automatically available on Elysium?",
        "No. Each chain has its own contracts and balances. A token deployed on HyperEVM does not appear on Elysium by itself, and a token launched on Elysium lives only on Elysium. To use HYPE on Elysium, you bridge it through the official Elysium bridge, where it arrives 1:1.",
      ],
    ],
    related: ["what-is-elysium", "bridge-hype-to-elysium", "elysium-withdrawal-time"],
  },
  {
    slug: "hype-on-elysium",
    cat: "elysium",
    title: "HYPE on Elysium: Gas, Trading and Bridging Explained",
    desc: "HYPE on Elysium explained: how it is bridged 1:1 from HyperEVM, why it pays gas, how tokens trade against it, and how to move it back. A plain guide.",
    keywords: [
      "hype on elysium",
      "how to get hype on elysium",
      "elysium gas token hype",
      "bridge hype 1:1 elysium",
      "wrapped hype elysium",
      "trade tokens with hype",
      "how much hype for gas",
      "hype paired tokens elysium",
      "move hype back to hyperevm",
      "pay with usdc instead of hype",
    ],
    read: "7 min",
    short:
      "On Elysium, HYPE is both the gas token and the main trading currency. It is bridged 1:1 from HyperEVM through the official Elysium bridge, arrives within seconds to a few minutes, and pays for every transaction. Most Elysium tokens trade against HYPE, so HYPE is what you spend to buy and what you receive when you sell.",
    sections: [
      [
        "What is HYPE and why does Elysium use it?",
        `HYPE is the native token of Hyperliquid. It pays gas on HyperEVM, Hyperliquid's smart contract chain.

Elysium, the Layer 2 built by Kinetiq on top of HyperEVM, uses HYPE as its gas token too. This was a deliberate choice: users do not need a new token just to pay fees. If you already hold HYPE, you already hold what Elysium needs.

HYPE plays two roles on Elysium:

- **Gas.** Every transaction pays a small network fee in HYPE.
- **Trading currency.** Most tokens on Elysium are paired with HYPE, so prices and market caps are measured in HYPE.`,
      ],
      [
        "How do you get HYPE onto Elysium?",
        `The standard route is the official Elysium bridge. You deposit HYPE on HyperEVM and the same amount becomes available on Elysium. It is a 1:1 bridge with no conversion. Deposits arrive within seconds to a few minutes.

On ArkhamPad you can start this from the [Bridge page](/bridge/). Each step is shown in [bridge HYPE to Elysium](/learn/bridge-hype-to-elysium/).

If you do not hold HYPE yet, there is a second route. ArkhamPad accepts USDC from Base and converts it to HYPE on the way in through a cross-chain route, so you arrive on Elysium holding HYPE. That process is covered in [buy Elysium tokens with USDC](/learn/buy-elysium-tokens-with-usdc/).`,
      ],
      [
        "How does HYPE pay for gas on Elysium?",
        `Every action on Elysium is a transaction: buying a token, selling, approving, creating a coin or bridging out. Each one pays a network fee in HYPE, taken from your balance.

Gas costs on Elysium are very low, so this fee is usually a tiny part of a trade. It still matters in one situation. If you spend all your HYPE on a token, you will have nothing left to pay gas when you want to sell. Always leave a small reserve of HYPE in your wallet after each buy.

At launch, one sequencer orders Elysium transactions by priority fee. In practice this means a higher priority fee can place a transaction earlier in the queue. For a full cost breakdown, see [Elysium gas fees](/learn/elysium-gas-fees/).`,
      ],
      [
        "Why do Elysium tokens trade against HYPE?",
        `Most tokens on Elysium are paired with HYPE. The Discover page on ArkhamPad lists every HYPE-paired token on Elysium, from every launchpad, with market cap, 24h change, volume and holders shown in HYPE terms.

Under the hood, pools hold wrapped HYPE. Wrapped HYPE is a token-standard version of HYPE that smart contracts and pools can hold like any other token. When you trade through ArkhamPad you do not need to wrap anything yourself: you pay HYPE and receive tokens, or sell tokens and receive HYPE. The ArkhamPad router is a single smart contract that trades both Uniswap v3 style and v4 style pools, so one buy box works for any Elysium token.

Pricing in HYPE has a side effect worth knowing. A token's dollar value depends on two things: its price in HYPE and the price of HYPE itself. If HYPE moves, the dollar value of your tokens moves too, even if the token's HYPE price stays flat.

For step-by-step trading, read [how to buy Elysium tokens](/learn/how-to-buy-elysium-tokens/).`,
      ],
      [
        "Can you earn HYPE on Elysium?",
        `Creators on ArkhamPad can. Every ArkhamPad coin trades in a pool with a 1% fee on every trade. 30% of those trading fees go to the coin's creator, and 70% go to ArkhamPad. Fees are collected from the pool and paid out in HYPE and in the coin itself.

How much a creator earns depends entirely on trading volume, and many coins see little volume after launch. There is no guaranteed income. The details are in [creator fees](/learn/earn-creator-fees/).`,
      ],
      [
        "Can you use HYPE on Elysium without a browser wallet?",
        `Yes. ArkhamPad lets you log in with email or Google. An embedded wallet is created for you, so there is no seed phrase to write down to get started. Trades from the embedded wallet are signed without pop-ups.

The wallet still holds real HYPE on Elysium and still needs HYPE for gas. You fund it the same ways: bridge HYPE from HyperEVM or bring USDC from Base. More on this in [trade with an email login](/learn/trade-crypto-with-email-login/).`,
      ],
      [
        "How do you move HYPE back to HyperEVM?",
        `You withdraw through the same official Elysium bridge. Withdrawals are optimistic, which means they finalize only after a challenge period. On Elysium mainnet that period is currently about 5.5 days, or around 132 hours.

Your HYPE is not lost during that time. It is waiting for the challenge window to close before it is released on HyperEVM. A faster exit route is being worked on at ArkhamPad, but there is no date yet. If you might need your HYPE on HyperEVM soon, bridge only what you plan to use on Elysium.`,
      ],
    ],
    faq: [
      [
        "Is HYPE on Elysium the same as HYPE on HyperEVM?",
        "It is the same asset, moved 1:1 through the official Elysium bridge. HYPE you deposit on HyperEVM becomes available on Elysium in the same amount. You can send it back to HyperEVM through the same bridge, although withdrawals take about 5.5 days because of the optimistic challenge period.",
      ],
      [
        "How much HYPE do I need for gas on Elysium?",
        "Only a small amount. Gas costs on Elysium are very low, but every transaction needs some HYPE, including selling a token or bridging out. A good habit is to keep a small HYPE reserve in your wallet after every buy, so you are never stuck holding tokens you cannot sell for lack of gas.",
      ],
      [
        "Can I pay with USDC instead of HYPE?",
        "On ArkhamPad, yes. You can bring USDC from Base, and it is converted to HYPE on the way in through a cross-chain route. You arrive on Elysium holding HYPE, which you then use for gas and trading. Tokens on Elysium are still priced and traded against HYPE.",
      ],
      [
        "What is wrapped HYPE?",
        "Wrapped HYPE is a token-standard version of HYPE that smart contracts and liquidity pools can hold like any other token. Pools on Elysium hold wrapped HYPE. When you trade through ArkhamPad, you pay plain HYPE and receive tokens, or sell tokens and receive plain HYPE, so you do not need to wrap or unwrap it yourself.",
      ],
      [
        "Why are Elysium token prices shown in HYPE?",
        "Most Elysium tokens are paired with HYPE in their pools, so HYPE is the natural unit for price and market cap. For example, ArkhamPad coins start at a market cap of 60 HYPE. The dollar value of any token also depends on the price of HYPE, so it can change even when the token's HYPE price does not.",
      ],
    ],
    related: ["bridge-hype-to-elysium", "elysium-gas-fees", "how-to-buy-elysium-tokens"],
  },
  {
    slug: "elysium-mainnet-launch",
    cat: "elysium",
    title: "Elysium Mainnet Launch: What Traders Should Know",
    desc: "Elysium mainnet launch guide for traders: the November 9, 2026 date, chain ID 99901, what is live at launch, what comes later, and how to prepare safely.",
    keywords: [
      "elysium mainnet launch",
      "elysium mainnet date",
      "when does elysium launch",
      "elysium mainnet chain id",
      "elysium airdrop",
      "is there an elysium token",
      "elysium hypercore upgrade",
      "how to prepare for elysium mainnet",
      "elysium launch day trading",
      "elysium mainnet withdrawals",
      "launch a coin on elysium mainnet",
    ],
    read: "7 min",
    short:
      "Kinetiq announced November 9, 2026 as the public mainnet launch date for Elysium, its Layer 2 for Hyperliquid (chain ID 99901). At launch, gas is paid in HYPE, one sequencer orders transactions, and official bridge withdrawals take about 5.5 days. An upgrade that connects Elysium contracts to HyperCore market data is planned for about a month later.",
    sections: [
      [
        "When does Elysium mainnet launch?",
        `Kinetiq, the team behind kHYPE and the builder of Elysium, announced November 9, 2026 as the public mainnet launch date. Elysium is a Layer 2 that settles to HyperEVM, Hyperliquid's smart contract chain. If you are new to it, start with [what is Elysium](/learn/what-is-elysium/).

The core mainnet details:

- Chain ID: 99901
- Gas token: HYPE, bridged 1:1 from HyperEVM
- Settles to: HyperEVM (chain ID 999)
- Compatibility: full EVM, so standard wallets and Solidity contracts work`,
      ],
      [
        "What is live at launch, and what comes later?",
        `Live at launch:

- Fast blocks, with a design target of 100 to 200 milliseconds, and much more block space than HyperEVM.
- HYPE as gas, with very low gas costs.
- The official Elysium bridge. Deposits arrive within seconds to a few minutes. Withdrawals take about 5.5 days.
- A single sequencer that orders transactions by priority fee, with no public mempool.
- The delayed inbox on HyperEVM, which lets users force-include a transaction if the sequencer censors it.

Planned for later:

- An ArbOS upgrade about a month after mainnet that would let smart contracts read live HyperCore market data and route orders to HyperCore.
- Permissionless fraud proofs through Arbitrum's BoLD system. Validators are permissioned at launch.

Treat planned items as plans. Build your expectations around what is live.`,
      ],
      [
        "Is there an Elysium airdrop or token?",
        `No. There is no Elysium token and no official points program at this time. Gas is paid in HYPE.

Launches attract scammers. Expect fake "Elysium token" sales, fake claim pages and messages asking you to connect a wallet for an airdrop. Do not sign anything from a link you did not find through official channels.

One fee detail is public: half of Elysium sequencer fees are earmarked for open-market buybacks of KNTQ, the Kinetiq token.`,
      ],
      [
        "How should traders prepare for Elysium mainnet?",
        `1. **Fund your wallet early.** Deposits arrive quickly, but you do not want to be bridging while prices move. On ArkhamPad you can bridge HYPE from HyperEVM or bring USDC from Base.
2. **Keep HYPE for gas.** Never spend your full balance on a token. You need gas to sell.
3. **Plan your exit.** Withdrawals to HyperEVM through the official bridge take about 5.5 days. Only bridge what you are ready to keep on Elysium for a while.
4. **Pick a slippage setting on purpose.** ArkhamPad offers 1%, 3%, 5% (the default) or 10%. The minimum received amount protects you if the price moves before your trade lands.
5. **Check contract addresses.** Many tokens can share the same name. On the [Discover page](/) you can search by name or contract address, and each token page shows the address and creator.`,
      ],
      [
        "What happens to new tokens around launch?",
        `Expect a lot of new tokens in a short time, and most of them will be memecoins. Memecoins are highly speculative. Prices can rise and collapse within minutes, and many end close to zero. No launch period guarantees profits.

ArkhamPad's Discover page lists every HYPE-paired token on Elysium from every launchpad, with market cap, 24h change, volume, buys and sells, holders and top-10 holder share. That helps you compare tokens in one place, but data is not a recommendation.

Before you buy, check a few things:

- **Holder concentration.** If a handful of wallets hold most of the supply, they can push the price down fast. See [top 10 holders](/learn/token-holders-top-10/).
- **Liquidity.** ArkhamPad coins show an "LP locked" label because their pool liquidity can never be withdrawn. [Locked liquidity explained](/learn/locked-liquidity-explained/) covers why that matters.
- **Red flags.** Learn the common warning signs in [how to spot a rug pull](/learn/spot-a-rug-pull/).

For a broader overview, read the [Elysium memecoins guide](/learn/elysium-memecoins-guide/).`,
      ],
      [
        "Can you launch a coin on day one?",
        `Yes. On ArkhamPad you can [create a coin](/create/) in about 30 seconds with a name, ticker, image and optional description and links.

Every ArkhamPad coin has a total supply of 1,000,000,000 tokens. All of it goes into the pool at launch, with no team allocation and no presale. The starting market cap is 60 HYPE for the whole supply. The pool is a Uniswap v3 style concentrated-liquidity pool against wrapped HYPE with a 1% fee on every trade, and 30% of those fees go to the creator. The liquidity is locked forever.

You can make an optional first buy in the same transaction. A launch day is busy, so plan the first hours before you start. The [memecoin launch checklist](/learn/memecoin-launch-checklist/) walks through it.`,
      ],
      [
        "What trust assumptions apply at launch?",
        `Early mainnet has more trust in the operators than it will later. One sequencer orders transactions, and validators are permissioned. Data is held by an AnyTrust-style committee that posts compact certificates to HyperEVM, with a fallback to posting full data there.

Two safeguards help. You can force-include a transaction through the delayed inbox on HyperEVM if the sequencer censors you, and withdrawals wait through a challenge period of about 5.5 days so invalid results can be disputed. Size your positions with these facts in mind.`,
      ],
    ],
    faq: [
      [
        "What is the Elysium mainnet launch date?",
        "Kinetiq announced November 9, 2026 as the public mainnet launch date for Elysium. Elysium is a Layer 2 for the Hyperliquid ecosystem that settles to HyperEVM and uses HYPE for gas. Follow Kinetiq's official channels for any change to the schedule, and be wary of unofficial posts claiming early access.",
      ],
      [
        "What is the Elysium mainnet chain ID?",
        "The Elysium mainnet chain ID is 99901. HyperEVM, which Elysium settles to, uses chain ID 999. When adding the network to a wallet by hand, double-check the chain ID and take network details only from official sources, so you do not connect to a fake or wrong network.",
      ],
      [
        "Will there be an Elysium airdrop?",
        "There is no Elysium token and no official points program at this time. Gas is paid in HYPE, and half of sequencer fees are earmarked for open-market KNTQ buybacks. Any site offering an Elysium token, presale or airdrop claim should be treated as a likely scam unless Kinetiq announces it officially.",
      ],
      [
        "Can I withdraw from Elysium right after launch?",
        "Yes, through the official Elysium bridge. Withdrawals are optimistic, so they finalize only after a challenge period, currently about 5.5 days (around 132 hours) on mainnet. Deposits from HyperEVM, by contrast, arrive within seconds to a few minutes. ArkhamPad is working on a faster exit route, without a date yet.",
      ],
      [
        "What is the HyperCore upgrade planned for Elysium?",
        "Kinetiq plans an ArbOS upgrade about a month after mainnet. It would let smart contracts on Elysium read live HyperCore market data and route orders to HyperCore, Hyperliquid's trading engine. It is not live at launch, so apps that depend on it will only work once the upgrade ships.",
      ],
    ],
    related: ["what-is-elysium", "elysium-memecoins-guide", "spot-a-rug-pull"],
  },
  {
    slug: "elysium-gas-fees",
    cat: "elysium",
    title: "Elysium Gas Fees: What a Trade Really Costs",
    desc: "Elysium gas fees are paid in HYPE and are very low. See what a trade really costs: network fee, pool fee, router fee, price impact and slippage explained.",
    keywords: [
      "elysium gas fees",
      "how much does a trade cost on elysium",
      "elysium transaction fee",
      "why are elysium fees low",
      "elysium priority fee",
      "arkhampad router fee",
      "memecoin pool fee 1%",
      "price impact vs slippage",
      "why did my elysium transaction fail",
      "how to reduce trading costs crypto",
      "token transfer tax",
    ],
    read: "7 min",
    short:
      "Elysium gas fees are paid in HYPE and are very low, so the network fee is rarely the biggest cost of a trade. The larger costs are usually the pool fee (1% on ArkhamPad coins), any router fee (0.5% for tokens launched elsewhere, none for ArkhamPad coins) and price impact. Always keep a little HYPE for gas.",
    sections: [
      [
        "How do gas fees work on Elysium?",
        `Gas is the fee you pay the network to process a transaction. On Elysium, gas is paid in HYPE, the same token used for gas on HyperEVM. It is taken from your wallet balance each time you buy, sell, approve a token, create a coin or bridge.

Elysium is an Arbitrum Orbit chain, so gas works the way it does on other EVM networks. A simple transfer uses less gas than a swap through a pool, and a busy network can push fees up a little. At launch, one sequencer orders transactions by priority fee, so a higher priority fee can place your transaction earlier.

You do not need a separate token for gas. If you hold HYPE on Elysium, you can pay fees. For how HYPE gets onto Elysium, read [HYPE on Elysium](/learn/hype-on-elysium/).`,
      ],
      [
        "Why are Elysium gas fees so low?",
        `Two design choices keep costs down.

- **More block space.** Hyperliquid keeps HyperEVM blocks small on purpose. Elysium was built to give trading apps, launchpads and AMMs much more room, with fast blocks and high throughput. More room means less competition for each slot.
- **Compact settlement.** Elysium does not post all its data to HyperEVM in normal operation. An AnyTrust-style committee stores the full data and posts compact certificates to HyperEVM, which keeps settlement costs small.

The result is that gas costs on Elysium are very low. Exact numbers change with demand, so check the estimate in your wallet before you confirm.`,
      ],
      [
        "What else do you pay when you trade on Elysium?",
        `Gas is only one line. A full trade can include:

- **Network fee (gas).** Very low, paid in HYPE.
- **Pool fee.** Charged by the liquidity pool on every trade. ArkhamPad coins use a 1% pool fee. Tokens from other launchpads trade in pools with their own fee settings.
- **Router fee.** Trades through the ArkhamPad router of tokens launched elsewhere carry a small 0.5% fee. ArkhamPad coins pay no router fee.
- **Price impact.** The price moves against you as your trade eats into the pool. Larger trades in smaller pools pay more.
- **Token tax.** Some tokens charge their own transfer tax. Those may not be sellable through the router at all.

On ArkhamPad coins, the 1% pool fee is shared: 30% goes to the coin's creator and 70% to ArkhamPad, paid out in HYPE and in the coin.`,
      ],
      [
        "Example: what does a trade really cost?",
        `Say you buy an ArkhamPad coin with 10 HYPE.

- Pool fee: 1% of the trade, about 0.1 HYPE.
- Router fee: none, because it is an ArkhamPad coin.
- Gas: a very small amount of HYPE.
- Price impact: depends on your trade size compared with the pool.

Now say you buy a token launched elsewhere with the same 10 HYPE through the ArkhamPad router. You pay the 0.5% router fee, about 0.05 HYPE, plus whatever fee that token's pool charges, plus gas and price impact.

Remember that fees apply on the way out too. A buy followed by a sell pays the pool fee twice. Before confirming, check the quote and the minimum received amount shown in the buy or sell box.`,
      ],
      [
        "Price impact and slippage: the costs people miss",
        `Price impact is the move your own trade causes. Small memecoins often have thin liquidity near the current price, so a large buy can push the price up noticeably before your order completes. Comparing your trade size with the token's market cap and volume helps you judge this. [Market cap vs price](/learn/market-cap-vs-price/) explains why market cap is the better number to watch.

Slippage tolerance is different. It is the maximum extra price change you accept between the quote and the moment your trade lands. ArkhamPad lets you choose 1%, 3%, 5% (the default) or 10%. If the price moves beyond your setting, the trade fails instead of filling at a worse price. A failed transaction still uses a little gas. [Slippage explained](/learn/slippage-explained/) covers which setting to use and when.`,
      ],
      [
        "How can you keep trading costs down?",
        `- **Size trades to the pool.** Check volume and recent candles before buying. [How to read a memecoin chart](/learn/how-to-read-a-memecoin-chart/) shows what to look for.
- **Trade less often.** Every round trip pays pool fees twice. Frequent small flips add up.
- **Use a sensible slippage setting.** Too low and trades fail. Too high and you may fill at a poor price.
- **Watch for token taxes.** A token with its own transfer tax can cost far more than the fees above, and may be impossible to sell through the router.
- **Keep a HYPE reserve.** Running out of gas can leave you holding a token you cannot sell until you add HYPE.

For the full buy and sell flow on ArkhamPad, see [how to buy Elysium tokens](/learn/how-to-buy-elysium-tokens/).`,
      ],
      [
        "Do bridging and withdrawals cost gas?",
        `Yes. Bridging HYPE from HyperEVM to Elysium involves a transaction on HyperEVM, which pays gas in HYPE there. Withdrawing back through the official bridge involves transactions too, and the funds finalize after a challenge period of about 5.5 days.

If you bring USDC from Base through ArkhamPad, it is converted to HYPE on the way in through a cross-chain route. The route has its own costs, so review what you will receive before you confirm.`,
      ],
    ],
    faq: [
      [
        "What token pays gas on Elysium?",
        "HYPE, Hyperliquid's native token. It is bridged 1:1 from HyperEVM through the official Elysium bridge, so you do not need a separate gas token. Gas is taken from your HYPE balance for every transaction, including buying, selling, approving tokens, creating a coin and bridging out.",
      ],
      [
        "Why did my Elysium transaction fail if gas is so cheap?",
        "Common reasons are running out of HYPE for gas, the price moving beyond your slippage setting, or a token with its own transfer tax that the router cannot sell. Add a small amount of HYPE, try a slightly higher slippage setting, or check the token page for unusual behavior before trying again.",
      ],
      [
        "Do ArkhamPad coins pay a router fee?",
        "No. ArkhamPad coins pay no router fee. Tokens launched elsewhere and traded through the ArkhamPad router carry a small 0.5% router fee. ArkhamPad coins do pay their 1% pool fee on every trade, which is split 30% to the coin's creator and 70% to ArkhamPad.",
      ],
      [
        "Who receives the 1% pool fee on ArkhamPad coins?",
        "The 1% pool fee on every ArkhamPad coin trade is split between the coin's creator and ArkhamPad. The creator receives 30% and ArkhamPad receives 70%. Fees are collected from the pool and paid out in HYPE and in the coin itself, so creator earnings depend on how much the coin is traded.",
      ],
      [
        "Are Elysium gas fees lower than HyperEVM gas fees?",
        "Elysium was built to give trading apps much more block space than HyperEVM, which keeps its blocks small on purpose, and gas costs on Elysium are very low. Exact fees on either chain change with demand, so compare the estimate your wallet shows at the time you trade rather than relying on fixed numbers.",
      ],
    ],
    related: ["hype-on-elysium", "slippage-explained", "how-to-buy-elysium-tokens"],
  },
];
