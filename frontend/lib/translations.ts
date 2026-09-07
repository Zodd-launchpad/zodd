export type Lang = "en" | "zh";

export const translations = {
  // ---------- Header / nav ----------
  "nav.launchpad": { en: "Launchpad", zh: "发射台" },
  "nav.bridge": { en: "Bridge", zh: "跨链桥" },
  "nav.nft": { en: "NFT", zh: "NFT" },
  "nav.connect": { en: "Connect", zh: "连接钱包" },

  // ---------- Demo banner ----------
  "demo.banner": {
    en: "Create a coin, earn 1% of the fees forever — ZODD is not affiliated with the ZODL wallet",
    zh: "创建代币，永久赚取1%手续费 — ZODD 与 ZODL 钱包无关联",
  },

  // ---------- Disclaimer banner ----------
  "disclaimer.title": { en: "Not affiliated with Zodl", zh: "与 Zodl 无关联" },
  "disclaimer.body": {
    en: "ZODD is a community-made meme mascot, not an official Zodl product. This entire site — the NFT marketplace, the Bridge, and the Launchpad, including the ZODD token itself — is an independent, experimental project with no affiliation of any kind to Zodl or its team. Nothing here is financial advice, nothing here is audited, and nothing here is backed or endorsed by any wallet provider. It's built purely for fun and research.",
    zh: "ZODD 是社区制作的表情包吉祥物，并非 Zodl 官方产品。整个网站——NFT 市场、跨链桥和发射台，包括 ZODD 代币本身——都是一个独立的实验性项目，与 Zodl 或其团队没有任何关联。此处内容均不构成财务建议，未经审计，也未获得任何钱包提供商的支持或认可。纯粹是为了娱乐和研究而搭建的。",
  },

  // ---------- Home page ----------
  "home.tagline": { en: "Unofficial Zodl mascot", zh: "非官方 Zodl 吉祥物" },
  "home.badge": { en: "COMMUNITY MEME · NOT OFFICIAL", zh: "社区表情包 · 非官方" },
  "home.lore1": {
    en: "ZODD is a fan-made mascot for the Zodl wallet — dreamed up and drawn by the community, not by the Zodl team. There's no wallet, company, or foundation behind it: it's just an image people in the community liked enough to keep drawing.",
    zh: "ZODD 是 Zodl 钱包的粉丝自制吉祥物——由社区构想和绘制，而非 Zodl 团队。它背后没有钱包、公司或基金会：只是社区里大家喜欢到愿意不断创作的一张图。",
  },
  "home.lore2": {
    en: "This whole site grew out of that: a small, experimental corner of the internet to see what a ZODD-themed NFT marketplace, cross-chain bridge, and meme launchpad could look like. Nothing here is official, audited, or meant to be taken too seriously — it's a research project and a bit of fun, not a product.",
    zh: "整个网站就是由此而生：互联网上一个小小的实验角落，用来探索以 ZODD 为主题的 NFT 市场、跨链桥和表情包发射台会是什么样子。这里的一切都不是官方的、未经审计，也不该被太当真——这是一个研究项目，带点乐趣，而不是产品。",
  },
  "home.board.graduated.title": { en: "Graduated", zh: "已毕业" },
  "home.board.graduated.sub": { en: "Tokens that cleared the graduation threshold.", zh: "已达到毕业门槛的代币。" },
  "home.board.explore.title": { en: "Explore", zh: "探索" },
  "home.board.explore.sub": { en: "Tokens still climbing toward graduation, newest first.", zh: "仍在向毕业迈进的代币，按最新排列。" },
  "home.board.empty.graduated": { en: "No tokens have graduated yet.", zh: "还没有代币毕业。" },
  "home.board.empty.explore": { en: "No tokens yet -- be the first to launch one.", zh: "还没有代币——快来发行第一个吧。" },
  "home.board.viewAll": { en: "View all in the Launchpad →", zh: "在发射台查看全部 →" },
  "home.launchpad.tag": { en: "Meme markets", zh: "表情包市场" },
  "home.launchpad.title": { en: "Launchpad", zh: "发射台" },
  "home.launchpad.desc": { en: "Launch and trade shielded meme tokens on Zcash.", zh: "在 Zcash 上发行和交易屏蔽式表情包代币。" },
  "home.bridge.tag": { en: "Cross-chain", zh: "跨链" },
  "home.bridge.title": { en: "Bridge", zh: "跨链桥" },
  "home.bridge.desc": { en: "Move assets in and out privately.", zh: "私密地转入和转出资产。" },
  "home.nft.tag": { en: "Marketplace", zh: "市场" },
  "home.nft.title": { en: "NFT", zh: "NFT" },
  "home.nft.desc": { en: "Buy, sell, and browse ZODD-themed NFTs.", zh: "买卖和浏览 ZODD 主题的 NFT。" },

  // ---------- Launchpad layout / nav ----------
  "launchpad.title": { en: "Launchpad", zh: "发射台" },
  "launchpad.subtitle": {
    en: "Shielded meme markets on Zcash. Launch a token, trade it on a bonding curve, pay privately — built for fun, not for finance.",
    zh: "Zcash 上的屏蔽式表情包市场。发行代币，在联合曲线上交易，私密支付——为了好玩而做，不为金融。",
  },
  "launchpad.nav.market": { en: "Market", zh: "市场" },
  "launchpad.nav.create": { en: "Create", zh: "创建" },
  "launchpad.nav.portfolio": { en: "Portfolio", zh: "持仓" },

  // ---------- Market page ----------
  "market.heading": { en: "Market", zh: "市场" },
  "market.createToken": { en: "+ Create token", zh: "+ 创建代币" },
  "market.backendError": {
    en: "Could not reach the backend ({error}). Is npm run dev running in /backend?",
    zh: "无法连接到后端（{error}）。/backend 里的 npm run dev 有在运行吗？",
  },
  "market.noTokens": { en: "No tokens created yet. Head to Create.", zh: "还没有创建任何代币。去“创建”页看看。" },
  "market.col.token": { en: "Token", zh: "代币" },
  "market.col.price": { en: "Price (ZEC)", zh: "价格（ZEC）" },
  "market.col.marketCap": { en: "Market cap", zh: "市值" },
  "market.col.change24h": { en: "24h", zh: "24小时" },
  "market.col.graduation": { en: "Graduation", zh: "毕业状态" },
  "market.graduated": { en: "graduated", zh: "已毕业" },
  "market.bonding": { en: "bonding", zh: "曲线中" },
  "market.filter.new": { en: "New", zh: "最新" },
  "market.filter.marketCap": { en: "Market cap", zh: "市值" },
  "market.filter.graduated": { en: "Graduated", zh: "已毕业" },

  // ---------- Create page ----------
  "create.title": { en: "Create a token", zh: "创建代币" },
  "create.feeNote": {
    en: "Pay the one-time {amount} ZEC create fee from any Zcash wallet. No wallet connect needed to create.",
    zh: "从任意 Zcash 钱包支付一次性 {amount} ZEC 创建费。创建无需连接钱包。",
  },
  "create.symbolLabel": { en: "Symbol", zh: "代号" },
  "create.nameLabel": { en: "Name", zh: "名称" },
  "create.namePlaceholder": { en: "Zodl's Mascot", zh: "Zodl 的吉祥物" },
  "create.connectFirst": { en: "Connect or create your wallet first (top right).", zh: "请先连接或创建你的钱包（右上角）。" },
  "create.creating": { en: "Created, redirecting…", zh: "创建成功，正在跳转…" },
  "create.button": { en: "Create", zh: "创建" },
  "create.tradingFeeNote": {
    en: "Trading fee: 2% per trade. 1% goes straight to you, the creator — paid out automatically every 24h. 1% goes to the platform.",
    zh: "交易费：每笔交易 2%。其中 1% 直接归你（创建者）所有——每 24 小时自动发放一次。1% 归平台所有。",
  },
  "create.creatorPayoutLabel": { en: "Your Zcash payout address (optional)", zh: "你的 Zcash 收款地址（可选）" },
  "create.creatorPayoutPlaceholder": { en: "u1... or zs1... (leave blank to skip)", zh: "u1... 或 zs1...（留空则跳过）" },
  "create.creatorPayoutHelp": {
    en: "Where your 1% creator fee share gets sent every 24h. Must be a shielded address (u1... or zs1...) — you can leave this blank, but then nobody can claim it.",
    zh: "你的 1% 创建者分成每 24 小时会发送到这个地址。必须是屏蔽地址（u1... 或 zs1...）——可以留空，但这样就没人能领取这部分费用。",
  },
  "create.waiting.title": { en: "Waiting for the create fee", zh: "等待创建费到账" },
  "create.waiting.sendExactly": { en: "Send {amount} ZEC: this address is bound to {symbol}'s create fee", zh: "发送 {amount} ZEC：此地址与 {symbol} 的创建费绑定" },
  "create.waiting.simulatedNote": {
    en: "Simulated: in this demo the \"payment\" confirms on its own after a few seconds (no real payment needed).",
    zh: "模拟流程：本演示中“付款”会在几秒后自动确认（无需真实付款）。",
  },
  "create.waiting.realNote": {
    en: "Real ZEC: any wallet that sends shielded ZEC works. Zcash blocks can be slow — this can take 10 to 15 minutes to confirm. Don't close this page.",
    zh: "真实 ZEC：任何能发送屏蔽 ZEC 的钱包都可以。Zcash 出块较慢——确认可能需要 10 到 15 分钟。请不要关闭此页面。",
  },
  "create.waiting.copyAddress": { en: "Copy address", zh: "复制地址" },
  "create.created.title": { en: "TOKEN DEPLOYED", zh: "代币已部署" },
  "create.created.body": { en: "{symbol} is live.", zh: "{symbol} 已上线。" },
  "create.created.viewButton": { en: "View {symbol}", zh: "查看 {symbol}" },
  "create.failed.title": { en: "Couldn't create the token", zh: "无法创建代币" },
  "create.failed.body": { en: "Something went wrong waiting for the create fee. Nothing was charged twice — try again.", zh: "等待创建费时出了问题。不会重复扣费——请重试。" },
  "create.failed.retry": { en: "Try again", zh: "重试" },
  "create.logoLabel": { en: "Token logo (optional)", zh: "代币图标（可选）" },
  "create.logoHelp": { en: "Any image — it'll be cropped to a square automatically.", zh: "任意图片——会自动裁剪为正方形。" },
  "create.logoChoose": { en: "Choose image", zh: "选择图片" },
  "create.logoError": { en: "couldn't read that image, try a different file", zh: "无法读取该图片，请换一张试试" },
  "create.descriptionLabel": { en: "Description (optional)", zh: "描述（可选）" },
  "create.descriptionPlaceholder": { en: "What's this token about?", zh: "这个代币是关于什么的？" },
  "create.twitterLabel": { en: "Twitter / X (optional)", zh: "Twitter / X（可选）" },
  "create.twitterPlaceholder": { en: "@handle or full link", zh: "@用户名 或完整链接" },
  "create.websiteLabel": { en: "Website (optional)", zh: "网站（可选）" },
  "create.websitePlaceholder": { en: "example.com or full link", zh: "example.com 或完整链接" },

  // ---------- Portfolio page ----------
  "portfolio.connectFirst": { en: "Connect your wallet above to see your portfolio.", zh: "请先在上方连接钱包以查看你的持仓。" },
  "portfolio.title": { en: "Portfolio — {tag}", zh: "持仓 — {tag}" },
  "portfolio.noHoldings": { en: "No holdings yet.", zh: "还没有任何持仓。" },
  "portfolio.col.token": { en: "Token", zh: "代币" },
  "portfolio.col.amount": { en: "Amount", zh: "数量" },
  "portfolio.col.price": { en: "Price", zh: "价格" },

  // ---------- Wallet onboarding modal ----------
  "onboard.badge.intro": { en: "BEFORE YOUR FIRST TRADE", zh: "开始交易之前" },
  "onboard.title.intro": { en: "Two wallets, both yours", zh: "两个钱包，都是你的" },
  "onboard.body.intro": {
    en: "The token wallet is created by this platform and holds what you buy. Your real Zcash wallet (Zashi, Ywallet, Zingo, Zodl) is the one that pays for every trade — we never touch it.",
    zh: "代币钱包由本平台创建，用于存放你买到的代币。你真正的 Zcash 钱包（Zashi、Ywallet、Zingo、Zodl）才是用来支付每笔交易的——我们不会碰它。",
  },
  "onboard.createButton": { en: "Create a new wallet", zh: "创建新钱包" },
  "onboard.orImport": { en: "Already have a wallet?", zh: "已经有钱包了？" },
  "onboard.importButton": { en: "Import with your 12 words", zh: "用你的 12 个助记词导入" },
  "onboard.badge.import": { en: "LOG BACK IN", zh: "重新登录" },
  "onboard.title.import": { en: "Enter your twelve words", zh: "输入你的十二个助记词" },
  "onboard.import.hint": {
    en: "The same 12 words you got when you created this wallet, in order, separated by spaces.",
    zh: "请按顺序输入你创建这个钱包时得到的那 12 个词，用空格分隔。",
  },
  "onboard.import.placeholder": { en: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12", zh: "词1 词2 词3 词4 词5 词6 词7 词8 词9 词10 词11 词12" },
  "onboard.importSubmit": { en: "Import wallet", zh: "导入钱包" },
  "onboard.error.wordCount": { en: "enter all 12 words, separated by spaces", zh: "请输入全部 12 个词，用空格分隔" },
  "onboard.error.notFound": { en: "no wallet found for those words -- check them and try again", zh: "未找到与这些词匹配的钱包——请检查后重试" },
  "onboard.badge.words": { en: "WRITE THESE DOWN NOW", zh: "现在就记下来" },
  "onboard.title.words": { en: "Your twelve words", zh: "你的十二个助记词" },
  "onboard.words.disclaimer": {
    en: "This is your login for ZODD only — not a Zcash seed phrase. It doesn't hold or control any ZEC; your real Zcash wallet (Zashi, Ywallet, Zingo, Zodl) is completely separate and we never touch it. Still worth writing down: it's the only way back into your ZODD account and token holdings.",
    zh: "这只是你登录 ZODD 平台的凭证——不是 Zcash 助记词。它不持有也不控制任何 ZEC；你真正的 Zcash 钱包（Zashi、Ywallet、Zingo、Zodl）完全独立，我们不会碰它。不过还是建议记下来：这是找回你的 ZODD 账户和代币持仓的唯一方式。",
  },
  "onboard.checkbox": { en: "I have written all twelve down, in order.", zh: "我已按顺序把十二个词都记下来了。" },
  "onboard.wroteThemDown": { en: "I wrote them down", zh: "我已经记下来了" },
  "onboard.badge.confirm": { en: "ONE CHECK", zh: "最后确认一下" },
  "onboard.title.confirm": { en: "Type three of them back", zh: "重新输入其中三个" },
  "onboard.confirmHint": { en: "From the copy you made, not from memory.", zh: "请照抄你记下的内容，不要凭记忆输入。" },
  "onboard.wordLabel": { en: "WORD {n}", zh: "第 {n} 个词" },
  "onboard.confirmButton": { en: "Confirm", zh: "确认" },
  "onboard.error.generic": { en: "something went wrong, close this and try again", zh: "出了点问题，请关闭后重试" },
  "onboard.error.wrongWords": { en: "those aren't words 5, 6 and 7. Check the copy you made.", zh: "这不是第 5、6、7 个词。请检查你记下的内容。" },
  "onboard.back": { en: "← Back", zh: "← 返回" },

  // ---------- Wallet detail modal ----------
  "detail.badge": { en: "ZODD WALLET", zh: "ZODD 钱包" },
  "detail.walletIdLabel": { en: "WALLET ID", zh: "钱包 ID" },
  "detail.body": {
    en: "Your ID on this site: your purchases are grouped under it. It can't spend anything — it's not a Zcash address.",
    zh: "这是你在本站的 ID：你的购买记录都归在它名下。它不能用来花钱——这不是一个 Zcash 地址。",
  },
  "detail.portfolioLink": { en: "Portfolio", zh: "持仓" },
  "detail.logout": { en: "Log out", zh: "退出登录" },

  // ---------- Bridge / NFT (coming soon) pages ----------
  "comingSoon.badge": { en: "COMING SOON", zh: "即将推出" },
  "bridge.title": { en: "Bridge", zh: "跨链桥" },
  "bridge.body": {
    en: "A cross-chain bridge to move assets in and out privately. Not built yet. Head to the Launchpad to see what's live today.",
    zh: "一个用于私密转入转出资产的跨链桥，尚未建成。去发射台看看今天已经上线的内容吧。",
  },
  "nft.title": { en: "NFT Marketplace", zh: "NFT 市场" },
  "nft.body": {
    en: "A marketplace for ZODD-themed NFTs — mint, browse, and trade. Not built yet. Head to the Launchpad to see what's live today.",
    zh: "一个 ZODD 主题 NFT 的市场——铸造、浏览和交易，尚未建成。去发射台看看今天已经上线的内容吧。",
  },

  // ---------- Token detail page ----------
  "token.loading": { en: "Loading…", zh: "加载中…" },
  "token.price": { en: "Price:", zh: "价格：" },
  "token.buy": { en: "BUY", zh: "买入" },
  "token.sell": { en: "SELL", zh: "卖出" },
  "token.connectToTrade": { en: "Connect your wallet above to trade.", zh: "请先在上方连接钱包以进行交易。" },
  "token.stat.volume24h": { en: "24h volume", zh: "24小时交易量" },
  "token.stat.marketCap": { en: "Market cap", zh: "市值" },
  "token.stat.realReserve": { en: "Real reserve", zh: "真实储备金" },
  "token.stat.tokensSold": { en: "Tokens sold", zh: "已售代币" },
  "token.graduation": { en: "Graduation", zh: "毕业进度" },
  "token.graduated": { en: "GRADUATED", zh: "已毕业" },
  "token.pctDone": { en: "{pct}% done", zh: "已完成 {pct}%" },
  "token.supply": { en: "Token supply", zh: "代币总量" },
  "token.supplyUnit": { en: "{n} tokens", zh: "{n} 枚代币" },
  "token.onChain.simulatedLabel": { en: "ON CHAIN", zh: "链上信息" },
  "token.onChain.simulatedTag": { en: "(simulated)", zh: "（模拟）" },
  "token.onChain.realTag": { en: "real", zh: "真实" },
  "token.onChain.simulatedBody": {
    en: "This demo doesn't broadcast to Zcash mainnet yet — these entries are placeholders for what a real shielded-memo inscription will look like.",
    zh: "本演示尚未向 Zcash 主网广播交易——这些条目只是真实屏蔽备注铭刻效果的占位展示。",
  },
  "token.onChain.realBody": {
    en: "A real 0.01 ZEC shielded transaction was broadcast on Zcash mainnet to inscribe this token's creation.",
    zh: "一笔真实的 0.01 ZEC 屏蔽交易已在 Zcash 主网广播，用于铭刻此代币的创建。",
  },
  "token.onChain.issued": { en: "issued", zh: "发行" },
  "token.onChain.finalized": { en: "finalized", zh: "完成" },
  "token.onChain.creationTxid": { en: "creation txid", zh: "创建交易 ID" },
  "token.viewOnX": { en: "View on X", zh: "在 X 上查看" },
  "token.viewWebsite": { en: "Website", zh: "网站" },

  // ---------- Creator fee card ----------
  "token.fee.heading": { en: "CREATOR FEE", zh: "创建者分成" },
  "token.fee.explain": {
    en: "1% of every trade (out of a 2% total fee) goes straight to the creator. It accrues through the day and is distributed automatically every 24h.",
    zh: "每笔交易 2% 总费用中的 1% 直接归创建者所有。全天持续累积，每 24 小时自动发放一次。",
  },
  "token.fee.accrued": { en: "Unclaimed", zh: "未发放" },
  "token.fee.paid": { en: "Paid out so far", zh: "已累计发放" },
  "token.fee.payoutTo": { en: "Paid automatically to", zh: "自动发放至" },
  "token.fee.lastPayout": { en: "Last payout {when}", zh: "上次发放：{when}" },
  "token.fee.neverPaid": { en: "No payout yet", zh: "尚未发放过" },
  "token.fee.noAddress": {
    en: "No payout address on file — fees are accruing but nobody can claim them.",
    zh: "尚未设置收款地址——费用在累积，但没有人可以领取。",
  },

  // ---------- Buy modal ----------
  "buy.title": { en: "Buy {symbol}", zh: "买入 {symbol}" },
  "buy.youPay": { en: "You pay (ZEC)", zh: "你支付（ZEC）" },
  "buy.button": { en: "Buy", zh: "买入" },
  "buy.sendAtLeast": { en: "Send at least {amount} ZEC: the address is the order", zh: "至少发送 {amount} ZEC：这个地址就是订单本身" },
  "buy.simulatedNote": {
    en: "Simulated: in this demo the \"confirmation\" arrives on its own after a few seconds (no real payment needed).",
    zh: "模拟流程：本演示中“确认”会在几秒后自动到达（无需真实付款）。",
  },
  "buy.realNote": {
    en: "Real ZEC: this is a live mainnet payment. It confirms automatically once the network detects it (usually a couple of minutes).",
    zh: "真实 ZEC：这是主网上的真实付款。网络检测到后会自动确认（通常需要几分钟）。",
  },
  "buy.alreadyPaidAck": {
    en: "OK, I've paid — I understand it can take 10-15 minutes to reflect in my balance, depending on the Zcash blockchain",
    zh: "好的，我已支付 —— 我知道这可能需要 10-15 分钟才能反映到我的余额，具体取决于 Zcash 区块链",
  },
  "buy.alreadyPaidAck.confirmed": {
    en: "Got it. Still watching for your payment — this can take 10-15 minutes.",
    zh: "已确认。仍在等待你的付款确认，这可能需要 10-15 分钟。",
  },
  "buy.filled.title": { en: "Filled", zh: "已成交" },
  "buy.filled.body": { en: "You received {amount} {symbol}.", zh: "你收到了 {amount} {symbol}。" },
  "buy.close": { en: "Close", zh: "关闭" },
  "buy.failed.title": { en: "Failed", zh: "失败" },
  "buy.failed.body": { en: "The order could not be executed against the curve.", zh: "该订单未能根据曲线成交。" },
  "buy.error.invalidAmount": { en: "invalid amount", zh: "金额无效" },

  // ---------- Sell modal ----------
  "sell.title": { en: "Sell {symbol}", zh: "卖出 {symbol}" },
  "sell.amountLabel": { en: "Amount ({symbol})", zh: "数量（{symbol}）" },
  "sell.balance": { en: "You have: {amount} {symbol}", zh: "你持有：{amount} {symbol}" },
  "sell.half": { en: "Half", zh: "一半" },
  "sell.max": { en: "Max", zh: "最大" },
  "sell.addressLabel": { en: "Your shielded Zcash address (payout)", zh: "你的屏蔽式 Zcash 地址（收款）" },
  "sell.addressHint": { en: "Must start with u1... or zs1... (transparent t1... addresses aren't accepted)", zh: "必须以 u1... 或 zs1... 开头（不接受透明的 t1... 地址）" },
  "sell.button": { en: "Sell", zh: "卖出" },
  "sell.payoutSent": { en: "Payout sent", zh: "打款已发送" },
  "sell.payoutBody.real": { en: "{amount} ZEC sent to your address.", zh: "{amount} ZEC 已发送到你的地址。" },
  "sell.payoutBody.simulated": { en: "{amount} ZEC (simulated) to your address.", zh: "{amount} ZEC（模拟）已发送到你的地址。" },
  "sell.error.invalidAmount": { en: "invalid amount", zh: "金额无效" },
  "sell.error.exceedsBalance": { en: "you don't have that many {symbol}", zh: "你没有那么多 {symbol}" },
  "sell.error.invalidAddress": { en: "enter a shielded Zcash address (starts with u1... or zs1...) to receive the payout", zh: "请输入屏蔽式 Zcash 地址（以 u1... 或 zs1... 开头）以接收打款" },

  // ---------- Help / guide modal ----------
  "nav.help": { en: "Guide", zh: "指南" },
  "help.title": { en: "How ZODD works", zh: "ZODD 如何运作" },
  "help.wallet.heading": { en: "Your wallet", zh: "你的钱包" },
  "help.wallet.body": {
    en: "Connect creates a 12-word wallet right in your browser -- no email, no password. Write the 12 words down and keep them somewhere safe: they're the only way to recover your wallet, and ZODD can't reset them for you.",
    zh: "连接钱包会在你的浏览器里生成一个 12 个单词的钱包——无需邮箱，无需密码。请把这 12 个单词记下来并妥善保管：这是恢复钱包的唯一方式，ZODD 无法为你重置。",
  },
  "help.buy.heading": { en: "Buying a token", zh: "如何购买" },
  "help.buy.body": {
    en: "Open any token and click Buy, then enter how much ZEC you want to spend. You'll get a one-time Zcash address and QR code -- send that exact amount from any Zcash wallet. Once the payment confirms on-chain (usually a few minutes), your tokens land in your ZODD wallet automatically.",
    zh: "打开任意代币页面，点击「买入」，输入你想花费的 ZEC 数量。系统会生成一个一次性的 Zcash 地址和二维码——用任意 Zcash 钱包发送相同金额。链上确认后（通常几分钟），代币会自动进入你的 ZODD 钱包。",
  },
  "help.sell.heading": { en: "Selling a token", zh: "如何出售" },
  "help.sell.body": {
    en: "Open Sell on a token you hold, choose an amount (or tap Half / Max), and enter a shielded Zcash address (starts with u1... or zs1...) to receive the payout -- transparent t1... addresses aren't accepted, to keep the platform's reserve private. Confirm, and the ZEC is sent automatically.",
    zh: "在你持有的代币页面打开「卖出」，选择数量（或点击「一半」/「最大」），并输入一个屏蔽式 Zcash 地址（以 u1... 或 zs1... 开头）用于接收打款——为了保护平台储备金的隐私，不接受透明的 t1... 地址。确认后 ZEC 会自动发送。",
  },
  "help.curve.heading": { en: "How the price moves", zh: "价格如何变动" },
  "help.curve.body": {
    en: "There's no order book: every token trades against its own bonding curve, so the price moves automatically with each buy and sell -- buying pushes it up, selling brings it down. Once a token's real ZEC reserve reaches the graduation threshold, it graduates off the curve.",
    zh: "这里没有订单簿：每个代币都在自己的联合曲线上交易，价格会随着每次买卖自动变化——买入推高价格，卖出则降低价格。当代币的真实 ZEC 储备达到毕业门槛时，它就会从曲线上「毕业」。",
  },
  "help.fees.heading": { en: "Fees", zh: "费用" },
  "help.fees.body": {
    en: "Every trade carries a 2% fee (1% to the token's creator, 1% to the platform). Creating a new token has a separate one-time fee, paid once from the creator's own wallet.",
    zh: "每笔交易收取 2% 的费用（1% 归代币创建者，1% 归平台）。创建新代币需要单独支付一次性费用，由创建者从自己的钱包支付。",
  },

  // ---------- Chart ----------
  "chart.interval.5m": { en: "5m", zh: "5分" },
  "chart.interval.15m": { en: "15m", zh: "15分" },
  "chart.interval.1h": { en: "1H", zh: "1时" },
  "chart.interval.4h": { en: "4H", zh: "4时" },
  "chart.interval.all": { en: "ALL", zh: "全部" },
  "chart.mode.mcap": { en: "MCAP", zh: "市值" },
  "chart.mode.price": { en: "PRICE", zh: "价格" },
  "chart.o": { en: "O", zh: "开" },
  "chart.h": { en: "H", zh: "高" },
  "chart.l": { en: "L", zh: "低" },
  "chart.c": { en: "C", zh: "收" },
  "chart.vol": { en: "VOL", zh: "量" },

  // ---------- Trades list ----------
  "trades.heading": { en: "RECENT TRADES", zh: "最近交易" },
  "trades.none": { en: "No trades yet — be the first to buy.", zh: "还没有交易——成为第一个买家吧。" },
  "trades.tokens": { en: "{n} tokens", zh: "{n} 枚代币" },
  "trades.side.buy": { en: "BUY", zh: "买入" },
  "trades.side.sell": { en: "SELL", zh: "卖出" },
  "trades.ago.seconds": { en: "{n}s ago", zh: "{n}秒前" },
  "trades.ago.minutes": { en: "{n}m ago", zh: "{n}分钟前" },
  "trades.ago.hours": { en: "{n}h ago", zh: "{n}小时前" },
  "trades.ago.days": { en: "{n}d ago", zh: "{n}天前" },
} as const satisfies Record<string, Record<Lang, string>>;

export type TranslationKey = keyof typeof translations;
