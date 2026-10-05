// Learn articles. Written for people first, structured for search and AI answers:
// a short "In short" answer, simple sections and a FAQ. Reading time is worked out
// from the text, so it stays right when an article changes.
export type Cat = "getting-started" | "creating" | "trading" | "safety" | "basics" | "chains";
export type Guide = { slug: string; cat: Cat; title: string; desc: string; c1: string; c2: string; short: string; sections: [string, string][]; faq: [string, string][] };

export const catLabel: Record<Cat, string> = { "getting-started": "Getting started", creating: "Creating", trading: "Trading", safety: "Safety", basics: "Crypto basics", chains: "Chains" };

const P: [string, string][] = [["#7C5CFF", "#3A2BFF"], ["#2BB3FF", "#0066FF"], ["#D4FF3A", "#5CFFB0"], ["#CCFF4D", "#5B8CFF"], ["#F5C542", "#FF7A00"], ["#FF8A3D", "#FF3D7F"], ["#3DDC97", "#00B37E"], ["#5AD1C4", "#0E9F8E"], ["#8FB3FF", "#4060FF"], ["#B57BFF", "#6A3BFF"], ["#FF6B6B", "#E0245E"], ["#E8559A", "#8A2BE2"], ["#C9A27A", "#A06A3B"], ["#69D36E", "#2FA84F"]];

