// Terms of Use and Privacy Policy. Plain English, one place to edit.
import { CONTACT_EMAIL, fees, promotePrices } from "./help";

export type LegalDoc = { title: string; updated: string; intro: string; sections: { id: string; h: string; p: string[] }[] };
const UPDATED = "October 5, 2026";

export const terms: LegalDoc = {
  title: "Terms of Use",
  updated: UPDATED,
  intro: "These terms apply when you use arkhampad.com and its apps and services (\"ArkhamPad\", \"we\", \"us\"). By using ArkhamPad you agree to them. If you don't agree, please don't use ArkhamPad.",
  sections: [
    { id: "service", h: "1. What ArkhamPad is", p: [
      "ArkhamPad is software that lets you create crypto tokens (\"coins\") that open in a locked Uniswap pool, trade coins with USDC, and use tools such as alerts, automatic orders, copy alerts and AI helpers. Coins launched on ArkhamPad trade in a public Uniswap liquidity pool from launch, with the pool's liquidity locked forever that is locked.",
      "ArkhamPad does not hold your funds. Your USDC and coins are kept in a blockchain wallet controlled through your login or your own connected wallet. Trades, withdrawals and orders are carried out by smart contracts after you approve them.",
      "ArkhamPad is not a bank, broker, exchange, investment adviser or money transmitter, and nothing on ArkhamPad is an offer to sell or a solicitation to buy any investment.",
    ] },
    { id: "eligibility", h: "2. Who can use ArkhamPad", p: [
      "You must be at least 18 years old and able to enter a binding agreement.",
      "You may not use ArkhamPad if you are subject to sanctions, if you are in a country or region under comprehensive sanctions, or if using ArkhamPad is illegal where you live. You are responsible for following the laws that apply to you, including tax laws.",
      "We may limit or block access from certain places or for certain people when we believe the law requires it.",
    ] },
    { id: "account", h: "3. Your account and wallet", p: [
      "You can log in with Google, email, X or your own wallet. Each login method creates its own account and wallet. Keep your login secure and turn on two-factor authentication where you can.",
      "You are responsible for everything done through your account. We will never ask for your seed phrase or password. If you lose access to your login or your own wallet, we may not be able to help you recover it.",
    ] },
    { id: "testnet", h: "4. Testnet", p: [
      "While ArkhamPad runs on test networks, all balances, coins and trades use test tokens with no value. Test tokens cannot be sold, withdrawn to an exchange or exchanged for money, and testnet data may be reset at any time.",
    ] },
    { id: "risks", h: "5. Risks you accept", p: [
      "Meme coins are highly speculative. Their prices can rise or fall very fast and most lose most or all of their value. Only use money you can afford to lose completely.",
      "Blockchain transactions are final and cannot be reversed. Sending tokens to a wrong address or on a wrong network can mean losing them.",
      "Smart contracts, blockchains, wallets, relayers and the services we rely on can fail, be attacked, be delayed or change. Automatic orders, limit orders and alerts may fill late, at a different price, or not at all.",
      "AI features (coin ideas, images, summaries, safety notes, answers, translations and similar) can be wrong or incomplete. They are information only, never financial, legal or tax advice.",
      "Market data, prices and charts, including for coins from other DEXs, come from blockchains and third parties and may be delayed or wrong.",
    ] },
    { id: "coins", h: "6. Creating coins", p: [
      "When you create a coin, you are its creator. You are responsible for its name, ticker, description, image and links, and you confirm you have the right to use them.",
      "A coin's name, ticker, description and links are fixed at launch. The creator may change the coin's image later. Coins can't be changed, paused for sells or withdrawn from their locked pool after launch.",
      "Do not create coins that impersonate real people or brands, infringe someone else's rights, promise returns, or are hateful, sexual, violent or otherwise unlawful. We may hide such coins from ArkhamPad. Hiding a coin on our site doesn't remove it from the blockchain.",
    ] },
    { id: "fees", h: "7. Fees", p: [
      ...fees.map((f) => `${f.what}: ${f.fee}. ${f.note}`),
      `Promote: ${promotePrices.map(([d, p]) => `${d} ${p}`).join(", ")}, paid from your USDC balance. Promotions start immediately and are not refundable once confirmed.`,
      "Fees are taken automatically by the smart contracts when a transaction happens. We may change fees for the future by updating this page. Changes don't apply to transactions already made.",
    ] },
    { id: "invites", h: "8. Invites", p: [
      "If someone joins through your invite link, for 12 months you receive 25% of ArkhamPad's share of the fees on their trades. Self-invites, fake accounts and abuse aren't paid, and we may change or end the invite program for the future.",
    ] },
    { id: "conduct", h: "9. What you must not do", p: [
      "Don't break the law, launder money, manipulate markets, spam, harass people, post scams or malware, impersonate others, attack or overload our systems, or use bots or scripts in a way that harms other users or ArkhamPad.",
      "Comments and other content you post must be your own or used with permission. You give us permission to show, store and translate what you post on ArkhamPad. We may hide or remove content and limit accounts that break these terms.",
    ] },
    { id: "ip", h: "10. Our content", p: [
      "The ArkhamPad name, logo, design and site content belong to us. You may share links and screenshots, but you may not copy the site or use our brand in a way that suggests we endorse you.",
    ] },
    { id: "third-parties", h: "11. Third-party services", p: [
      "ArkhamPad relies on third parties, such as login providers, blockchains, DEXs, data providers and hosting services. Their own terms apply to them, and we are not responsible for their services.",
    ] },
    { id: "liability", h: "12. No warranties and limits of liability", p: [
      "ArkhamPad is provided \"as is\" and \"as available\", without warranties of any kind, to the fullest extent the law allows.",
      "To the fullest extent the law allows, we are not liable for any indirect or consequential loss, or for lost profits, lost tokens, lost data or trading losses, and our total liability to you for any claim is limited to the fees you paid to ArkhamPad in the 3 months before the claim.",
      "Nothing in these terms limits liability that cannot be limited by law.",
    ] },
    { id: "changes", h: "13. Changes and ending access", p: [
      "We may change ArkhamPad or these terms. If a change is important, we will show it on the site. Using ArkhamPad after a change means you accept the new terms.",
      "You can stop using ArkhamPad at any time. We may suspend or end access if you break these terms or if the law requires it. Because your funds sit in your own wallet, ending access to the site doesn't take your funds away.",
    ] },
    { id: "disputes", h: "14. Questions and disputes", p: [
      `If you have a problem, email ${CONTACT_EMAIL} first. Most issues can be solved quickly, and we'll try in good faith to resolve any dispute within 30 days before either side takes other steps.`,
    ] },
    { id: "contact", h: "15. Contact", p: [`Email: ${CONTACT_EMAIL}. X: @Arkhampad. We never message first and never ask for your seed phrase.`] },
  ],
};

