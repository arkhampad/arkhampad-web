import type { Post } from "./types";

export const part2: Post[] = [
  {
    slug: "bridge-hype-to-elysium",
    cat: "money",
    title: "How to Bridge HYPE to Elysium from HyperEVM",
    desc: "Bridge HYPE to Elysium from HyperEVM step by step: what you need first, how the official bridge works, how long deposits take and how much HYPE to keep for gas.",
    keywords: [
      "bridge hype to elysium",
      "how to bridge hype from hyperevm",
      "elysium bridge",
      "official elysium bridge",
      "how long does an elysium deposit take",
      "move hype to elysium",
      "hyperevm to elysium",
      "elysium chain id 99901",
      "add elysium network to wallet",
      "is bridging hype 1:1",
      "hype gas on elysium",
    ],
    read: "7 min",
    short:
      "To bridge HYPE to Elysium, hold HYPE on HyperEVM, open the official Elysium bridge (on ArkhamPad it is the Bridge page), choose HYPE, enter an amount and confirm. HYPE moves 1:1 and deposits usually arrive within seconds to a few minutes. Keep a little HYPE on Elysium afterwards, because it is also the gas token.",
    sections: [
      [
        "What does bridging HYPE to Elysium mean?",
        `Elysium is a Layer 2 for the Hyperliquid ecosystem, built by Kinetiq. It is a separate chain that settles to HyperEVM, so tokens do not appear on it automatically. Bridging is the process of moving HYPE from HyperEVM onto Elysium so you can use it there.

The official bridge works by locking your HYPE on HyperEVM and crediting the same amount on Elysium. The rate is 1:1: bridge 10 HYPE and you receive 10 HYPE on Elysium, minus only the small network fee for the transaction itself. No new token is created and there is nothing to swap.

If you are new to the chain, [What is Elysium?](/learn/what-is-elysium/) covers the basics in a few minutes.`,
      ],
      [
        "What you need before you bridge",
        `Check three things before you start:

- **HYPE on HyperEVM.** HyperEVM is Hyperliquid's EVM chain (chain ID 999). The bridge moves HYPE from there. If your HYPE is somewhere else, move it to your HyperEVM address first.
- **A wallet.** Any normal EVM wallet such as MetaMask works, because Elysium is fully EVM compatible. On ArkhamPad you can also log in with email or Google and get an embedded wallet created for you.
- **A little extra HYPE for gas.** The deposit transaction on HyperEVM costs a small fee in HYPE, so do not try to bridge your exact full balance.

If you do not hold HYPE at all but have USDC on Base, you can skip this guide. ArkhamPad can take USDC and convert it to HYPE on the way in, which is explained in [How to buy Elysium tokens with USDC](/learn/buy-elysium-tokens-with-usdc/).`,
      ],
      [
        "How to bridge HYPE to Elysium on ArkhamPad",
        `ArkhamPad's [Bridge page](/bridge/) uses the official Elysium bridge, so you do not need a separate site. The flow is:

1. Log in to ArkhamPad with email, Google or your existing wallet.
2. Open the Bridge page.
3. Choose HYPE as the asset you want to add.
4. Enter the amount you want to move, leaving some HYPE behind on HyperEVM for the transaction fee.
5. Review the details and confirm. If you use your own wallet, approve the transaction when it asks.

That is all. Once the deposit lands, your HYPE balance on Elysium updates and you can start trading or create a coin. If you would rather see where your HYPE can go first, the [Discover page](/) lists every HYPE-paired token on Elysium.`,
      ],
      [
        "How long does an Elysium deposit take?",
        `Deposits from HyperEVM to Elysium usually arrive within seconds to a few minutes. The bridge has to see your transaction confirmed on HyperEVM and then credit it on Elysium, so it is not literally instant, but it is quick.

If your balance has not updated after a few minutes, check these before doing anything else:

- Confirm that the transaction actually succeeded on HyperEVM in your wallet history.
- Make sure you are looking at the same address on Elysium that sent the deposit.
- Refresh the page or reconnect your wallet so the balance is read again.

Do not send the same deposit twice just because the balance looks slow. That only moves twice the amount.`,
      ],
      [
        "Adding the Elysium network to your wallet",
        `If you log in to ArkhamPad with email or Google, the embedded wallet already knows the network and you can skip this step.

If you use your own wallet, it needs the Elysium network. The mainnet chain ID is **99901**. Many apps prompt your wallet to add or switch networks automatically when you connect. If yours does not, add the network through your wallet's network settings using the details published by the Elysium team, and double-check the chain ID before you approve anything.

Because Elysium runs the standard Arbitrum Nitro stack, the wallet experience is the same as on any other EVM chain. Addresses are the same format, and your HyperEVM address is also your address on Elysium. There is no separate account to create.`,
      ],
      [
        "How much HYPE should you bridge?",
        `There is no minimum that fits everyone, but two points help you decide.

First, HYPE does two jobs on Elysium. It pays for gas, and it is the currency you trade with, since tokens on ArkhamPad are paired with HYPE. When you buy a token you pay HYPE, and when you sell you receive HYPE. So bridge enough to cover the trades you plan, plus a small buffer for network fees. Gas on Elysium is very low, but a wallet with zero HYPE cannot send any transaction at all. [Elysium gas fees](/learn/elysium-gas-fees/) explains what a trade costs in practice.

Second, think about the way back before you bridge. Deposits are fast, but withdrawals through the official bridge are optimistic and take about 5.5 days to finalize. Bridge only what you are comfortable keeping on Elysium for at least that long. The reasons are covered in [Elysium withdrawal time](/learn/elysium-withdrawal-time/).

Memecoins are risky and prices can fall to near zero quickly. Only bridge an amount you can afford to lose.`,
      ],
      [
        "What to do after your HYPE arrives",
        `With HYPE on Elysium you can:

- Browse every HYPE-paired token on the [Discover page](/), with market cap, volume, holders and live trades.
- Buy or sell any Elysium token from its token page, following [How to buy and sell Elysium tokens](/learn/how-to-buy-elysium-tokens/).
- Launch your own coin from the [create page](/create/) in about 30 seconds.

To understand the many roles HYPE plays on the chain, read [HYPE on Elysium](/learn/hype-on-elysium/).`,
      ],
    ],
    faq: [
      [
        "Is bridging HYPE to Elysium 1:1?",
        "Yes. The official bridge locks HYPE on HyperEVM and credits the same amount of HYPE on Elysium. You only pay the small network fee for the deposit transaction. There is no conversion, no new token and no exchange rate to worry about, because HYPE is the native gas token on both sides.",
      ],
      [
        "How long does it take to bridge HYPE to Elysium?",
        "Deposits from HyperEVM to Elysium usually arrive within seconds to a few minutes. If your balance has not updated after that, check that the HyperEVM transaction succeeded, that you are viewing the same address on Elysium, and refresh the page before trying anything else.",
      ],
      [
        "Can I bridge HYPE back from Elysium to HyperEVM quickly?",
        "Not through the official bridge. Withdrawals are optimistic and finalize after a challenge period of about 5.5 days, roughly 132 hours. ArkhamPad is working on a faster exit route, but there is no date for it yet, so plan for the standard withdrawal time.",
      ],
      [
        "Do I need a new wallet for Elysium?",
        "No. Elysium is a full EVM chain, so wallets such as MetaMask work unchanged and your address is the same as on HyperEVM. You only need to add the Elysium network, chain ID 99901. If you log in to ArkhamPad with email or Google, an embedded wallet is created for you.",
      ],
      [
        "What is the Elysium chain ID?",
        "The Elysium mainnet chain ID is 99901. HyperEVM, the chain Elysium settles to, uses chain ID 999. Always check the chain ID in your wallet before approving a network change or a bridge transaction.",
      ],
    ],
    related: ["hype-on-elysium", "elysium-withdrawal-time", "how-to-buy-elysium-tokens"],
  },
  {
    slug: "buy-elysium-tokens-with-usdc",
    cat: "money",
    title: "How to Buy Elysium Tokens with USDC from Base",
    desc: "Buy Elysium tokens with USDC from Base on ArkhamPad. USDC is converted to HYPE on the way in, so you arrive ready to trade. Steps, costs and risks explained.",
    keywords: [
      "buy elysium tokens with usdc",
      "usdc to elysium",
      "bridge usdc from base to elysium",
      "buy elysium memecoins with usdc",
      "do i need hype to trade on elysium",
      "usdc to hype on elysium",
      "how to fund an elysium wallet",
      "elysium without hype",
      "buy hyperliquid ecosystem tokens with usdc",
      "pay with usdc on arkhampad",
    ],
    read: "7 min",
    short:
      "You can buy Elysium tokens with USDC by sending USDC from Base through ArkhamPad's Bridge page. The USDC is converted to HYPE on the way in through a cross-chain route, so you arrive on Elysium holding HYPE, which you then use to buy any token. You do not need to own HYPE beforehand.",
    sections: [
      [
        "Can you buy Elysium tokens with USDC?",
        `Yes, with one detail worth understanding. Tokens on Elysium trade against HYPE, Hyperliquid's native token. On ArkhamPad you pay HYPE to buy a token and receive HYPE when you sell. HYPE is also the gas token that pays network fees on Elysium.

So USDC is not used directly inside a trade. Instead, ArkhamPad lets you start with USDC on Base and converts it to HYPE as it travels to Elysium. You arrive with HYPE, ready to trade, without having to buy HYPE on another platform first.

This makes USDC the easiest starting point if your stablecoins already sit on Base and you have never held HYPE.`,
      ],
      [
        "How the USDC route works",
        `When you choose USDC on the Bridge page, three things happen in one flow:

- Your USDC leaves your address on Base.
- A cross-chain route carries the value over and converts it to HYPE along the way.
- HYPE lands at your address on Elysium.

You do not manage the conversion yourself and you do not need a separate account somewhere else. The result is the same as if you had bridged HYPE, which the [HYPE bridging guide](/learn/bridge-hype-to-elysium/) describes, just with a different starting asset.

Because a conversion is involved, the amount of HYPE you receive depends on the HYPE price at that moment and on the cost of the route. Review what you will receive before you confirm.`,
      ],
      [
        "Step by step: from USDC on Base to your first token",
        `1. Log in to ArkhamPad with email, Google or an existing wallet. Email and Google logins get an embedded wallet automatically, as explained in [Trade Elysium coins with just an email](/learn/trade-crypto-with-email-login/).
2. Make sure the USDC you want to use is on Base, at the address you are using.
3. Open the [Bridge page](/bridge/) and choose USDC.
4. Enter the amount, review what you will receive in HYPE, and confirm.
5. Wait for HYPE to arrive on Elysium and your balance to update.
6. Find a token on the [Discover page](/) and buy it from its token page using the Buy/Sell box.

The last step is the same for everyone, whichever way they funded their wallet: open the token page, enter an amount, set slippage and confirm.`,
      ],
      [
        "What does it cost to use USDC?",
        `There are a few separate costs, and it helps to keep them apart:

- **The route itself.** Moving value from Base and converting it to HYPE has a cost, which is reflected in the HYPE amount you are shown before confirming.
- **Network fees.** A transaction on Base needs a small amount of ETH for gas there. On Elysium, fees are paid in HYPE and are very low.
- **Trading fees.** Once you trade, ArkhamPad coins have a 1% pool fee and no router fee. Tokens launched elsewhere carry a small 0.5% router fee on top of their own pool fee.
- **Slippage.** The price can move between the quote and the moment your trade executes. You choose a tolerance of 1%, 3%, 5% or 10%. See [Slippage explained](/learn/slippage-explained/).

Look at the received amount at each step rather than estimating, since it already reflects the current conditions.`,
      ],
      [
        "USDC or HYPE: which should you start with?",
        `Both end in the same place: HYPE on Elysium. The choice depends on what you already hold.

- **Start with HYPE** if you already have HYPE on HyperEVM. The official bridge is 1:1 and deposits arrive within seconds to a few minutes.
- **Start with USDC** if your funds are stablecoins on Base and you do not want to buy HYPE somewhere else first.

One practical point applies either way. Since you hold HYPE once you arrive, your balance moves with the HYPE price even when you are not in any trade. If you want to stay in stablecoins, that exposure is worth knowing about before you bridge. [HYPE on Elysium](/learn/hype-on-elysium/) explains its roles on the chain.`,
      ],
      [
        "Getting your funds back out",
        `Money comes back the way it is designed to: through the official Elysium bridge to HyperEVM. Withdrawals through that bridge are optimistic and take about 5.5 days to finalize. ArkhamPad is working on a faster exit route, but there is no date for it yet.

This matters for how much you bring in. Fund your wallet with an amount you are comfortable leaving on Elysium for at least a week, and read [Elysium withdrawal time](/learn/elysium-withdrawal-time/) before you move larger sums.`,
      ],
      [
        "A plain word on risk",
        `Starting with a stablecoin does not make memecoins any safer. Most memecoins lose value, some quickly. Prices can move tens of percent within minutes, and thin pools make that worse.

Before buying, check the token's holders, its top-10 holder share and whether its liquidity is locked. ArkhamPad coins show an LP locked label, because their liquidity can never be withdrawn by anyone. For the bigger picture, read [Elysium memecoins: the complete guide](/learn/elysium-memecoins-guide/). Only spend what you can afford to lose.`,
      ],
    ],
    faq: [
      [
        "Do I need HYPE to buy tokens on Elysium?",
        "You need HYPE in your Elysium wallet to trade and pay gas, but you do not need to own it beforehand. On ArkhamPad you can send USDC from Base and it is converted to HYPE on the way in, so you arrive holding HYPE and can trade straight away.",
      ],
      [
        "Which network does the USDC need to be on?",
        "ArkhamPad's USDC option takes USDC from Base. Check that your USDC is on Base and at the address you are using before you start. You will also need a small amount of ETH on Base to pay the network fee for sending it.",
      ],
      [
        "Will I receive USDC on Elysium?",
        "No. The USDC is converted to HYPE during the transfer, so you receive HYPE on Elysium. That is what you need, because tokens on ArkhamPad trade against HYPE and network fees on Elysium are paid in HYPE.",
      ],
      [
        "How much HYPE will I get for my USDC?",
        "It depends on the HYPE price at the time and on the cost of the cross-chain route. ArkhamPad shows the amount before you confirm, so review it at that point rather than estimating in advance. Prices move, so the figure can change between quotes.",
      ],
      [
        "Can I withdraw back to USDC?",
        "Withdrawals from Elysium go through the official bridge to HyperEVM and take about 5.5 days to finalize. What you do with your HYPE after that is up to you. A faster exit route is being worked on, but there is no confirmed date yet.",
      ],
    ],
    related: ["trade-crypto-with-email-login", "how-to-buy-elysium-tokens", "elysium-withdrawal-time"],
  },
  {
    slug: "elysium-withdrawal-time",
    cat: "money",
    title: "Elysium Withdrawal Time: Why the Bridge Takes 5.5 Days",
    desc: "Elysium withdrawal time explained: why the official bridge takes about 5.5 days to HyperEVM, what the challenge period protects, and how to plan your exits.",
    keywords: [
      "elysium withdrawal time",
      "how long does an elysium withdrawal take",
      "elysium bridge withdrawal",
      "withdraw from elysium to hyperevm",
      "why are layer 2 withdrawals slow",
      "optimistic rollup challenge period",
      "elysium challenge period",
      "elysium 5.5 days",
      "faster elysium withdrawal",
      "elysium deposit vs withdrawal time",
      "can elysium withdrawals be censored",
    ],
    read: "7 min",
    short:
      "Withdrawals from Elysium to HyperEVM through the official bridge take about 5.5 days, around 132 hours. Elysium is an optimistic Layer 2, so every withdrawal waits out a challenge period during which anyone allowed to check the chain can dispute an invalid state. Deposits in the other direction arrive within seconds to a few minutes.",
    sections: [
      [
        "How long does an Elysium withdrawal take?",
        `On Elysium mainnet, a withdrawal through the official bridge back to HyperEVM currently takes about **5.5 days**, roughly 132 hours, before it can be finalized.

Deposits are very different. Moving HYPE from HyperEVM to Elysium usually takes seconds to a few minutes. The gap between the two directions surprises many people, so it is worth knowing the reason before you bridge funds in. The deposit flow is covered in [How to bridge HYPE to Elysium](/learn/bridge-hype-to-elysium/).`,
      ],
      [
        "Why do Elysium withdrawals take so long?",
        `Elysium is an Arbitrum Orbit chain, which makes it an optimistic Layer 2. Optimistic means the chain does not prove every block is correct as it goes. Instead, it posts its results to HyperEVM and assumes they are correct unless someone shows otherwise.

To make that safe, there is a waiting window called the **challenge period**. During it, a validator that spots an invalid result can dispute it, and the dispute is settled on HyperEVM. Only after the window closes without a successful challenge is the result treated as final.

A withdrawal is a claim that you own funds on Elysium and want them released on HyperEVM. That claim can only be honored once the state it depends on is final. So every withdrawal through the official bridge waits for the challenge period, whatever its size.

Deposits do not need this wait. They start on HyperEVM, which is already final, so Elysium can credit them almost right away. [Elysium vs HyperEVM](/learn/elysium-vs-hyperevm/) explains how the two chains relate.`,
      ],
      [
        "Who checks the chain during the challenge period?",
        `At launch, Elysium's validators are permissioned, meaning a known set of parties run them. Permissionless fraud proofs, using Arbitrum's BoLD system, are planned for later. With BoLD, anyone would be able to challenge an invalid state, which strengthens the security model the waiting period is there to support.

Elysium also has one sequencer at launch. The sequencer orders transactions by priority fee, and there is no public mempool. If the sequencer ever refused to include your transaction, you can force-include it through the delayed inbox on HyperEVM. That path matters for withdrawals in particular, because it means a withdrawal cannot simply be blocked forever by the sequencer.

For more on how the chain is built and run, read [What is Elysium?](/learn/what-is-elysium/).`,
      ],
      [
        "What happens during a withdrawal, step by step",
        `In broad terms, an official bridge withdrawal goes through these stages:

1. You start the withdrawal on Elysium. Your HYPE leaves your Elysium balance.
2. The withdrawal is included in a batch that is posted to HyperEVM.
3. The challenge period runs, currently about 5.5 days.
4. Once it ends, the withdrawal can be finalized and the HYPE is released on HyperEVM.

During the wait, the funds are in neither balance you can spend from. They are not lost, they are in transit. Keep a record of the transaction so you can follow it.`,
      ],
      [
        "Is there a faster way to withdraw from Elysium?",
        `Not through the official bridge. The challenge period is part of how an optimistic Layer 2 stays secure, so it is not something an app can switch off.

ArkhamPad is working on a faster exit route for its users. There is no release date yet, so do not plan around it. Until it is live, treat 5.5 days as the time it takes to get funds back to HyperEVM.

Be careful with anyone offering instant withdrawals through unknown sites or direct messages. Scams often target people who are waiting for funds. Only use bridges you have verified, and never share a seed phrase.`,
      ],
      [
        "How to plan around the withdrawal time",
        `A few habits make the waiting period much less of a problem:

- **Bridge in what you are comfortable leaving on Elysium for at least a week.** Fast deposits make it easy to forget the exit takes days.
- **Do not count on exiting fast in a hurry.** If you need funds by a specific date, start the withdrawal well before it.
- **Keep some HYPE on Elysium.** HYPE pays gas, and starting a withdrawal is itself a transaction.
- **Stay on-chain if you are still trading.** Selling a token for HYPE on Elysium is quick. Only the bridge back to HyperEVM is slow.

The timing is also one reason why liquidity locks matter on Elysium. On ArkhamPad coins, liquidity is held by the launcher contract and cannot be withdrawn by anyone, as explained in [Locked liquidity explained](/learn/locked-liquidity-explained/).`,
      ],
      [
        "Will the withdrawal time change after mainnet?",
        `The 5.5 day figure is the current challenge period on Elysium mainnet. Kinetiq has announced the public mainnet launch for November 9, 2026, and further upgrades are planned, including permissionless fraud proofs later on. Any change to the withdrawal window would be announced by the Elysium team, so treat 5.5 days as the working number until then. [Elysium mainnet launch](/learn/elysium-mainnet-launch/) covers what else traders should know about the launch.`,
      ],
    ],
    faq: [
      [
        "How long does it take to withdraw from Elysium to HyperEVM?",
        "About 5.5 days, roughly 132 hours, through the official bridge. Elysium is an optimistic Layer 2, so every withdrawal waits out a challenge period before it is finalized on HyperEVM. The wait is the same regardless of the amount you withdraw.",
      ],
      [
        "Why are deposits to Elysium fast but withdrawals slow?",
        "Deposits start on HyperEVM, which is already final, so Elysium can credit them within seconds to a few minutes. Withdrawals depend on Elysium's state, which only becomes final on HyperEVM after the challenge period ends without a successful dispute. That waiting window is what makes optimistic rollups secure.",
      ],
      [
        "Can I cancel or speed up an Elysium withdrawal?",
        "Through the official bridge, the challenge period cannot be skipped. ArkhamPad is working on a faster exit route for its users, but it has no release date yet. Be cautious of anyone offering instant withdrawals through unverified sites or private messages.",
      ],
      [
        "Are my funds safe during the withdrawal period?",
        "Your funds are in transit, not lost. If the sequencer ever refused to include a transaction, users can force-include it through the delayed inbox on HyperEVM. Validators are permissioned at launch, with permissionless fraud proofs planned for later. As with any bridge, some technical risk always remains.",
      ],
      [
        "Can I still trade while a withdrawal is pending?",
        "Yes, with the HYPE that remains in your Elysium wallet. The amount being withdrawn has already left your Elysium balance, so it cannot be used for trades. Keep some HYPE on Elysium for gas and any trades you still plan to make.",
      ],
    ],
    related: ["bridge-hype-to-elysium", "elysium-vs-hyperevm", "what-is-elysium"],
  },
  {
    slug: "trade-crypto-with-email-login",
    cat: "money",
    title: "Trade Crypto with Email Login: Elysium Coins Made Simple",
    desc: "Trade crypto with email login on ArkhamPad: sign in with email or Google, get an embedded wallet with no seed phrase, fund it with HYPE or USDC and trade.",
    keywords: [
      "trade crypto with email login",
      "trade crypto without a wallet extension",
      "embedded wallet crypto",
      "buy memecoins with email",
      "crypto login with google",
      "no seed phrase crypto wallet",
      "trade elysium coins with email",
      "trade without wallet pop-ups",
      "email wallet vs metamask",
      "is an embedded wallet safe",
      "create a coin with email login",
    ],
    read: "6 min",
    short:
      "On ArkhamPad you can trade Elysium coins by logging in with just an email address or a Google account. An embedded wallet is created for you, so there is no seed phrase to write down to get started, and trades are signed without wallet pop-ups. You fund it with HYPE or USDC and trade like any other user.",
    sections: [
      [
        "Can you really trade crypto with just an email?",
        `Yes. On ArkhamPad, logging in with an email address or a Google account creates an **embedded wallet** for you. It is a real on-chain wallet with its own address on Elysium. It simply lives inside the app instead of in a browser extension you had to install yourself.

From there, everything works the same as with any wallet: you fund it, buy and sell tokens, and launch coins. People who already use a wallet such as MetaMask can still connect it instead. Both options reach the same tokens and the same prices.`,
      ],
      [
        "How the embedded wallet works",
        `Traditional crypto wallets ask you to install software, write down a seed phrase (a list of recovery words) and approve every action in a pop-up. That is a lot of steps before a first trade.

With an email or Google login on ArkhamPad:

- The wallet is created automatically when you log in.
- There is no seed phrase to write down to get started.
- Trades from the embedded wallet are signed without pop-ups, so a buy or sell goes through after you confirm in the app.

The wallet has a normal address, so you can receive funds to it and see its activity on-chain like any other.`,
      ],
      [
        "Funding an email wallet",
        `A new wallet starts empty. You add funds from the [Bridge page](/bridge/) in one of two ways:

- **HYPE from HyperEVM.** The official Elysium bridge moves HYPE 1:1 and deposits usually arrive within seconds to a few minutes. See [How to bridge HYPE to Elysium](/learn/bridge-hype-to-elysium/).
- **USDC from Base.** USDC is converted to HYPE on the way in, so you arrive holding HYPE. See [How to buy Elysium tokens with USDC](/learn/buy-elysium-tokens-with-usdc/).

Either way you end up with HYPE on Elysium. HYPE is the currency tokens trade against on ArkhamPad and also pays the network fee, so keep a little spare for gas.`,
      ],
      [
        "Making your first trade",
        `Once funded, trading takes a few steps:

1. Find a token on the [Discover page](/), which lists every HYPE-paired token on Elysium. Search by name or contract address.
2. Open the token page and check its chart, holders and recent trades.
3. In the Buy/Sell box, enter how much HYPE to spend.
4. Choose a slippage tolerance, then confirm.

Because the embedded wallet signs without pop-ups, confirming in the app is the final step. That speed is useful on fast-moving tokens, but it also means you should read the quote carefully before you confirm. The full flow, including selling, is in [How to buy and sell Elysium tokens](/learn/how-to-buy-elysium-tokens/).`,
      ],
      [
        "Launching a coin with an email login",
        `The same login also works for creating a coin. You choose a name, ticker and image, add an optional description and links, and can make an optional first buy. The whole process takes about 30 seconds on the [create page](/create/), and [How to create a token on Elysium](/learn/create-a-token-on-elysium/) walks through each field.

Every ArkhamPad coin launches with a total supply of 1,000,000,000 tokens, all of it placed in the pool, and its liquidity is locked forever. As the creator, you receive 30% of the trading fees on your coin, paid to your wallet in HYPE and in the coin. [Earn creator fees](/learn/earn-creator-fees/) explains how that works, and the [memecoin launch checklist](/learn/memecoin-launch-checklist/) covers your first day after launch.`,
      ],
      [
        "Email wallet or your own wallet: which to use?",
        `Both are valid. The difference is mostly about convenience and how you prefer to manage keys.

- **Email or Google login** suits people who are new to crypto, want to try Elysium quickly, or trade often and do not want a pop-up for every action.
- **An existing wallet** suits people who already hold funds in it, use it across many apps, or prefer to control their keys through software they chose themselves.

Some people use both: a familiar wallet for long-term holdings and an email login for quick trading with a smaller balance.`,
      ],
      [
        "Keeping an email wallet safe",
        `An email login is only as secure as the email or Google account behind it. A few simple habits go a long way:

- Turn on two-factor authentication for that email or Google account.
- Use a strong, unique password that you do not reuse elsewhere.
- Never share login codes with anyone, including people claiming to be support.
- Keep only the amount you are actively trading in a hot wallet like this.

Remember too that memecoins are risky whatever wallet you use. Most lose value, and prices can drop sharply within minutes. Only trade with money you can afford to lose.`,
      ],
    ],
    faq: [
      [
        "Do I need MetaMask to trade on Elysium?",
        "No. On ArkhamPad you can log in with an email address or a Google account and an embedded wallet is created for you. If you already use MetaMask or another EVM wallet, you can connect it instead. Both options trade the same tokens at the same prices.",
      ],
      [
        "Is there a seed phrase with an email login?",
        "There is no seed phrase to write down to get started. The embedded wallet is created when you log in, and you access it through your email or Google account. That is why securing that account with a strong password and two-factor authentication matters.",
      ],
      [
        "Why are there no wallet pop-ups when I trade?",
        "Trades from ArkhamPad's embedded wallet are signed without pop-ups. You review the quote and confirm in the app, and the transaction is sent. This makes trading faster, so read the amount, slippage and minimum received carefully before you confirm.",
      ],
      [
        "How do I add money to an email wallet?",
        "Use the Bridge page. You can bridge HYPE from HyperEVM through the official Elysium bridge, or send USDC from Base, which is converted to HYPE on the way in. Either way you arrive holding HYPE, which you use for trades and gas.",
      ],
      [
        "Can I create a coin with an email login?",
        "Yes. The same login works on the create page. Choose a name, ticker and image, add optional details and an optional first buy. It takes about 30 seconds, and as the creator you receive 30% of the trading fees on your coin.",
      ],
    ],
    related: ["buy-elysium-tokens-with-usdc", "how-to-buy-elysium-tokens", "create-a-token-on-elysium"],
  },
  {
    slug: "how-to-buy-elysium-tokens",
    cat: "trade",
    title: "How to Buy Elysium Tokens and Sell Them (Step by Step)",
    desc: "How to buy Elysium tokens and sell them on ArkhamPad: fund with HYPE, find a token, read the quote, set slippage and confirm. Fees and safety checks included.",
    keywords: [
      "how to buy elysium tokens",
      "how to sell elysium tokens",
      "buy memecoins on elysium",
      "trade tokens on elysium",
      "elysium token swap",
      "arkhampad router fee",
      "what slippage should i use on elysium",
      "minimum received crypto",
      "why can't i sell a token",
      "transfer tax token cannot sell",
      "buy elysium token by contract address",
      "elysium trading fees",
    ],
    read: "8 min",
    short:
      "To buy an Elysium token, fund your wallet with HYPE, open the token's page on ArkhamPad, enter how much HYPE to spend in the Buy/Sell box, choose a slippage tolerance and confirm. Selling is the same in reverse: you enter the token amount and receive HYPE. ArkhamPad's router can trade any Elysium token from one page.",
    sections: [
      [
        "What you need before you buy",
        `Every token on ArkhamPad trades against HYPE, Hyperliquid's native token. You pay HYPE to buy and receive HYPE when you sell. HYPE also pays the network fee on Elysium. So the one thing you need is HYPE in your Elysium wallet.

- Log in with email, Google or an existing wallet. Email and Google logins get an embedded wallet automatically.
- Add HYPE through the [Bridge page](/bridge/), either by bridging HYPE from HyperEVM or by sending USDC from Base, which arrives as HYPE.
- Keep a little HYPE aside for gas so you can still sell later.`,
      ],
      [
        "Finding the right token",
        `The [Discover page](/) lists every HYPE-paired token on Elysium, from every launchpad. For each token you can see market cap, 24h change, volume, buys and sells, holders, top-10 holder share and live trades.

If you know which token you want, search by its name or contract address. Names and tickers can be copied by anyone, so the **contract address** is the reliable way to be sure you have the right token. Get it from a source you trust and compare it to the one shown on the token page.

On the token page, look at the chart, the holders list and the recent trades before you buy. [How to read a memecoin chart](/learn/how-to-read-a-memecoin-chart/) and [Market cap vs price](/learn/market-cap-vs-price/) explain what those numbers tell you.`,
      ],
      [
        "How to buy an Elysium token step by step",
        `1. Open the token page.
2. In the Buy/Sell box, choose Buy.
3. Enter the amount of HYPE you want to spend.
4. Read the quote: how many tokens you are expected to receive and the minimum you will accept.
5. Choose your slippage tolerance: 1%, 3%, 5% (the default) or 10%.
6. Confirm. With your own wallet, approve the transaction when it asks. With an embedded wallet, it is signed without a pop-up.

When the trade completes, the tokens appear in your wallet and your trade shows in the live trades list.`,
      ],
      [
        "How to sell an Elysium token",
        `Selling uses the same box:

1. Open the token page.
2. In the Buy/Sell box, choose Sell.
3. Enter how many tokens you want to sell.
4. Check the quote for the HYPE you will receive and the minimum received.
5. Choose slippage and confirm.

The HYPE lands in your Elysium wallet. From there you can buy another token, or bridge back to HyperEVM, which takes about 5.5 days through the official bridge.`,
      ],
      [
        "How ArkhamPad routes your trade",
        `Tokens on Elysium do not all live in the same kind of pool. Some use Uniswap v3 style pools and some use v4 style pools. ArkhamPad's router is a single smart contract that can trade both, so you can buy or sell any Elysium token from one page without looking up where its liquidity sits.

Fees work like this:

- **ArkhamPad coins** pay the 1% pool fee on each trade and **no router fee**.
- **Tokens launched elsewhere** carry a small 0.5% router fee, in addition to whatever fee their own pool charges.
- **Network fees** are paid in HYPE and are very low on Elysium.

One exception to know about: some tokens charge their own transfer tax, taking a cut every time they move. Those tokens may not be sellable through the router. If a sell keeps failing, a transfer tax is one possible reason, and it is a good reason to check a token's details before you buy.`,
      ],
      [
        "Choosing slippage and reading minimum received",
        `Slippage is the difference between the price you are quoted and the price you actually get. On a busy memecoin, other trades can land just before yours and move the price.

Your slippage setting is the most you will accept. The quote turns it into a **minimum received**: if the trade would give you less than that, it fails instead of filling at a worse price. A failed trade still uses a small amount of gas, but your HYPE or tokens stay in your wallet.

- **1% to 3%** suits calmer tokens with deeper pools.
- **5%**, the default, is a reasonable middle for most memecoins.
- **10%** may be needed in very fast markets, but you accept a worse fill.

[Slippage explained](/learn/slippage-explained/) goes deeper on what to set and why trades fail.`,
      ],
      [
        "Checks before you press confirm",
        `Memecoins are risky. Most lose value, and prices can fall sharply in minutes. A quick check before buying helps you avoid the worst cases:

- **Liquidity.** ArkhamPad coins show an LP locked label, meaning the pool can never be withdrawn by anyone. Tokens from elsewhere may not offer that. See [Locked liquidity explained](/learn/locked-liquidity-explained/).
- **Holder concentration.** A very high top-10 holder share means a few wallets could sell heavily. See [Token holders and top-10 concentration](/learn/token-holders-top-10/).
- **Trading pattern.** Look at buys versus sells and the live trades list for unusual activity.

[How to spot a rug pull](/learn/spot-a-rug-pull/) lists more warning signs. Nothing here is financial advice. Only spend what you can afford to lose.`,
      ],
    ],
    faq: [
      [
        "What do I pay with when buying Elysium tokens?",
        "You pay with HYPE. Every token on ArkhamPad trades against HYPE, and HYPE also pays the network fee. If you only hold USDC on Base, you can send it through the Bridge page and it is converted to HYPE on the way in.",
      ],
      [
        "Can I buy tokens that were not launched on ArkhamPad?",
        "Yes. ArkhamPad's router trades both Uniswap v3 style and v4 style pools, so you can buy or sell any HYPE-paired Elysium token from its token page. Tokens launched elsewhere carry a small 0.5% router fee. ArkhamPad coins pay no router fee.",
      ],
      [
        "What slippage should I use?",
        "The default is 5%, a reasonable middle for most memecoins. Use 1% to 3% for calmer tokens with deeper pools, and 10% only in very fast markets where trades keep failing. Higher slippage makes a fill more likely but can give you a worse price.",
      ],
      [
        "Why did my trade fail?",
        "Usually the price moved beyond your slippage setting, so the trade would have returned less than your minimum received and was cancelled. Try again or raise slippage slightly. Other causes include not enough HYPE for gas, or a token with its own transfer tax.",
      ],
      [
        "Why can't I sell a token?",
        "Some tokens charge their own transfer tax on every transfer, and those may not be sellable through the ArkhamPad router. Also check that you have a little HYPE left for gas. If a sell keeps failing, check the token's details or contact its creator.",
      ],
      [
        "How do I make sure I am buying the right token?",
        "Search by contract address rather than name, since names and tickers can be copied. Get the address from a source you trust and compare it with the one shown on the token page before you buy.",
      ],
    ],
    related: ["slippage-explained", "how-to-read-a-memecoin-chart", "spot-a-rug-pull"],
  },
];