type Raw = Omit<Guide, "c1" | "c2">;
const raw: Raw[] = [
  // ---------------- Getting started ----------------
  {
    slug: "what-is-arkhampad", cat: "getting-started", title: "What is ArkhamPad?", desc: "The AI launchpad for creating and trading coins with USDC.",
    short: "ArkhamPad is a launchpad where anyone can create a coin by describing it in one sentence, and trade thousands of coins on Robinhood Chain and Base using only USDC.",
    sections: [
      ["What you can do", "Create a coin with AI in about a minute, buy and sell coins with one tap, follow top traders and copy their buys, set alerts and automatic take profit or stop loss orders."],
      ["Why USDC only", "You always see your balance in dollars. You deposit USDC, trade in USDC and withdraw USDC. There is no gas token to buy and no bridge to use."],
      ["Who it is for", "New creators who want a coin without code, and traders who want a fast, simple place to find new coins and coins from other DEXs in one list."],
    ],
    faq: [["Do I need a crypto wallet?", "No. You can log in with Google, email or X and a secure wallet is created for you. You can also connect your own wallet."], ["Which chains are supported?", "Robinhood Chain and Base. When you create a coin you pick one of them."]],
  },
  {
    slug: "deposit-and-withdraw-usdc", cat: "getting-started", title: "How to deposit and withdraw USDC", desc: "Add money from any wallet or exchange and cash out anytime.",
    short: "Open Deposit, pick the network, and send only USDC to the address shown. It arrives in about a minute. To withdraw, enter an amount and an address, then confirm.",
    sections: [
      ["Depositing", "Tap Deposit, choose the network, then copy the address or scan the QR code from your wallet or exchange. Send only USDC. Your cash balance updates automatically."],
      ["Withdrawing", "Tap Withdraw, enter the amount or tap MAX, choose the network and paste the address. Check it twice. Blockchain transfers cannot be reversed."],
      ["Sending to an exchange", "Make sure the exchange supports USDC on the network you pick. If you are unsure, send a small test amount first."],
    ],
    faq: [["What happens if I send another coin?", "Coins other than USDC, or USDC on an unsupported network, can be lost. Always send USDC on the network shown."], ["How long does a withdrawal take?", "Usually under a minute, depending on the network."]],
  },
  {
    slug: "how-to-sign-up", cat: "getting-started", title: "Sign up with Google, email, X or a wallet", desc: "Pick the login you already use. No seed phrase needed.",
    short: "Tap Log in and choose Google, email, X or your own wallet. If you don't connect a wallet, a secure one is created for your account automatically, so you can start in seconds.",
    sections: [
      ["Which login to choose", "Use the account you are least likely to lose. Google and email are the easiest for most people. X is handy if you already share coins there. Connect a wallet if you prefer to manage your own keys."],
      ["What happens after you log in", "You get one account with one cash balance. On testnet you can tap Get test USDC to receive free test money and try everything without risk."],
      ["Using more than one device", "Log in with the same method on your phone and computer and you will see the same balance, coins and alerts."],
    ],
    faq: [["Do I need to write down a seed phrase?", "Not when you log in with Google, email or X. If you connect your own wallet, keep that wallet's recovery phrase safe as usual."], ["Can I change my login method later?", "Keep using the method you signed up with. A different method creates a different account and a different balance."]],
  },
  {
    slug: "testnet-explained", cat: "getting-started", title: "ArkhamPad testnet: try everything for free", desc: "What testnet is, why the money is not real and how to start.",
    short: "Testnet is a full copy of ArkhamPad that runs on test networks with test USDC. Everything works the same way as the real thing, but nothing has any value, so you can learn with zero risk.",
    sections: [
      ["Why there is a testnet", "It lets everyone try creating and trading before real money is involved, and it lets us test every feature under real load."],
      ["How to get test USDC", "Log in and tap Get test USDC. Your balance is topped up in a few seconds. You can use it to launch coins, buy, sell and set orders."],
      ["What carries over to mainnet", "Test coins and test balances stay on testnet. Your account, login and what you have learned come with you."],
    ],
    faq: [["Can I withdraw test USDC to an exchange?", "No. Test USDC only exists on test networks and has no value."], ["Is everything on testnet the same as mainnet?", "Almost. A few features that need real markets, such as trading coins from other DEXs, open with mainnet."]],
  },
  {
    slug: "first-trade", cat: "getting-started", title: "Your first trade in under a minute", desc: "Find a coin, tap Buy, and watch it in your profile.",
    short: "Open Discover, tap a coin, type an amount in USDC and tap Buy. The coins appear in your profile right away, and you can sell them back with one tap at any time.",
    sections: [
      ["Pick a coin", "Discover shows coins that are hot right now, coins that are almost graduating and a full list you can sort. Tap any coin to see its chart, holders and comments."],
      ["Buy", "Enter how many dollars you want to spend, or tap a preset amount, then tap Buy. The trade usually confirms in a couple of seconds."],
      ["Sell", "Open the coin again, switch to Sell, choose a share such as 50% or 100% and confirm. The USDC goes back to your cash balance."],
    ],
    faq: [["What is the smallest trade?", "Very small amounts work, but start with an amount you are comfortable losing completely, because meme coins are very risky."], ["Where do I see what I own?", "On your Profile, under your holdings."]],
  },
  {
    slug: "one-cash-balance", cat: "getting-started", title: "One cash balance for every chain", desc: "Why you see a single dollar figure instead of one per chain.",
    short: "ArkhamPad shows one total cash balance in USDC, even though coins live on different chains. You don't need to think about which chain your money is on before you trade.",
    sections: [
      ["Why one balance", "Splitting money across chains is confusing and leads to failed trades. One figure is easier: if you have the cash, you can buy."],
      ["What happens behind the scenes", "Your USDC sits on the supported networks. When you trade, the site uses the balance on the coin's chain."],
      ["Network costs", "You never need ETH or another gas token. Network costs are covered from your USDC balance."],
    ],
    faq: [["Can I still choose a network when I withdraw?", "Yes. You pick the network on the Withdraw screen."]],
  },
  {
    slug: "trade-without-gas-token", cat: "getting-started", title: "Trade without holding ETH for gas", desc: "Why you only ever need USDC on ArkhamPad.",
    short: "On most chains you need the network's own coin, like ETH, to pay for every transaction. On ArkhamPad you don't. Trades are sent for you and network costs come out of your USDC.",
    sections: [
      ["The usual problem", "Many people buy USDC, send it to a new chain and then cannot trade because they have no ETH for gas. They have to buy a second coin just to move the first one."],
      ["How ArkhamPad solves it", "Your trade is signed by you and sent to the network for you. You never need a second token in your wallet."],
      ["What you need", "Only USDC. Deposit it, trade with it and withdraw it."],
    ],
    faq: [["Do I need ETH to withdraw?", "No. Withdrawals also only use USDC."]],
  },
  {
    slug: "add-to-home-screen", cat: "getting-started", title: "Add ArkhamPad to your home screen", desc: "Open it like an app on iPhone and Android, with push alerts.",
    short: "You don't need an app store. Add the site to your home screen and it opens full screen like an app, and you can get push alerts on your phone.",
    sections: [
      ["iPhone", "Open arkhampad.com in Safari, tap the Share button, then tap Add to Home Screen."],
      ["Android", "Open arkhampad.com in Chrome, tap the menu, then tap Add to Home screen or Install app. ArkhamPad also shows a prompt you can tap."],
      ["Turn on alerts", "Open Alerts and allow notifications. You'll get a push when a coin hits your price or a trader you follow buys."],
    ],
    faq: [["Is there an app in the App Store or Google Play?", "Not right now. The home screen version is the fastest way to use ArkhamPad on a phone."], ["Do push alerts work on iPhone?", "Yes, after you add ArkhamPad to your home screen and allow notifications."]],
  },
  {
    slug: "pump-fun-alternative", cat: "getting-started", title: "A simple pump.fun alternative with USDC", desc: "Fair launches on a bonding curve, priced and traded in dollars.",
    short: "If you know pump.fun, ArkhamPad will feel familiar: anyone can launch a coin on a bonding curve and it graduates to a public pool. The differences are that everything is in USDC, AI helps you create, and coins live on Robinhood Chain and Base.",
    sections: [
      ["What is the same", "Fair launch with no presale, a bonding curve that sets the price, and graduation to a public pool once enough people have bought."],
      ["What is different", "You only use USDC, so your balance and every price are in dollars. AI turns one sentence into a ready coin. You can log in with Google, email or X instead of installing a wallet."],
      ["More than a launchpad", "Discover also lists thousands of coins from other DEXs, and you get take profit, stop loss, alerts and copy trading in the same place."],
    ],
    faq: [["Do I need Solana?", "No. ArkhamPad runs on Robinhood Chain and Base."], ["Is launching free?", "Yes. Creating a coin is free."]],
  },
  // ---------------- Creating ----------------
  {
    slug: "create-a-coin-with-ai", cat: "creating", title: "Create a coin with AI in 60 seconds", desc: "Write one sentence in any language, get a ready coin.",
    short: "Open Create, describe your idea in one sentence in any language, pick one of the three AI suggestions, choose a chain and tap Launch. Launching is free and takes about a minute.",
    sections: [
      ["What you need", "An ArkhamPad account. Log in with Google, email, X or your own wallet. You do not need any USDC unless you want to be the first buyer."],
      ["Step by step", "Write your idea, for example a frog astronaut who only buys the dip. AI suggests three coins with a name, ticker, story and image. Edit anything, pick Robinhood Chain or Base, set a creator lock if you want, then tap Launch."],
      ["Tips for a better coin", "Keep the name short and easy to say. A clear image and a one line story help people remember it. Share it right after launch with the ready post and contract address."],
    ],
    faq: [["Can I write my idea in my own language?", "Yes. AI understands any language and creates the coin in English so it reaches everyone."], ["Does it cost anything to launch?", "No. Launching is free. You only pay if you choose to buy or promote your coin."], ["Can I use my own image?", "Yes. Tap Upload my own image instead of using the AI image."]],
  },
  {
    slug: "how-to-launch-a-meme-coin", cat: "creating", title: "How to launch a meme coin, step by step", desc: "From idea to live coin without writing a line of code.",
    short: "To launch a meme coin you need an idea, a name, a ticker and an image. On ArkhamPad you type the idea, AI fills in the rest, you pick a chain and tap Launch. The coin is live and tradable at once.",
    sections: [
      ["1. Start with a clear idea", "The best coins are easy to explain in one line: a character, a joke, a moment people already talk about. If you can't say it in a sentence, buyers won't remember it."],
      ["2. Let AI draft the coin", "Open Create and describe the idea. You get three options with a name, ticker, description and image. Mix and edit until it feels right."],
      ["3. Choose a chain and settings", "Pick Robinhood Chain or Base, decide on a creator lock and choose where creator fees go: to you, or into buyback and burn."],
      ["4. Launch and share", "Tap Launch. Right after, you get a ready post with the contract address and share buttons for X, Telegram and WhatsApp."],
    ],
    faq: [["Do I need to know how to code?", "No. The coin contract is created for you."], ["How long does it take?", "About a minute from idea to live coin."], ["Can I change the name later?", "No. Name and ticker are fixed at launch, so check them before you tap Launch."]],
  },
  {
    slug: "meme-coin-name-and-ticker", cat: "creating", title: "How to pick a meme coin name and ticker", desc: "Short, sayable and easy to search: what works and what doesn't.",
    short: "A good meme coin name is short, easy to say out loud and easy to type into search. The ticker should be 3 to 6 letters that clearly point back to the name.",
    sections: [
      ["Names that work", "Two words at most, a clear picture in the head and no tricky spelling. If a friend can't type it after hearing it once, it's too hard."],
      ["Tickers that work", "Use letters people expect from the name. A ticker that looks random makes it harder for buyers to find your coin and easier for copycats to confuse them."],
      ["What to avoid", "Real people's names, brand names and anything hateful. They can get your coin hidden and they put buyers off."],
    ],
    faq: [["Can two coins have the same ticker?", "Yes, so always share your contract address, not just the ticker."], ["Should the ticker match the name exactly?", "It doesn't have to, but buyers find coins faster when it does."]],
  },
  {
    slug: "coin-image-tips", cat: "creating", title: "Make a coin image people remember", desc: "One bold subject, strong colours and no tiny details.",
    short: "Your coin image is shown small in lists and big on the coin page. Use one clear subject, strong colours and a simple background so it still reads at the size of a thumbnail.",
    sections: [
      ["Keep it simple", "One character or object in the middle. Busy scenes turn into a blur in a list of thousands of coins."],
      ["Use colour on purpose", "Bright, contrasting colours stand out on both dark and light mode. Avoid images that are mostly black or mostly white."],
      ["AI image or your own", "AI creates an image from your idea. You can also upload your own. Use only images you have the right to use."],
    ],
    faq: [["Can I change the image after launch?", "Yes. The creator can change the image from the coin page."], ["What size should my image be?", "A square image works best. It's shown in a circle or rounded square."]],
  },
  {
    slug: "write-a-coin-description", cat: "creating", title: "Write a coin description that sells the idea", desc: "One or two lines that make people get the joke.",
    short: "A good description explains the idea in one or two short lines. It should make a stranger smile or nod in a few seconds. Don't promise prices or profits.",
    sections: [
      ["What to say", "Who or what the coin is about, and why it's funny or interesting right now."],
      ["What not to say", "No price targets, no guaranteed gains and no claims about partnerships you don't have. They break trust and can get your coin hidden."],
      ["Add links", "If you have an X account, a Telegram group or a website for the coin, add them on Create before launch so people can find the community."],
    ],
    faq: [["Does the description have to be in English?", "AI writes it in English so it reaches everyone. You can edit it before launch."], ["Can I change it after launch?", "No. The description is saved with the coin at launch, so check it first."]],
  },
  {
    slug: "creator-lock", cat: "creating", title: "Creator lock explained", desc: "Why locking your own coins makes buyers trust you.",
    short: "A creator lock stops you from selling your own coins for 1 hour or 24 hours after launch. Buyers see a Dev locked badge, which builds trust.",
    sections: [
      ["How it works", "When you launch, choose No lock, 1 hour or 24 hours. Until the time ends, the coins you hold as the creator cannot be sold."],
      ["Why it helps", "The biggest fear of buyers is that the creator sells right away. A visible lock removes that fear for the first hours, when most buying happens."],
    ],
    faq: [["Can I unlock early?", "No. The lock is enforced by the smart contract and nobody can end it early."], ["Can I still buy more while locked?", "Yes. Only selling your own coins is blocked."]],
  },
  {
    slug: "creator-fees-vs-buyback-and-burn", cat: "creating", title: "Creator fees vs buyback and burn", desc: "Earn from every trade or use fees to burn your coin.",
    short: "Every trade pays a small creator fee. Choose To you to receive it in your balance, or Buyback and burn to use it to buy your coin and remove it from supply forever.",
    sections: [
      ["To you", "Fees collect in your account and you claim them to your cash balance whenever you like."],
      ["Buyback and burn", "Fees buy your coin from the market and burn it. Supply goes down over time, which holders usually like. The amount burned is shown on the coin page."],
    ],
    faq: [["Can I switch later?", "No. You pick the mode at launch so buyers know what to expect."]],
  },
  {
    slug: "first-buy-as-creator", cat: "creating", title: "Should you be the first buyer of your coin?", desc: "What a launch buy does, and when it helps.",
    short: "When you launch you can buy some of your own coin in the same step. It shows you believe in it and puts you first on the curve. It is optional, and you can lose that money like any buyer.",
    sections: [
      ["Why creators do it", "An early buy means the chart doesn't start empty, and it gives you a stake in the coin's success."],
      ["Keep it modest", "A creator holding a big share scares buyers away, because they worry you'll sell on them. The safety check on the coin page shows how much the creator holds."],
      ["Combine it with a lock", "A launch buy plus a creator lock tells buyers you can't dump on them in the first hours."],
    ],
    faq: [["Do I have to buy?", "No. You can launch with zero and let others buy first."], ["Can I sell my launch buy?", "Yes, unless you chose a creator lock. Then you can sell after the lock ends."]],
  },
  {
    slug: "share-your-coin", cat: "creating", title: "How to share your coin after launch", desc: "Ready posts, share images and the contract address in one tap.",
    short: "Right after launch, ArkhamPad gives you a ready post with your contract address, a share image and one-tap buttons for X, Telegram and WhatsApp. Share in the first minutes, when attention matters most.",
    sections: [
      ["Always share the contract address", "Tickers can be copied by anyone. The contract address is the only thing that points to your coin and nobody else's."],
      ["Use the coin link", "Your coin page link shows a preview card with the name, image and market cap when it's posted on X, Telegram, WhatsApp or Discord."],
      ["Keep posting", "One post is rarely enough. Share milestones like new holders, almost graduating and graduation."],
    ],
    faq: [["Where is my contract address?", "On the coin page, next to the coin name. Tap the copy button."]],
  },
  {
    slug: "grow-a-coin-community", cat: "creating", title: "Grow a community around your coin", desc: "Coins with people behind them last longer. Here's how to start.",
    short: "Coins that last have a group of people who talk about them every day. Give them a place to meet, reasons to post and a creator who shows up.",
    sections: [
      ["Pick one home", "An X account or a Telegram group is enough to start. Add the link when you create the coin so new buyers can join."],
      ["Talk to holders", "Holders can comment on the coin page. Answer questions, share plans and be honest when things go slowly."],
      ["Reward early people", "Shout out early holders and people who make memes. Attention is the best reward you can give."],
    ],
    faq: [["Who can comment on my coin?", "Everyone can read comments. Only holders can write them, which keeps spam down."]],
  },
  {
    slug: "promote-your-coin", cat: "creating", title: "Promote: put a coin in front of more traders", desc: "Get a coin featured on Discover for a few hours or a few days.",
    short: "Promote places a coin in a featured spot on Discover for the time you choose. Anyone can promote any coin, including coins from other DEXs, and it's paid from your USDC balance.",
    sections: [
      ["How to promote", "Open the coin page, tap Promote, pick a duration and confirm. The coin shows as promoted right away."],
      ["When it helps most", "Right after launch, or when a coin is close to graduating and needs a final push."],
      ["What it doesn't do", "Promote gives a coin visibility, not buyers. A good name, image and community still matter."],
    ],
    faq: [["Can I promote a coin I didn't create?", "Yes. Anyone can promote any coin."], ["Where are the prices?", "You see the price for each duration before you confirm. All prices are also listed in Help."]],
  },
  {
    slug: "how-creators-earn", cat: "creating", title: "How creators earn on ArkhamPad", desc: "Creator fees from trades, before and after graduation.",
    short: "Creators earn a share of the fees from trades in their coin, both on the bonding curve and after the coin graduates to its pool. You can take the fees as cash or use them for buyback and burn.",
    sections: [
      ["Before graduation", "Every buy and sell on the bonding curve pays a small creator fee."],
      ["After graduation", "Trades in the coin's locked pool keep paying the creator a share of the fees."],
      ["Claiming", "With To you mode, fees collect in your account. Claim them to your cash balance from your profile or the coin page."],
    ],
    faq: [["Do I earn if nobody trades?", "No. Creator fees come from trading volume."], ["Where can I see exact fees?", "All fees are listed in Help and in the Terms of Use."]],
  },
  {
    slug: "coin-links-and-image", cat: "creating", title: "Set your coin's links, story and image", desc: "What to fill in at launch, and what you can still change later.",
    short: "Add your description and your X, Telegram and website links when you create the coin, because they are saved with it at launch. After launch, the creator can still add or change the coin image from the coin page.",
    sections: [
      ["Fill it in before you launch", "On Create, add a short description and the links you control. Buyers trust coins with a real story and working links much more than empty pages."],
      ["Changing the image later", "Open your coin's page while logged in with the account that created it and tap Change coin image."],
      ["Only add links you control", "Links show on the coin page for everyone. A wrong or borrowed link is the fastest way to lose buyers' trust."],
    ],
    faq: [["Can I change the name or ticker?", "No. Name, ticker, description and links are fixed at launch. Only the image can change."], ["Why are links fixed?", "So holders can rely on what they saw when they bought."]],
  },
  {
    slug: "why-coins-dont-graduate", cat: "creating", title: "Why most meme coins never graduate", desc: "The common mistakes, and what successful launches do instead.",
    short: "Most coins never graduate because nobody hears about them in the first hour. Coins that make it usually have a clear idea, a strong image, a creator who shares straight away and a small group ready to buy.",
    sections: [
      ["The first hour decides a lot", "New coins appear in New on Discover. If a coin gets a few buyers early, it climbs into Hot and Almost graduating, where many more people see it."],
      ["Common mistakes", "Launching with no plan to share, a name nobody can spell, a creator who sells early and a copy of a coin that already exists."],
      ["What works", "A clear idea, a creator lock, sharing the contract address right away and being active in the comments."],
    ],
    faq: [["Is it bad if my coin doesn't graduate?", "It happens to most coins. Learn from it, and try again with a stronger idea."]],
  },
  // ---------------- Trading ----------------
  {
    slug: "how-to-buy-a-meme-coin", cat: "trading", title: "How to buy a meme coin with USDC", desc: "Deposit, pick a coin and buy in one tap.",
    short: "Deposit USDC, open the coin you want, type an amount in dollars and tap Buy. On ArkhamPad you don't need a gas token or a separate wallet app.",
    sections: [
      ["1. Add USDC", "Tap Deposit and send USDC on the network shown, from an exchange or another wallet. On testnet, tap Get test USDC instead."],
      ["2. Find the coin", "Use Discover, the search bar or paste a contract address. Always check the contract address if someone shared the coin with you."],
      ["3. Buy", "Enter an amount, check the estimate of coins you'll receive and tap Buy. Your coins show up in your profile."],
    ],
    faq: [["Why do I get a different number of coins than shown?", "Prices move between the estimate and the trade. Small differences are normal, especially on busy coins."], ["Can I buy with a card?", "Not directly. Buy USDC on an exchange or in your wallet app, then deposit it."]],
  },
  {
    slug: "how-to-sell-a-meme-coin", cat: "trading", title: "How to sell a coin and take profit", desc: "Sell part or all of your coins back to USDC at any time.",
    short: "Open the coin, switch to Sell, pick 25%, 50% or 100% of your coins (or type an amount) and confirm. The USDC lands in your cash balance in seconds.",
    sections: [
      ["Selling on the bonding curve", "Before graduation you sell back to the curve, so there's always someone to sell to."],
      ["Selling after graduation", "After graduation you sell into the coin's locked pool. It works the same way for you: tap Sell."],
      ["Take profit in steps", "Many traders sell part of their coins after a big rise and keep the rest. You can also set an automatic take profit."],
    ],
    faq: [["Can I always sell?", "Yes, as long as there is money in the curve or pool. The price you get depends on how much others are buying and selling."], ["Why can't the creator sell?", "If the creator chose a creator lock, they can't sell their own coins until the lock ends."]],
  },
  {
    slug: "what-is-a-bonding-curve", cat: "trading", title: "What is a bonding curve?", desc: "How the price moves as people buy and sell, simply explained.",
    short: "A bonding curve sets the price by a formula: each buy raises the price a little and each sell lowers it. There is always someone to trade with, so you can buy or sell at any time.",
    sections: [
      ["Why it is used", "New coins have no market yet. The curve acts as the market, so anyone can buy from the first second and sell back whenever they want."],
      ["What it means for you", "Early buyers get a lower price. As more people buy, the price climbs until the coin graduates."],
    ],
    faq: [["Can the creator take the money in the curve?", "No. The money stays in the contract until graduation, when it moves to a locked pool."]],
  },
  {
    slug: "what-is-graduation", cat: "trading", title: "What does graduation mean?", desc: "What happens when a coin reaches $7.5K market cap.",
    short: "A coin starts at $4.5K market cap. When it reaches $7.5K it graduates: its money moves into a trading pool that is locked forever, and trading continues there.",
    sections: [
      ["What changes after graduation", "Nothing for you as a trader. You still tap Buy and Sell. Behind the scenes the coin now trades in a public pool."],
      ["Why the pool is locked", "Nobody, including the creator and us, can remove the money from the pool. This protects holders from a rug pull."],
      ["The short pause", "While the coin moves to its pool, trading pauses for a few seconds and then reopens."],
    ],
    faq: [["How long does graduation take?", "It depends on buyers. Some coins graduate in minutes, some never do."]],
  },
  {
    slug: "almost-graduating-coins", cat: "trading", title: "Trading coins that are almost graduating", desc: "Why the Almost graduating row gets so much attention.",
    short: "Almost graduating shows coins that are close to the $7.5K market cap where they move to a locked pool. These coins often get a rush of attention, which can push the price up or down quickly.",
    sections: [
      ["Why traders watch them", "A coin near graduation has already found buyers. Many people want to be in before it reaches the pool."],
      ["The risk", "Prices can jump and fall fast around graduation. Some people sell right after the coin graduates."],
      ["Use the progress bar", "Each coin shows how far it is from graduation. The closer it gets, the faster things can move."],
    ],
    faq: [["Is a graduated coin safer?", "Its pool is locked forever, so nobody can pull the money out. The price can still fall."]],
  },
  {
    slug: "market-cap-explained", cat: "trading", title: "Market cap explained for meme coins", desc: "Why market cap tells you more than price.",
    short: "Market cap is the price of one coin times the total supply. It shows how big a coin is. Two coins with the same price can have very different market caps, so compare market caps, not prices.",
    sections: [
      ["Why not just look at price?", "A coin priced at $0.0001 isn't cheap if a billion coins exist. Market cap puts every coin on the same scale."],
      ["Market cap on ArkhamPad", "New coins start at $4.5K and graduate at $7.5K. Limit orders and alerts on ArkhamPad are set by market cap for the same reason."],
      ["Market cap vs liquidity", "Liquidity is how much money is actually there to trade against. A big market cap with little liquidity means prices move a lot on small trades."],
    ],
    faq: [["What is FDV?", "Fully diluted value: the price times every coin that can ever exist. For ArkhamPad coins the supply is fixed, so the two are the same."]],
  },
  {
    slug: "slippage-explained", cat: "trading", title: "What is slippage?", desc: "Why the price you get can differ from the price you saw.",
    short: "Slippage is the difference between the price you expected and the price you actually got. It happens because other trades land before yours or because your trade itself moves the price.",
    sections: [
      ["Why it happens", "On a bonding curve or a pool, every trade moves the price. A big buy on a small coin moves it a lot."],
      ["How ArkhamPad protects you", "Your trade includes a limit. If the price moves too far before it confirms, the trade fails and your USDC stays in your balance."],
      ["How to reduce it", "Split big trades into smaller ones, and avoid trading at the busiest moments on a very small coin."],
    ],
    faq: [["My trade failed because the price moved. Did I lose money?", "No. A failed trade doesn't spend your USDC. Try again."]],
  },
  {
    slug: "take-profit-and-stop-loss", cat: "trading", title: "Take profit and stop loss for meme coins", desc: "Let the site sell for you at the level you choose.",
    short: "Take profit sells when the price rises by the amount you choose. Stop loss sells when it falls by the amount you choose. Both run automatically, even when you are offline.",
    sections: [
      ["How to set them", "Open a coin you hold, choose Auto, pick a take profit like +100% and a stop loss like -25%, then confirm."],
      ["What you need", "You need to hold the coin first. Your orders show on your profile, where you can cancel them at any time."],
    ],
    faq: [["Is the sell price guaranteed?", "No. In fast markets the fill can be a little different from your level."], ["Do I need to keep the site open?", "No. Orders run even when you close the site."]],
  },
  {
    slug: "limit-orders", cat: "trading", title: "Limit orders: buy the dip, sell the top", desc: "Set a market cap and let the order fill on its own.",
    short: "A limit buy waits until a coin falls to the market cap you choose, then buys. A limit sell waits until it rises to your market cap, then sells. You set it once and it runs without you.",
    sections: [
      ["Setting a limit buy", "Open the coin, choose Limit, pick Buy, set a market cap below today's and the amount in USDC, then confirm."],
      ["Setting a limit sell", "Choose Limit and Sell, set a market cap above today's and how much to sell."],
      ["Managing orders", "Open orders show on your profile. Cancel any of them with one tap."],
    ],
    faq: [["Why market cap and not price?", "Meme coin prices have many zeros. Market cap is easier to read and compare."], ["Is my USDC locked while a limit buy waits?", "The order uses your balance when it fills, so keep enough USDC to cover it."]],
  },
  {
    slug: "read-a-coin-chart", cat: "trading", title: "How to read a coin chart", desc: "Candles, volume and time frames in plain words.",
    short: "Each candle shows how the price moved in a period of time. Green means it closed higher than it opened, red means lower. Volume bars underneath show how much was traded.",
    sections: [
      ["Candles", "The thick body runs from the opening to the closing price. The thin lines show the highest and lowest price in that period."],
      ["Time frames", "Switch between 1m, 5m, 15m, 1h, 4h and 1d. Short time frames show the latest moves, long ones show the trend."],
      ["Volume", "A price move on high volume means many people agree. A move on tiny volume can reverse quickly."],
    ],
    faq: [["Why does a new coin's chart look empty?", "There aren't enough trades yet. It fills in as people trade."]],
  },
  {
    slug: "trading-terminal", cat: "trading", title: "Using the Terminal for fast trading", desc: "Chart, order panel and live trades on one screen.",
    short: "The Terminal puts a coin's chart, the trade panel and the live trade feed on one screen, so you can switch coins and trade without leaving the page.",
    sections: [
      ["Switching coins", "Search or pick from the list and the whole screen changes to that coin."],
      ["Order types", "Market buys or sells right away. Limit waits for your market cap. Auto sets take profit and stop loss."],
      ["Live trades", "See every buy and sell as it happens, with the wallet and the amount."],
    ],
    faq: [["Does the Terminal work on phones?", "Yes. The layout stacks on small screens so the chart and trade panel stay easy to use."]],
  },
  {
    slug: "copy-trading", cat: "trading", title: "How copy trading works", desc: "Follow top traders and copy their buys in one tap.",
    short: "Follow a trader, get an alert when they buy, and tap Copy to buy the same coin with your preset amount. You decide on every trade.",
    sections: [
      ["Finding traders", "The Traders page ranks people by profit, win rate and followers. Look at their history before you follow."],
      ["Copying", "Set your copy amount once, for example $25. When a trader you follow buys, your alert has a Copy button."],
    ],
    faq: [["Does it buy automatically?", "No. Nothing happens until you tap Copy."], ["Do past results guarantee future profit?", "No. Every trade carries risk."]],
  },
  {
    slug: "traders-leaderboard", cat: "trading", title: "How the Traders leaderboard works", desc: "What profit, win rate and followers really tell you.",
    short: "The Traders page ranks wallets by their results on ArkhamPad. Use it to find people worth following, but look at more than one number before you copy anyone.",
    sections: [
      ["Profit", "How much a trader has made. One lucky trade can make this look huge."],
      ["Win rate", "The share of trades that made money. A high win rate with small wins can still lose overall."],
      ["Followers and history", "Open a trader's page to see what they bought, when and how it went."],
    ],
    faq: [["Can I hide from the leaderboard?", "The leaderboard shows public on-chain trades by wallet. It doesn't show your login email or name."]],
  },
  {
    slug: "price-alerts", cat: "trading", title: "Price alerts and push notifications", desc: "Get told when a coin moves, even with the site closed.",
    short: "Set an alert on any coin's market cap and ArkhamPad tells you with the bell and a push notification on your phone or computer when it hits your level.",
    sections: [
      ["Creating an alert", "Open a coin, tap Price alert, pick the market cap and confirm. You can see and remove your alerts on the Alerts page."],
      ["Where alerts show", "In the bell at the top of the site, and as a push notification if you allowed them."],
      ["Trader alerts", "Follow a trader to get an alert when they buy, with a one-tap Copy button."],
    ],
    faq: [["I don't get push alerts on iPhone.", "Add ArkhamPad to your home screen first, open it from there and allow notifications."], ["Do you send alerts by email?", "No. Alerts come through the bell and push notifications only."]],
  },
  {
    slug: "profit-and-loss", cat: "trading", title: "Understand your profit and loss", desc: "How your result on a coin is worked out.",
    short: "Your result on a coin is what you got back from selling plus what your remaining coins are worth now, minus what you paid. Until you sell everything, the result keeps moving with the price.",
    sections: [
      ["What you paid", "The total USDC you spent buying the coin."],
      ["What you have", "The USDC you received from sells, plus the current value of the coins you still hold."],
      ["Your entry", "ArkhamPad also shows your average entry market cap, so you can compare it with where the coin is now."],
    ],
    faq: [["Why does my result change when I do nothing?", "The coins you still hold follow the coin's price. Only sold coins have a fixed result."], ["Where do I see it?", "On your Profile, under Holdings. Tap the result button next to a coin."]],
  },
  {
    slug: "volume-holders-trades", cat: "trading", title: "What volume, holders and trades tell you", desc: "Three numbers to check before you buy any coin.",
    short: "Volume shows how much money is moving, holders shows how many wallets own the coin, and trades shows how active it is. Healthy coins usually grow all three together.",
    sections: [
      ["Volume", "High volume means it's easy to get in and out. Very high volume from very few wallets is a warning sign."],
      ["Holders", "More holders usually means the coin is spread out and harder for one person to crash."],
      ["Trades", "Many trades of different sizes look natural. The same amount over and over from the same wallet doesn't."],
    ],
    faq: [["Where do I see these numbers?", "On every coin page and in the Discover list."]],
  },
  {
    slug: "meme-coin-position-size", cat: "trading", title: "How much to put into a meme coin", desc: "A simple rule to keep one bad trade from hurting you.",
    short: "Only put into meme coins money you can lose completely. Spread it over several small trades instead of one big one, and decide in advance when you'll take profit.",
    sections: [
      ["Start small", "Your first trades are for learning. Use small amounts until you know how fast these coins move."],
      ["Plan your exit", "Decide before you buy at what point you'll sell. Take profit and stop loss can do it for you."],
      ["Don't chase", "Buying because a coin already went up a lot is how many people lose money."],
    ],
    faq: [["Is this financial advice?", "No. It's general information to help you think about risk."]],
  },
  {
    slug: "share-a-profit-card", cat: "trading", title: "Share your profit card", desc: "Turn a trade into a clean image for X or Telegram.",
    short: "On your Profile, open Holdings and tap the result button next to a coin. ArkhamPad makes a profit card with the coin, your result and your entry, ready to post on X, Telegram or WhatsApp.",
    sections: [
      ["What the card shows", "The coin's image and ticker, your result in dollars and percent, and your entry and current market cap."],
      ["Privacy", "The card doesn't show your login or your cash balance."],
    ],
    faq: [["Can I share a loss?", "Yes. Honest posts build trust in a community."]],
  },
  {
    slug: "coins-from-other-dexs", cat: "trading", title: "Coins from other DEXs on ArkhamPad", desc: "Thousands of coins in one list, with the same simple trade panel.",
    short: "Discover doesn't only show coins launched on ArkhamPad. It also lists thousands of coins trading on other DEXs, with prices, charts and volume, so you can find everything in one place.",
    sections: [
      ["Why list them", "Traders don't want to switch sites. One list with new launches and established coins saves time."],
      ["Trading them", "On mainnet you buy and sell them with the same trade panel and your USDC. On testnet you can browse them and see their charts."],
      ["Check before you buy", "These coins weren't launched on ArkhamPad. Always check the contract address and the coin's history."],
    ],
    faq: [["Can I promote a coin from another DEX?", "Yes. Anyone can promote any coin listed on ArkhamPad."]],
  },
  // ---------------- Safety ----------------
  {
    slug: "spot-a-rug-pull", cat: "safety", title: "How to spot a rug pull", desc: "Read the warning signs on a coin page before you buy.",
    short: "Check who holds the most, whether the creator is locked and how old the coin is. Many warning signs together mean you should be careful.",
    sections: [
      ["Warning signs", "A few wallets holding most of the supply, a creator holding a big share with no lock, and sudden volume from the same wallets."],
      ["Good signs", "A creator lock, holders spread across many wallets, steady volume and an active community in the comments."],
      ["Where to look", "The coin page shows the top holders, whether the creator is locked and the latest trades."],
    ],
    faq: [["Can anyone promise a coin is safe?", "No. On-chain facts help you decide, but every meme coin can lose its value."]],
  },
  {
    slug: "account-safety", cat: "safety", title: "Keep your account safe", desc: "Login options, scams to avoid and what we never ask.",
    short: "We never ask for your seed phrase or password, and we never send the first message. Only use arkhampad.com and turn on the strongest login your provider offers.",
    sections: [
      ["Common scams", "Fake support accounts, look-alike websites and messages promising free coins. If someone asks for your seed phrase, it is a scam."],
      ["Protect your login", "Use Google or email with two-factor authentication, and keep your own wallet's recovery phrase offline."],
    ],
    faq: [["Does ArkhamPad support ever DM first?", "No. Treat any unexpected message as a scam."], ["How do I contact ArkhamPad?", "Email team@arkhampad.com, or reach @Arkhampad on X."]],
  },
  {
    slug: "common-crypto-scams", cat: "safety", title: "Common crypto scams and how to avoid them", desc: "Fake airdrops, fake support and copycat coins.",
    short: "Most crypto losses come from a handful of tricks: fake support, fake airdrops, look-alike websites and copycat coins. If something is urgent, secret or too good to be true, stop.",
    sections: [
      ["Fake support", "Someone messages you to fix a problem and asks for your seed phrase or to connect your wallet to a site. Real support never does this."],
      ["Fake airdrops and giveaways", "Send a little, get a lot back. You never get anything back."],
      ["Look-alike sites", "A link that looks like arkhampad.com but isn't. Type the address yourself or use a bookmark."],
      ["Copycat coins", "A second coin with the same name and ticker. Always check the contract address."],
    ],
    faq: [["I sent money to a scammer. Can ArkhamPad get it back?", "Blockchain transfers can't be reversed. Report the account where you met the scammer and warn others."]],
  },
  {
    slug: "check-the-contract-address", cat: "safety", title: "Always check the contract address", desc: "The one detail copycats can't fake.",
    short: "Names, tickers and images can be copied by anyone. The contract address is unique to one coin. Before you buy a coin someone shared, compare the address with the one they posted.",
    sections: [
      ["Where to find it", "On the coin page next to the name, with a copy button."],
      ["Search by address", "Paste any contract address into the search bar to open that exact coin."],
      ["What to compare", "Check the first and last few characters at least. Copycats often use addresses that look similar at a glance."],
    ],
    faq: [["Two coins have the same ticker. Which is real?", "The one with the contract address the creator posted on their own account."]],
  },
  {
    slug: "holder-spread", cat: "safety", title: "Why holder spread matters", desc: "Who owns the supply decides how hard a coin can crash.",
    short: "If a few wallets hold most of a coin, any one of them can crash the price by selling. A coin held by many wallets in small amounts is harder to dump on.",
    sections: [
      ["Read the holder list", "The coin page lists the top holders and marks the creator. Look at how much the top 10 hold together."],
      ["The curve and the pool", "Coins held by the bonding curve or the locked pool aren't a person. They're the market itself."],
      ["Watch it change", "Holder spread changes fast on new coins. Check again before a big buy."],
    ],
    faq: [["What share is too much for one wallet?", "There's no fixed rule, but one wallet holding a large share of the supply is a reason to be careful."]],
  },
  {
    slug: "what-is-a-honeypot", cat: "safety", title: "What is a honeypot coin?", desc: "Coins you can buy but never sell, and how ArkhamPad coins differ.",
    short: "A honeypot is a coin whose contract lets you buy but secretly blocks you from selling. Every coin launched on ArkhamPad uses the same standard contract with fixed supply and no hidden sell block.",
    sections: [
      ["How honeypots work", "The creator writes a contract with hidden rules: high sell taxes, a blocklist or a switch that stops sells."],
      ["ArkhamPad coins", "All coins launched here share one public contract. Supply is fixed, nobody can mint more, and anyone can sell. The only limit is the optional creator lock, which stops only the creator from selling for a short time."],
      ["Coins from other DEXs", "Coins listed from other DEXs weren't launched here and can have their own rules. Check them carefully."],
    ],
    faq: [["Can the creator change the contract later?", "No. Coins launched on ArkhamPad can't be changed after launch."]],
  },
  {
    slug: "meme-coin-risks", cat: "safety", title: "The real risks of meme coins", desc: "Read this before you put money into any meme coin.",
    short: "Meme coins are very risky. Most lose most of their value, many go to zero, and prices can move a lot in minutes. Only use money you can afford to lose completely.",
    sections: [
      ["Prices are driven by attention", "Meme coins usually have no business behind them. When attention moves on, the price often falls."],
      ["Fast moves both ways", "A coin can double and halve in the same hour. Automatic orders help, but they can't promise a price."],
      ["Smart contracts and networks", "Blockchains and smart contracts can have bugs or outages. Transfers can't be reversed."],
    ],
    faq: [["Does ArkhamPad give investment advice?", "No. Everything on ArkhamPad, including AI features, is information, not financial advice."]],
  },
  // ---------------- Crypto basics ----------------
  {
    slug: "what-is-a-meme-coin", cat: "basics", title: "What is a meme coin?", desc: "Coins built on jokes, culture and community.",
    short: "A meme coin is a crypto token built around a joke, a character or an internet moment. Its value comes from attention and community, not from a product or company.",
    sections: [
      ["Why people trade them", "They're fun, they're easy to understand and their prices can move fast in both directions."],
      ["How they're made", "On ArkhamPad anyone can launch one in about a minute: an idea, a name, a ticker and an image."],
      ["What to keep in mind", "Most meme coins don't last. Treat them as a high-risk game, not as savings."],
    ],
    faq: [["Are meme coins the same as Bitcoin?", "No. Bitcoin is its own network. A meme coin is a token that runs on a network such as Base or Robinhood Chain."]],
  },
  {
    slug: "what-is-usdc", cat: "basics", title: "What is USDC?", desc: "The dollar stablecoin you use for everything on ArkhamPad.",
    short: "USDC is a stablecoin designed to stay at one US dollar. It's issued by Circle and runs on many blockchains. On ArkhamPad every deposit, trade, balance and withdrawal is in USDC.",
    sections: [
      ["Why a stablecoin", "Your balance doesn't swing with the price of ETH or another coin. One USDC is meant to be worth one dollar."],
      ["Where to get it", "Most exchanges sell USDC. Buy it there, then withdraw it to your ArkhamPad deposit address on a supported network."],
      ["Same token, many networks", "USDC exists on many chains. Always send it on the network you picked on the Deposit screen."],
    ],
    faq: [["Is USDC the same as USDT?", "No. They are different stablecoins. ArkhamPad uses USDC only."]],
  },
  {
    slug: "what-is-a-dex", cat: "basics", title: "What is a DEX?", desc: "Decentralized exchanges in simple words.",
    short: "A DEX is an exchange that runs on smart contracts instead of a company. You trade straight from a wallet, and prices come from pools of tokens instead of an order book.",
    sections: [
      ["How it differs from an exchange", "There's no account at a company holding your money. Trades settle on the blockchain."],
      ["Where ArkhamPad fits", "New coins trade on ArkhamPad's bonding curve first. After graduation they trade in a locked pool on Uniswap, a well-known DEX."],
    ],
    faq: [["Do I need to use a DEX myself?", "No. ArkhamPad handles the trade for you behind the Buy and Sell buttons."]],
  },
  {
    slug: "what-is-a-liquidity-pool", cat: "basics", title: "What is a liquidity pool?", desc: "Where graduated coins trade, and why locked pools matter.",
    short: "A liquidity pool holds two tokens, such as a coin and USDC, so people can trade one for the other. The price is set by how much of each is in the pool.",
    sections: [
      ["How trades work", "When you buy, you add USDC to the pool and take coins out, so the price goes up. Selling does the opposite."],
      ["Why locked pools matter", "If someone can remove the money from a pool, they can leave holders with nothing. Pools made at graduation on ArkhamPad are locked forever."],
    ],
    faq: [["Who provides the money in a graduated coin's pool?", "The USDC raised on the bonding curve moves into the pool at graduation."]],
  },
  {
    slug: "what-is-a-smart-contract", cat: "basics", title: "What is a smart contract?", desc: "Code on the blockchain that runs exactly as written.",
    short: "A smart contract is a program that lives on a blockchain and runs exactly as written. Nobody can quietly change it, and anyone can check what it does.",
    sections: [
      ["Why it matters", "Rules like a coin's fixed supply, the creator lock and the locked pool are enforced by code, not by promises."],
      ["The trade-off", "Code can have bugs, and transactions can't be undone. That's why ArkhamPad's contracts are tested and reviewed before mainnet."],
    ],
    faq: [["Can I read ArkhamPad's contracts?", "Yes. Contract addresses are public and can be checked on a block explorer."]],
  },
  {
    slug: "what-is-token-burning", cat: "basics", title: "What does burning a token mean?", desc: "Removing coins from supply forever, and why holders like it.",
    short: "Burning sends coins to an address nobody controls, so they can never be used again. Total supply goes down. On ArkhamPad, coins in Buyback and burn mode use creator fees to buy and burn their own coin.",
    sections: [
      ["Why burn", "With fewer coins around, each remaining coin is a bigger share of the total."],
      ["Buyback and burn on ArkhamPad", "The creator fee buys the coin from the market and burns it. The amount burned shows on the coin page."],
    ],
    faq: [["Does burning make the price go up?", "Not always. Price depends on buyers and sellers. Burning only reduces supply."]],
  },
  {
    slug: "what-is-a-crypto-wallet", cat: "basics", title: "What is a crypto wallet?", desc: "Where your coins live, and how ArkhamPad sets one up for you.",
    short: "A crypto wallet holds the keys that control your coins on the blockchain. When you log in to ArkhamPad with Google, email or X, a secure wallet is created for your account, so you don't have to install anything.",
    sections: [
      ["Keys, not coins", "Coins stay on the blockchain. The wallet holds the key that lets you move them. Whoever has the key controls the coins."],
      ["Your ArkhamPad wallet", "It's created when you first log in and is tied to that login. You can also connect a wallet you already use, such as MetaMask."],
      ["Keep your login safe", "Your login protects your wallet. Turn on two-factor authentication with your email or Google account."],
    ],
    faq: [["Can ArkhamPad move my coins without me?", "No. Trades and withdrawals only happen when you approve them, and automatic orders only run because you set them up."]],
  },
  // ---------------- Chains ----------------
  {
    slug: "robinhood-chain-or-base", cat: "chains", title: "Robinhood Chain or Base: where to launch", desc: "How each chain differs and which one fits your coin.",
    short: "Both chains work the same way on ArkhamPad: fast trades in USDC. Pick the one where your community already is. You choose one chain per coin.",
    sections: [
      ["Robinhood Chain", "A newer network built for trading. Good if your audience follows Robinhood and wants to be early on a young chain."],
      ["Base", "A large, busy network with many traders and apps. Good if you want to reach an existing crowd quickly."],
      ["Does it change anything for buyers?", "No. Buyers just tap Buy. Prices and balances are shown in USDC on both chains."],
    ],
    faq: [["Can my coin be on both chains?", "No. Each coin lives on the chain you pick at launch."], ["Can I change the chain later?", "No. The chain is fixed once the coin is live."]],
  },
  {
    slug: "what-is-robinhood-chain", cat: "chains", title: "What is Robinhood Chain?", desc: "Robinhood's own blockchain, and why coins launch there.",
    short: "Robinhood Chain is a blockchain network from Robinhood, built on Arbitrum technology and focused on trading and tokenized assets. ArkhamPad lets you launch and trade coins on it with USDC.",
    sections: [
      ["Why launch there", "It's a young network, so there's room to be early, and it's tied to a brand millions of traders already know."],
      ["Using it on ArkhamPad", "Pick Robinhood Chain when you create a coin. Buyers trade it with USDC like any other coin."],
    ],
    faq: [["Do I need a Robinhood account?", "No. You only need an ArkhamPad account and USDC."]],
  },
  {
    slug: "what-is-base", cat: "chains", title: "What is Base?", desc: "Coinbase's network, and why so many coins trade there.",
    short: "Base is a blockchain network incubated by Coinbase. Transactions are fast and cheap, and it has a large community of traders and apps, which makes it a popular place for new coins.",
    sections: [
      ["Why launch there", "Many traders already hold USDC on Base, so it's easy for them to buy."],
      ["Using it on ArkhamPad", "Pick Base when you create a coin. Deposit USDC on Base from Coinbase or most other exchanges."],
    ],
    faq: [["Do I need a Coinbase account?", "No. Any exchange or wallet that can send USDC on Base works."]],
  },
  {
    slug: "withdraw-usdc-to-an-exchange", cat: "chains", title: "Withdraw USDC to an exchange safely", desc: "Pick the right network and test with a small amount.",
    short: "Copy your USDC deposit address from the exchange, make sure the exchange accepts USDC on the network you choose, and send a small test first. Transfers on the wrong network can be lost.",
    sections: [
      ["On the exchange", "Open Deposit, pick USDC and choose the same network you'll use on ArkhamPad. Copy the address."],
      ["On ArkhamPad", "Tap Withdraw, enter the amount, pick the same network and paste the address. Check the first and last characters."],
      ["Test first", "Send a small amount, wait for it to arrive, then send the rest."],
    ],
    faq: [["The exchange doesn't list my network. What now?", "Choose another network that both ArkhamPad and the exchange support."], ["Can a wrong transfer be reversed?", "No. Blockchain transfers are final."]],
  },
];

const words = (g: Raw) => [g.short, ...g.sections.flat(), ...g.faq.flat()].join(" ").split(/\s+/).length;
/** Reading time at a relaxed 180 words a minute, never under 2 minutes. */
export const readTime = (g: Raw) => `${Math.max(2, Math.round(words(g) / 180) + 1)} min`;

export const guides: (Guide & { read: string })[] = raw.map((g, i) => ({ ...g, c1: P[i % P.length][0], c2: P[i % P.length][1], read: readTime(g) }));
export const guideBySlug = (slug: string) => guides.find((g) => g.slug === slug);