export const privacy: LegalDoc = {
  title: "Privacy Policy",
  updated: UPDATED,
  intro: "This policy explains what information ArkhamPad (\"we\", \"us\") collects when you use arkhampad.com, why, and the choices you have. We collect as little as we can to run the service.",
  sections: [
    { id: "collect", h: "1. What we collect", p: [
      "Login details: when you log in with Google, email or X, our login provider shares your email address or account handle and a user ID with us. When you connect your own wallet, we receive its public address.",
      "Wallet and on-chain activity: your wallet address and your trades, coins, orders and transfers. These are recorded on public blockchains and can be seen by anyone.",
      "What you add on ArkhamPad: coins you create (name, ticker, description, image, links), comments, follows, price alerts, automatic and limit orders, invite links and the settings you choose.",
      "Notifications: if you allow push notifications, your browser gives us a push subscription so we can send alerts to that device.",
      "Technical data: our hosting and security providers process IP addresses, device and browser type and request logs to deliver the site and protect it from abuse.",
      "AI inputs: the text you type into AI features (for example a coin idea or a question) is sent to our AI provider to produce an answer.",
      "We don't use advertising trackers and we don't sell your personal information.",
    ] },
    { id: "use", h: "2. Why we use it", p: [
      "To log you in and keep your account secure; to show your balance, coins, orders and alerts; to send the notifications you asked for; to pay invite rewards; to run AI features; to prevent fraud, spam and abuse; to fix bugs and improve ArkhamPad; and to meet legal obligations.",
    ] },
    { id: "storage", h: "3. Your device", p: [
      "We use your browser's local storage for things like your light or dark mode choice, whether you've seen the welcome screen and your invite link. Our login provider uses storage on your device to keep you signed in.",
    ] },
    { id: "sharing", h: "4. Who we share it with", p: [
      "Service providers that help us run ArkhamPad, only for that purpose: login and wallet infrastructure, database hosting (in the EU), website hosting, security, AI and email routing, blockchain network access, and market data providers.",
      "Public blockchains: transactions you make are public by design and can't be made private or deleted.",
      "Authorities: when the law requires it, or to protect users and ArkhamPad from fraud or harm.",
    ] },
    { id: "retention", h: "5. How long we keep it", p: [
      "We keep account data while your account is in use. Logs are kept for a short time for security. When you ask us to delete your data, we delete or anonymise it unless we need to keep it by law. Data on public blockchains can't be deleted by anyone.",
    ] },
    { id: "rights", h: "6. Your choices and rights", p: [
      `You can turn off push notifications in your browser at any time. You can ask us to access, correct, export or delete your personal information by emailing ${CONTACT_EMAIL}. Depending on where you live, you may also have the right to object to or limit how we use your data and to complain to your data protection authority.`,
    ] },
    { id: "security", h: "7. Security", p: [
      "We use encryption in transit, access controls and trusted providers to protect your information. No system is perfectly secure, so please protect your login with two-factor authentication.",
    ] },
    { id: "children", h: "8. Children", p: ["ArkhamPad is only for people aged 18 and over. We don't knowingly collect information from anyone younger."] },
    { id: "transfers", h: "9. International transfers", p: ["Our providers may process data in countries other than yours. When they do, we rely on their contractual and legal safeguards."] },
    { id: "changes", h: "10. Changes", p: ["We may update this policy. The date at the top shows the latest version, and important changes will be shown on the site."] },
    { id: "contact", h: "11. Contact", p: [`Questions about privacy: ${CONTACT_EMAIL}.`] },
  ],
};
