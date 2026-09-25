export type Lang = "en" | "zh";

export const translations = {
  // ---------- Common ----------
  // Brai, 2026-09-19: "cuando tocas PAGAR, el QR tarda como 5 segundos en
  // aparecer... quiero que haya un cartel que diga WAIT" -- shown on the
  // pay/buy/sell/create buttons while the order+QR round trip is in flight.
  "common.wait": { en: "WAIT...", zh: "请稍候…" },

  // ---------- Header / nav ----------
  "nav.launchpad": { en: "Launchpad", zh: "发射台" },
  "nav.bridge": { en: "Bridge", zh: "跨链桥" },
  "nav.nft": { en: "NFT", zh: "NFT" },
  "nav.connect": { en: "Connect", zh: "连接钱包" },
  // Brai, 2026-09-24: "Crea un boton grande arriba a la derecha al lado de
  // la conexion a la wallet que diga SUPPORT y te envie directamente al
  // telegram" -- header button, always visible, next to the wallet chip.
  "nav.support": { en: "SUPPORT", zh: "支持" },

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
  "home.board.explore.sub": { en: "Tokens still climbing toward graduation, highest market cap first.", zh: "仍在向毕业迈进的代币，按市值从高到低排列。" },
  "home.board.empty.graduated": { en: "No tokens have graduated yet.", zh: "还没有代币毕业。" },
  "home.board.empty.explore": { en: "No tokens yet -- be the first to launch one.", zh: "还没有代币——快来发行第一个吧。" },
  "home.board.viewAll": { en: "View all in the Launchpad →", zh: "在发射台查看全部 →" },
  "home.board.explore.closest": { en: "Closest to graduating", zh: "最接近毕业" },
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
  "launchpad.nav.pyramid": { en: "THE PYRAMID", zh: "金字塔" },
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
  // Brai, 2026-09-11: no longer always ZEC -- each row now shows its own
  // token's currency next to the number (see launchpad/page.tsx).
  "market.col.price": { en: "Price", zh: "价格" },
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
    en: "Pay the one-time {amount} {currency} create fee from any {currency} wallet. No wallet connect needed to create.",
    zh: "从任意 {currency} 钱包支付一次性 {amount} {currency} 创建费。创建无需连接钱包。",
  },
  // Brai, 2026-09-11: "quiero que puedas trabajar con Ycash y Zcash" --
  // currency picker on the create form, one market per currency for a
  // token's whole life.
  "create.currencyLabel": { en: "Currency", zh: "币种" },
  "create.currencyYecNote": {
    en: "Ycash support is simulated for now — no real payment needed to test it.",
    zh: "Ycash 支持目前为模拟流程——测试无需真实付款。",
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
  // Brai, 2026-09-08: "que puedas hacer una first buy" -- bundle an
  // optional creator buy into the same payment as the create fee.
  "create.firstBuyLabel": { en: "Your first buy (optional)", zh: "你的首次买入（可选）" },
  "create.firstBuyHelp": {
    en: "Buy your own token the moment it launches, in the same payment as the create fee. Max {amount} {currency}.",
    zh: "在代币上线的同时买入，与创建费一起在同一笔付款中完成。最多 {amount} {currency}。",
  },
  "create.breakdown.launchFee": { en: "Launch fee", zh: "创建费" },
  "create.breakdown.firstBuy": { en: "First buy", zh: "首次买入" },
  "create.breakdown.send": { en: "Send", zh: "共计发送" },
  "create.creatorPayoutLabel": { en: "Your Zcash payout address (optional)", zh: "你的 Zcash 收款地址（可选）" },
  "create.creatorPayoutPlaceholder": { en: "u1... or zs1... (leave blank to skip)", zh: "u1... 或 zs1...（留空则跳过）" },
  "create.creatorPayoutHelp": {
    en: "Where your 1% creator fee share gets sent every 24h. Must be a shielded address (u1... or zs1...) — you can leave this blank, but then nobody can claim it.",
    zh: "你的 1% 创建者分成每 24 小时会发送到这个地址。必须是屏蔽地址（u1... 或 zs1...）——可以留空，但这样就没人能领取这部分费用。",
  },
  // Brai, 2026-09-11: same as above but for a YEC token -- Ycash's shielded
  // addresses use the "ys1" prefix instead of "zs1".
  "create.creatorPayoutPlaceholderYec": { en: "u1... or ys1... (leave blank to skip)", zh: "u1... 或 ys1...（留空则跳过）" },
  "create.creatorPayoutHelpYec": {
    en: "Where your 1% creator fee share gets sent every 24h. Must be a shielded address (u1... or ys1...) — you can leave this blank, but then nobody can claim it.",
    zh: "你的 1% 创建者分成每 24 小时会发送到这个地址。必须是屏蔽地址（u1... 或 ys1...）——可以留空，但这样就没人能领取这部分费用。",
  },
  "create.waiting.title": { en: "Waiting for the create fee", zh: "等待创建费到账" },
  "create.waiting.sendExactly": { en: "Send {amount} {currency}: this address is bound to {symbol}'s create fee", zh: "发送 {amount} {currency}：此地址与 {symbol} 的创建费绑定" },
  "create.waiting.simulatedNote": {
    en: "Simulated: in this demo the \"payment\" confirms on its own after a few seconds (no real payment needed).",
    zh: "模拟流程：本演示中“付款”会在几秒后自动确认（无需真实付款）。",
  },
  "create.waiting.realNote": {
    en: "Real ZEC: any wallet that sends shielded ZEC works. Zcash blocks can be slow — this can take 10 to 15 minutes to confirm. Don't close this page.",
    zh: "真实 ZEC：任何能发送屏蔽 ZEC 的钱包都可以。Zcash 出块较慢——确认可能需要 10 到 15 分钟。请不要关闭此页面。",
  },
  "create.waiting.copyAddress": { en: "Copy address", zh: "复制地址" },
  // Brai, 2026-09-07: "aclara en el menu de pago las wallets admitidas para
  // pagar empezando por ZODL" -- shared between the buy and create-token
  // waiting screens. ZODL (formerly Zashi) first since it's the wallet the
  // demo banner already references; Ywallet and Nighthawk are the other two
  // current unified-address/Orchard-shielded wallets worth naming (see
  // zcash.school's wallet guide, checked live 2026-09-07) -- deliberately
  // NOT listing Zecwallet Lite, which still hasn't shipped Orchard support
  // and isn't a safe recommendation for a u1... address. Any shielded
  // wallet still works via the amount fallback (see buy.realNote /
  // create.waiting.realNote) -- this is a recommendation for the
  // QR+memo-protected path, not an exclusion list.
  "payment.recommendedWallets": {
    en: "Works best with: ZODL, Ywallet, or Nighthawk (scan the QR — it protects your payment with a unique ID, no mix-ups even if many people are buying at once).",
    zh: "推荐搭配使用：ZODL、Ywallet 或 Nighthawk（扫描二维码——会用唯一 ID 保护你的付款，即使很多人同时购买也不会弄混）。",
  },
  "payment.copyHint": {
    en: "Copies just the address shown above. Scan the QR instead if your wallet supports it — it also fills in the amount for you.",
    zh: "只会复制上方显示的地址。如果你的钱包支持，建议扫描二维码——还会自动填好金额。",
  },
  // Brai, 2026-09-18: "el metodo de pago de tokens lo dejamos igual, o
  // envias por noir o por QR" -- one-click alternative to scanning/pasting,
  // via the Noir extension's own sendTransaction(). Same deposit address
  // and memo as the QR right below it, so either path is detected the
  // same way.
  "payment.noir.payButton": { en: "Pay with Noir Wallet", zh: "用 Noir 钱包支付" },
  "payment.noir.sending": { en: "Confirm in Noir…", zh: "请在 Noir 中确认…" },
  "payment.noir.sent": { en: "Sent via Noir — waiting for it to confirm below.", zh: "已通过 Noir 发送——正在等待下方确认。" },
  "payment.noir.orScan": { en: "or scan the QR below with any wallet", zh: "或用任意钱包扫描下方二维码" },
  "payment.noir.notInstalled": { en: "Noir Wallet isn't installed — scan the QR below instead.", zh: "未安装 Noir 钱包——请改用下方二维码。" },
  "payment.noir.rejected": { en: "Payment was closed before approving in Noir.", zh: "付款在 Noir 中批准前被关闭。" },
  "payment.noir.failed": { en: "Couldn't send from Noir — scan the QR below instead.", zh: "无法从 Noir 发送——请改用下方二维码。" },

  // Brai, 2026-09-18: "necesito que me hagas la parte de la whitelist de
  // los nft" -- public submission page (frontend/app/nft/whitelist).
  //
  // Brai, 2026-09-20: "cerramos la whitelist" -- the closed-state screen
  // (scroll image, English closing note, handle-only status check). See
  // WHITELIST_CLOSED in app/nft/whitelist/page.tsx.
  "nftWhitelist.closed.title": { en: "Whitelist Applications Have Closed", zh: "白名单申请已截止" },
  "nftWhitelist.closed.body": {
    en: "Thank you to everyone who applied. Submissions are now closed and under final review.",
    zh: "感谢所有申请者。提交现已截止，正在进行最终审核。",
  },
  "nftWhitelist.closed.announce": {
    en: "The mint day and date will be announced on X (Twitter).",
    zh: "铸造日期将在 X（推特）上公布。",
  },
  "nftWhitelist.closed.checkTitle": { en: "Check your status", zh: "查询你的状态" },
  "nftWhitelist.closed.checkBody": {
    en: "Type your X (Twitter) handle below — no wallet connection needed.",
    zh: "在下方输入你的 X（推特）账号——无需连接钱包。",
  },
  "nftWhitelist.closed.handlePlaceholder": { en: "yourhandle", zh: "你的账号" },
  "nftWhitelist.closed.checkButton": { en: "CHECK STATUS", zh: "查询状态" },
  "nftWhitelist.closed.checking": { en: "Checking…", zh: "查询中…" },
  "nftWhitelist.closed.notFound": { en: "No application found for that handle.", zh: "未找到该账号的申请记录。" },
  "nftWhitelist.closed.enterHandle": { en: "Enter a handle first.", zh: "请先输入账号。" },
  "nftWhitelist.badge": { en: "NFT WHITELIST", zh: "NFT 白名单" },
  "nftWhitelist.title": { en: "Apply for free mint", zh: "申请免费铸造资格" },
  "nftWhitelist.body": {
    en: "Complete the steps below, then submit your Zcash wallet address and X (Twitter) handle — no wallet connection needed. Every application is reviewed by hand — you'll see your status here once it's checked.",
    zh: "完成以下步骤，然后提交你的 Zcash 钱包地址和 X（推特）账号——无需连接钱包。每个申请都会人工审核——审核后可在此查看状态。",
  },
  "nftWhitelist.step.follow": { en: "Follow", zh: "关注" },
  "nftWhitelist.step.likeRetweet": { en: "Like and retweet", zh: "点赞并转发" },
  "nftWhitelist.step.tweetLink": { en: "this tweet", zh: "这条推文" },
  "nftWhitelist.step.submit": { en: "Submit your X handle below.", zh: "在下方提交你的 X 账号。" },
  "nftWhitelist.notConfiguredYet": { en: "The tweet link isn't posted yet — check back soon.", zh: "推文链接尚未发布——请稍后再来查看。" },
  "nftWhitelist.addressLabel": { en: "Your Zcash wallet address", zh: "你的 Zcash 钱包地址" },
  "nftWhitelist.handleLabel": { en: "Your X (Twitter) handle", zh: "你的 X（推特）账号" },
  "nftWhitelist.submitButton": { en: "Submit for review", zh: "提交审核" },
  "nftWhitelist.resubmitButton": { en: "Resubmit", zh: "重新提交" },
  "nftWhitelist.submitting": { en: "Submitting…", zh: "提交中…" },
  "nftWhitelist.error.empty": { en: "Enter your X handle first.", zh: "请先输入你的 X 账号。" },
  "nftWhitelist.error.emptyAddress": { en: "Enter your Zcash wallet address first.", zh: "请先输入你的 Zcash 钱包地址。" },
  "nftWhitelist.status.PENDING": { en: "Under review", zh: "审核中" },
  // Brai, 2026-09-24: "cambia APROBBED por WHITELISTED... hay gente que no
  // entiende el APROBBED" -- swapped the displayed word for everyone
  // approved in either whitelist tier (COLAB or APROBBED); the internal
  // tier/status values in the database are untouched, only this label.
  "nftWhitelist.status.APPROVED": { en: "WHITELISTED", zh: "WHITELISTED" },
  "nftWhitelist.status.REJECTED": { en: "Not approved", zh: "未通过" },
  "nftWhitelist.pendingNote": { en: "We'll review your follow/like/retweet by hand. No need to resubmit.", zh: "我们会人工审核你的关注/点赞/转发。无需重复提交。" },
  "nftWhitelist.approvedNote": { en: "You're whitelisted — your next mint on this collection will be free.", zh: "你已进入白名单——本系列下一次铸造将免费。" },
  "nftWhitelist.rejectedNote": { en: "Not approved this time. Double-check the steps above and you can resubmit.", zh: "本次未通过。请检查以上步骤后可重新提交。" },
  // Brai, 2026-09-18 (v3): "esta muy pobre... te envio unas fotos de una
  // pagina para q veas lo que tenes que copiar" -- redesigned as a 4-step
  // wizard matching the reference screenshots' pixel-terminal look (see
  // the long comment at the top of frontend/app/nft/whitelist/page.tsx).
  "nftWhitelist.wizard.glory": { en: "4 STEPS TO GLORY", zh: "四步登顶" },
  "nftWhitelist.wizard.log1": { en: "queue is open", zh: "队列已开放" },
  "nftWhitelist.wizard.log2": { en: "reviewed by hand", zh: "人工审核" },
  "nftWhitelist.wizard.log3": { en: "waiting on you", zh: "等待你的操作" },
  "nftWhitelist.wizard.step1Label": { en: "X account", zh: "X 账号" },
  "nftWhitelist.wizard.step1Heading": { en: "Verify your X account", zh: "验证你的 X 账号" },
  // Brai, 2026-09-18 (v12, URGENT): "me están conectando cualquier handle y
  // se están haciendo pasar por otra persona ... que se conecte a Twitter"
  // -- step 1 no longer accepts a typed handle at all. It has to be a real
  // X login now, so the handle can never be someone else's.
  "nftWhitelist.wizard.step1Body": {
    en: "Connect your X (Twitter) account so we can confirm the handle is really yours — no more typing it in by hand.",
    zh: "连接你的 X（推特）账号，以便我们确认这确实是你本人的账号——不再需要手动输入。",
  },
  "nftWhitelist.wizard.connectX": { en: "CONNECT WITH X", zh: "连接 X 账号" },
  "nftWhitelist.wizard.checkingX": { en: "Checking your X connection…", zh: "正在检查 X 连接状态…" },
  "nftWhitelist.wizard.xConnected": { en: "Verified as @{handle}", zh: "已验证为 @{handle}" },
  "nftWhitelist.wizard.xNotConfigured": {
    en: "X verification isn't switched on yet — check back soon.",
    zh: "X 验证功能尚未开启——请稍后再来查看。",
  },
  "nftWhitelist.wizard.xError": {
    en: "Couldn't verify your X account. Try connecting again.",
    zh: "无法验证你的 X 账号。请重新尝试连接。",
  },
  "nftWhitelist.wizard.change": { en: "change", zh: "修改" },
  "nftWhitelist.wizard.step2Label": { en: "Wallet address", zh: "钱包地址" },
  "nftWhitelist.wizard.step2Heading": { en: "Your Zcash wallet address", zh: "你的 Zcash 钱包地址" },
  "nftWhitelist.wizard.step2Body": {
    en: "Paste the Zcash address that should receive the free mint — transparent, shielded or unified all work.",
    zh: "粘贴用来接收免费铸造的 Zcash 地址——透明、屏蔽或统一地址都可以。",
  },
  "nftWhitelist.wizard.noirAutofill": { en: "Autofill from Noir", zh: "从 Noir 自动填入" },
  "nftWhitelist.wizard.noirAutofilling": { en: "Connecting…", zh: "连接中…" },
  "nftWhitelist.wizard.step3Label": { en: "Tasks", zh: "任务" },
  "nftWhitelist.wizard.step3Heading": { en: "Complete the tasks", zh: "完成任务" },
  "nftWhitelist.wizard.step3Body": {
    en: "Each one opens X in a new tab and marks itself done — come back here once you've done it for real.",
    zh: "每一项都会在新标签页打开 X 并自动标记完成——请在实际完成后再回到这里。",
  },
  "nftWhitelist.wizard.taskFollow": { en: "Follow", zh: "关注" },
  "nftWhitelist.wizard.taskFollowDesc": { en: "Follow our X account", zh: "关注我们的 X 账号" },
  "nftWhitelist.wizard.taskLikeRepost": { en: "Like & repost", zh: "点赞并转发" },
  "nftWhitelist.wizard.taskLikeRepostDesc": { en: "Like and repost the pinned announcement", zh: "点赞并转发置顶公告" },
  "nftWhitelist.wizard.taskQuote": { en: "Quote it", zh: "引用转发" },
  "nftWhitelist.wizard.taskQuoteDesc": { en: "Quote the tweet with the caption we prefill for you", zh: "引用该推文，我们已为你预填文案" },
  "nftWhitelist.wizard.open": { en: "OPEN", zh: "打开" },
  "nftWhitelist.wizard.tasksLeft": { en: "{n} task(s) left", zh: "还剩 {n} 项任务" },
  "nftWhitelist.wizard.step4Label": { en: "Review", zh: "确认" },
  "nftWhitelist.wizard.step4Heading": { en: "One last look", zh: "最后确认" },
  "nftWhitelist.wizard.step4Body": {
    en: "Check everything below. Once you send it, it's locked in for review.",
    zh: "请检查以下所有内容。提交后即锁定，等待审核。",
  },
  "nftWhitelist.wizard.reviewHandle": { en: "X handle", zh: "X 账号" },
  "nftWhitelist.wizard.reviewAddress": { en: "Wallet address", zh: "钱包地址" },
  "nftWhitelist.wizard.reviewTasks": { en: "Tasks", zh: "任务" },
  "nftWhitelist.wizard.tasksDoneCount": { en: "{done} of {total} done", zh: "已完成 {done}/{total}" },
  "nftWhitelist.wizard.back": { en: "BACK", zh: "返回" },
  "nftWhitelist.wizard.continue": { en: "CONTINUE", zh: "继续" },
  "nftWhitelist.wizard.submit": { en: "SEAL IT", zh: "提交" },
  "nftWhitelist.wizard.resubmit": { en: "APPLY AGAIN", zh: "重新申请" },
  // Brai, 2026-09-18 (v8): "si pones tu HANDLE y ya suscribiste te vaya a
  // la 4ta directamente ... y un boton de share" -- checking the handle on
  // step 1's Continue, and a share button on the big status screen it
  // jumps straight to when there's already an entry for that handle.
  "nftWhitelist.wizard.checking": { en: "CHECKING…", zh: "查询中…" },
  "nftWhitelist.wizard.share": { en: "SHARE", zh: "分享" },
  "nftWhitelist.share.pending": {
    en: "Just applied for the ZODD NFT whitelist 🐸 — under review!",
    zh: "刚刚申请了 ZODD NFT 白名单 🐸 —— 审核中！",
  },
  "nftWhitelist.share.approved": {
    en: "I'm whitelisted for the ZODD NFT drop 🎉 — free mint locked in via @zodd_zcash",
    zh: "我已进入 ZODD NFT 白名单 🎉 —— 通过 @zodd_zcash 锁定免费铸造",
  },
  // Brai, 2026-09-24: "que haya un boton para hacer el SHARE ... e ingresa
  // un cartel que diga, una ultima tarea te pedimos, comparte!" -- for the
  // closed-whitelist status-check box (a returning visitor typing their own
  // handle, not the full wizard), shown only once their status is APROBBED.
  "nftWhitelist.closed.shareBanner": { en: "One last thing — share it!", zh: "最后一件事 —— 分享出去！" },
  "nftWhitelist.closed.shareButton": { en: "SHARE", zh: "分享" },

  // ---------- NFT marketplace (Brai, 2026-09-18: "empeza a deployar el
  // marketplace" -- reference to copy: zecrocks.cash/market, minus its
  // Holders leaderboard) ----------
  "nftMarket.badge": { en: "NFT MARKET", zh: "NFT 市场" },
  // Brai, 2026-09-24: hub section at the very top of /nft/test -- see the
  // big comment on it in page.tsx. Each block pairs a small tagline (same
  // small-caps style as the "NFT WHITELIST IS OPEN" banner) with the big
  // label below it. Brai gave the taglines in Spanish and asked for them
  // in English, worded to make sense: "hemos empezado el minteo de la
  // coleccion" / "forja piezas, construye nuevos nft" / "browse, trade
  // the coleccion".
  "nftMarket.hub.mint.tagline": { en: "MINTING IS NOW LIVE", zh: "铸造现已开放" },
  "nftMarket.hub.mint": { en: "MINT", zh: "铸造" },
  "nftMarket.hub.forge.tagline": { en: "FORGE PIECES, BUILD NEW NFTS", zh: "熔炼作品，打造新的 NFT" },
  "nftMarket.hub.forge": { en: "FORGE", zh: "熔炉" },
  "nftMarket.hub.marketplace.tagline": { en: "BROWSE & TRADE THE COLLECTION", zh: "浏览并交易该系列" },
  "nftMarket.hub.marketplace": { en: "NFT MARKETPLACE", zh: "NFT 市场" },
  "nftMarket.notConfigured.title": { en: "Coming soon", zh: "敬请期待" },
  "nftMarket.notConfigured.body": { en: "The collection isn't live yet.", zh: "该系列尚未上线。" },
  "pyramid.closed.title": { en: "Coming soon", zh: "敬请期待" },
  // Brai, 2026-09-19: "reliquia va en ingles tambien, TODO EL IDIOMA DE LA
  // PAGINA ES EN INGLES ... si yo te digo una frase en español que tiene
  // que tener la pagina, vos la traducis a ingles, SIEMPRE" -- fixed the
  // English copy to say "TIER 3" instead of leaving "Reliquia"
  // untranslated, matching the site's own established convention for this
  // tier (see nftMarket.forge.tier.reliquia / .reliquiaOwned above).
  "pyramid.closed.body": { en: "This exclusive benefit will open for all TIER 3 holders very soon.", zh: "这项专属权益即将向所有持有三级藏品的用户开放。" },
  "nftMarket.soldOut": { en: "SOLD OUT", zh: "已售罄" },
  // Brai, 2026-09-19: "no quiero que diga los zec porque parece que estas
  // pagando, quiero que solo diga MINT" -- dropped the price/currency from
  // this button's label (the mint page itself still shows the exact ZEC
  // amount once you're actually on the payment flow, just not here).
  "nftMarket.mintButton": { en: "Mint", zh: "铸造" },
  // Brai, 2026-09-19: "arriba donde dice MINTED ... tiene que decir SUPPLY"
  // -- relabeled; the value it's paired with (nft/test/page.tsx) now shows
  // collection.aliveSupply, a live count that goes DOWN as people forge
  // (see getNftCollectionStats in the backend), not the old
  // always-increasing mintedCount.
  "nftMarket.stat.minted": { en: "Supply", zh: "供应量" },
  "nftMarket.stat.floor": { en: "Floor", zh: "地板价" },
  "nftMarket.stat.listed": { en: "Listed", zh: "在售" },
  "nftMarket.stat.volume": { en: "Volume", zh: "成交量" },
  "nftMarket.stat.sales": { en: "Sales", zh: "成交笔数" },
  "nftMarket.tab.market": { en: "Market", zh: "市场" },
  "nftMarket.tab.sales": { en: "Sales", zh: "成交记录" },
  "nftMarket.loading": { en: "Loading…", zh: "加载中…" },
  "nftMarket.empty": { en: "No pieces yet.", zh: "还没有任何作品。" },
  "nftMarket.noSales": { en: "No sales yet.", zh: "还没有成交记录。" },
  "nftMarket.unminted": { en: "Not minted yet", zh: "尚未铸造" },
  "nftMarket.notListed": { en: "Not listed", zh: "未上架" },
  "nftMarket.sales.col.item": { en: "Item", zh: "作品" },
  "nftMarket.sales.col.price": { en: "Price", zh: "价格" },
  "nftMarket.sales.col.when": { en: "When", zh: "时间" },

  // Brai, 2026-09-19 (v14): "la idea es que aparezca en varias solapas, una
  // que diga listed ... excepto offers, copia todo de esa pagina
  // [zecbit.net]" -- the /nft/test market page rebuilt around zecbit's
  // multi-tab layout, minus their Offers tab (ZODD has no offer system).
  // "Market"/"Sales" above are kept for old translation-key compatibility
  // but no longer rendered.
  //
  // Brai, 2026-09-19: "primero tiene que estar items, borra traits, segundo
  // forge, tercero activity cuarto analytics y quinto about" -- tab order
  // below matches that; the old Traits tab/key is gone.
  "nftMarket.tab.items": { en: "Items", zh: "作品" },
  "nftMarket.tab.forge": { en: "Forge", zh: "熔炉" },
  "nftMarket.tab.activity": { en: "Activity", zh: "动态" },
  "nftMarket.tab.analytics": { en: "Analytics", zh: "数据" },
  "nftMarket.tab.about": { en: "About", zh: "关于" },

  "nftMarket.stat.onchain": { en: "Minted", zh: "已铸造" },

  "nftMarket.status.label": { en: "Status", zh: "状态" },
  "nftMarket.status.all": { en: "All", zh: "全部" },
  "nftMarket.status.listed": { en: "Listed", zh: "在售" },
  "nftMarket.status.notListed": { en: "Not listed", zh: "未上架" },
  "nftMarket.status.owned": { en: "Owned by you", zh: "你拥有的" },

  // Brai, 2026-09-24: "seleccionar varios nfts y comprarlos todos juntos
  // ... tiene que haber un aviso ... que esos nfts estan tomados" --
  // multi-select buy + the reservation-lock badge/bar.
  "nftMarket.select.reserved": { en: "Reserved", zh: "已锁定" },
  "nftMarket.select.selectedCount": { en: "{count} selected", zh: "已选择 {count} 件" },
  "nftMarket.select.total": { en: "Total", zh: "总计" },
  "nftMarket.select.buySelected": { en: "Buy selected", zh: "购买所选" },
  "nftMarket.select.clear": { en: "Clear", zh: "清空" },
  "nftMultiBuy.title": { en: "Buying {count} pieces", zh: "购买 {count} 件作品" },
  "nftMultiBuy.notice": {
    en: "Each piece is reserved for you while its payment is pending — up to 30 minutes — so no one else can buy it out from under you.",
    zh: "在付款确认期间（最长 30 分钟），每件作品都已为你锁定，其他人无法购买。",
  },
  "nftMultiBuy.preparing": { en: "Preparing payment…", zh: "正在准备付款…" },
  "nftMultiBuy.paid": { en: "Paid", zh: "已付款" },
  "nftMultiBuy.failed": { en: "Failed", zh: "失败" },
  "nftMultiBuy.reserved": { en: "Already taken by another buyer", zh: "已被其他买家锁定" },
  "nftMultiBuy.close": { en: "Close", zh: "关闭" },
  "nftMultiBuy.doneAll": { en: "All done — these pieces are now yours.", zh: "全部完成 —— 这些作品现在属于你了。" },

  "nftMarket.sort.edition": { en: "Edition #", zh: "编号" },
  "nftMarket.sort.priceAsc": { en: "Price low to high", zh: "价格从低到高" },
  "nftMarket.sort.priceDesc": { en: "Price high to low", zh: "价格从高到低" },

  "nftMarket.showingCount": { en: "Showing {shown} of {total} items", zh: "显示 {total} 件中的 {shown} 件" },
  "nftMarket.page": { en: "Page {page} of {pages}", zh: "第 {page} / {pages} 页" },
  "nftMarket.prevPage": { en: "← Prev", zh: "← 上一页" },
  "nftMarket.nextPage": { en: "Next →", zh: "下一页 →" },


  "nftMarket.activity.empty": { en: "Nothing has happened in this collection yet.", zh: "该系列还没有任何动态。" },
  "nftMarket.activity.col.event": { en: "Event", zh: "事件" },
  "nftMarket.activity.col.item": { en: "Item", zh: "作品" },
  "nftMarket.activity.col.price": { en: "Price", zh: "价格" },
  "nftMarket.activity.col.when": { en: "When", zh: "时间" },
  "nftMarket.activity.kind.mint": { en: "Mint", zh: "铸造" },
  "nftMarket.activity.kind.forge": { en: "Forge", zh: "熔炼" },
  "nftMarket.activity.kind.list": { en: "List", zh: "上架" },
  "nftMarket.activity.kind.sale": { en: "Sale", zh: "成交" },

  "nftMarket.analytics.mintProgress": { en: "Mint progress", zh: "铸造进度" },
  "nftMarket.analytics.avgSale": { en: "Avg. sale price", zh: "平均成交价" },
  "nftMarket.analytics.noSales": { en: "Not enough sales yet for a price chart.", zh: "成交数据还不够，无法生成价格走势图。" },
  "nftMarket.analytics.recentSalePrices": { en: "Recent sale prices", zh: "近期成交价格" },

  "nftMarket.about.details": { en: "Collection details", zh: "系列详情" },
  "nftMarket.about.currency": { en: "Currency", zh: "结算币种" },
  "nftMarket.about.totalSupply": { en: "Total supply", zh: "总供应量" },
  "nftMarket.about.mintPrice": { en: "Mint price", zh: "铸造价格" },
  "nftMarket.about.created": { en: "Created", zh: "创建时间" },
  "nftMarket.about.noDescription": { en: "No description yet.", zh: "暂无描述。" },

  // Brai, 2026-09-19: "habra 3 tipos de nfts.. los papiros, los fragmentos y
  // las reliquias .. genera una solapa que sea como la forja" -- 5 papiros
  // -> 1 fragmento, 3 fragmentos -> 1 reliquia; owning a reliquia unlocks
  // LA PIRAMIDE in the Launchpad.
  // Brai, 2026-09-19: "TIER 1 en verde, TIER 2 en amarillo y TIER 3 en
  // ROJO" -- the tier badge now shows a plain rank instead of the
  // papiro/fragmento/reliquia names (color comes from CSS, see
  // .nft-card-tier-papiro/-fragmento/-reliquia in globals.css).
  "nftMarket.forge.tier.papiro": { en: "TIER 1", zh: "一级" },
  "nftMarket.forge.tier.fragmento": { en: "TIER 2", zh: "二级" },
  "nftMarket.forge.tier.reliquia": { en: "TIER 3", zh: "三级" },
  "nftMarket.forge.intro": {
    en: "Combine your pieces here: 5 TIER 1 forge into 1 TIER 2, and 3 TIER 2 forge into 1 TIER 3. Crafting burns the pieces you feed in -- it can't be undone.",
    zh: "在这里合成你的藏品：5 个一级可合成 1 个二级，3 个二级可合成 1 个三级。合成会烧毁投入的藏品，且无法撤销。",
  },
  "nftMarket.forge.craftButton": { en: "Craft (uses {count})", zh: "合成（消耗 {count} 个）" },
  "nftMarket.forge.crafting": { en: "Crafting…", zh: "合成中…" },
  "nftMarket.forge.crafted": { en: "Crafted {name}!", zh: "已合成 {name}！" },
  "nftMarket.forge.reliquiaOwned": { en: "You own {count} TIER 3 piece(s) -- that unlocks THE PYRAMID.", zh: "你拥有 {count} 个三级藏品——已解锁金字塔（LA PIRAMIDE）。" },
  "nftMarket.forge.goToPyramid": { en: "Go to THE PYRAMID →", zh: "前往金字塔 →" },

  // Brai, 2026-09-19: "LA PIRAMIDE, que es de donde salen unos tokens
  // especiales, estos tokens, tienen una curva que a los 3 ZEC bondean,
  // luego pasan al general" -- reliquia-gated token launch flow, reusing
  // the normal /launchpad/create form under the hood with a lower
  // graduation threshold (see graduationThresholdFor in the backend).
  "pyramid.title": { en: "THE PYRAMID", zh: "金字塔" },
  "pyramid.subtitle": {
    en: "Tokens launched here graduate to the general market at just 3 ZEC in the curve, instead of the normal threshold. Only TIER 3 holders can launch one.",
    zh: "在这里发行的代币只需在曲线中累积 3 ZEC 即可毕业进入公开市场，远低于普通门槛。只有拥有三级藏品的人才能在此发行代币。",
  },
  "pyramid.locked.title": { en: "You need a TIER 3 piece to enter", zh: "你需要拥有一个三级藏品才能进入" },
  "pyramid.locked.body": {
    en: "Craft a TIER 3 in the Forge (3 TIER 2, made from 5 TIER 1 each) to unlock THE PYRAMID. Selling your only TIER 3 locks you back out.",
    zh: "在熔炉中合成一个三级藏品（需要 3 个二级，每个二级由 5 个一级合成）以解锁金字塔。如果卖掉你唯一的三级藏品，将重新失去访问权限。",
  },
  "pyramid.locked.goToForge": { en: "Go to the Forge →", zh: "前往熔炉 →" },
  "pyramid.graduationNote": { en: "Graduates to the general market at 3 {currency} in the curve.", zh: "累积 3 {currency} 即可毕业进入公开市场。" },
  "pyramid.checkingAccess": { en: "Checking your TIER 3…", zh: "正在检查你的三级藏品…" },

  "nftMint.back": { en: "← Back to market", zh: "← 返回市场" },
  "nftMint.title": { en: "Mint · {name}", zh: "铸造 · {name}" },
  "nftMint.body": { en: "{remaining} of {total} left. You'll get a random piece from the collection.", zh: "剩余 {remaining} / {total} 件。你将随机获得系列中的一件作品。" },
  "nftMint.confirmButton": { en: "Mint now", zh: "立即铸造" },
  // Brai, 2026-09-19: "hacer dos botones, uno que se habilite cuando el
  // handled es positivo para pre aprobed y solo te deje mintear 5 y otro
  // que sea para comprar normal ... como que digan, FREE MINT / y el otro
  // BUY" -- the total price row used to always show the full paid price
  // even for a whitelist-eligible wallet with free claims left, which read
  // as "it's charging me" despite the backend actually giving those free.
  // Split into two explicit buttons instead of one ambiguous one.
  "nftMint.freeMintButton": { en: "FREE MINT ({count})", zh: "免费铸造（{count}）" },
  // Brai, 2026-09-25: "quiero que cuando vayan a pagar diga 1 FREE MINT +
  // 0.001 ZEC PLATFORM FEE = 0.001 ZEC" -- plain label composed with the
  // count in front on the waiting/payment screen (mintedQuantity + this),
  // unlike freeMintButton above which has the count in parens on the button.
  "nftMint.freeMint.label": { en: "FREE MINT", zh: "免费铸造" },
  "nftMint.buyButton": { en: "MINT", zh: "铸造" },
  "nftMint.total.free": { en: "FREE", zh: "免费" },
  "nftMint.waitingBody": { en: "Send the exact amount below. Your piece is revealed automatically once payment is detected.", zh: "请发送下方准确金额。检测到付款后将自动为你揭示作品。" },
  // Brai, 2026-09-19: "inclusive los que hacen free mint tienen que hacer
  // una tx con su wallet y cobrarle muy poco, que cubran la transaccion y
  // un poquito mas ... sino no tiene sentido solo son nfts en mi base de
  // datos, la idea es que vivan en la blockchain" -- a whitelist free
  // claim now needs a tiny real on-chain payment too (NFT_FREE_MINT_FEE_ZEC
  // in the backend), so it can't stay fully silent about a fee existing.
  "nftMint.freeClaim.feeNote": { en: "A tiny network fee applies so your piece lives on-chain, not just in a database.", zh: "需支付极少的网络手续费，让你的作品真正上链，而不只是存在数据库里。" },
  "nftMint.freeClaim.badge": { en: "FREE MINT", zh: "免费铸造" },
  "nftMint.freeClaim.waitingBody": { en: "Send the exact (tiny) amount below to put your free piece on-chain. It's revealed automatically once payment is detected.", zh: "请发送下方极少金额，让你的免费作品上链。检测到付款后将自动为你揭示作品。" },
  // Brai, 2026-09-24: "aunque sea FREE MINT pongas 0.001 ZEC (entre
  // parentesis el valor en dolar), (PLATFORM FEE) una (i) de informacion y
  // que explique que este fee es por los costos de mantenimiento de los
  // servidores, transacciones internas, etc" -- shown only on the final
  // payment screen (once the QR is up), right where the free-mint fee
  // amount is displayed, so it's clearly labeled rather than a bare number.
  "nftMint.platformFee.label": { en: "PLATFORM FEE", zh: "平台费" },
  "nftMint.platformFee.tooltip": { en: "This fee covers server maintenance costs, internal transactions, and other platform upkeep.", zh: "此费用用于覆盖服务器维护成本、内部交易等平台运营开支。" },
  "nftMint.revealed.badge": { en: "YOU MINTED", zh: "铸造成功" },
  "nftMint.revealed.viewItem": { en: "View piece", zh: "查看作品" },
  "nftMint.revealed.backToMarket": { en: "Back to market", zh: "返回市场" },
  // Brai, 2026-09-25: "quiero que cuando minteas, aparezca el nft y un
  // boton que diga SHARE y te deje compartir tu NFT en twitter" -- same
  // Twitter-intent + server-rendered-OG-card pattern as the whitelist
  // share button (see /nft/test/share/[tier]/[editionNumber]/page.tsx and
  // its OG image route), just for a freshly-minted piece instead of a
  // whitelist status.
  // Brai, 2026-09-25: "abajo en informacion en la pagina del mint debe
  // figurar: 555 whitelist y 5000 public y 10 por persona ... esto tiene
  // que ser informacion que este en la pagina, no cambia nuestro codigo
  // porque habra mas de 555 de whitelist ... y tambien la gente podra
  // mintear mas de 10" -- purely informational display copy, same "text
  // only, zero enforcement" spirit as nftMint.publicMaxNote above. NOT
  // read from quantityCap/maxMintsPerWallet/any live whitelist count.
  "nftMint.info.title": { en: "COLLECTION SUPPLY", zh: "藏品供应量" },
  "nftMint.info.whitelist": { en: "Whitelist mint", zh: "白名单铸造" },
  "nftMint.info.public": { en: "Public mint", zh: "公开铸造" },
  "nftMint.info.perWallet": { en: "Max per wallet", zh: "每个钱包上限" },
  "nftMint.revealed.share": { en: "SHARE", zh: "分享" },
  "nftMint.share.caption.single": {
    en: "Just minted {label} on ZODD 🎉 via @zodd_zcash",
    zh: "刚刚在 @zodd_zcash 上铸造了 {label} 🎉",
  },
  "nftMint.share.caption.multi": {
    en: "Just minted {count} ZODD Genesis NFTs 🎉 via @zodd_zcash",
    zh: "刚刚在 @zodd_zcash 上铸造了 {count} 个 ZODD Genesis NFT 🎉",
  },
  "nftMint.limitNote": { en: "Limit: {max} pieces per wallet.", zh: "每个钱包限购 {max} 件。" },
  "nftMint.phase.locked": { en: "Minting hasn't opened yet.", zh: "铸造尚未开放。" },
  "nftMint.phase.lockedWithTime": { en: "Minting opens {time}.", zh: "铸造将于 {time} 开放。" },
  "nftMint.phase.whitelist": { en: "Whitelist mint is open now. Public mint opens {time}.", zh: "白名单铸造现已开放。公开铸造将于 {time} 开放。" },
  "nftMint.phase.whitelistNoTime": { en: "Whitelist mint is open now.", zh: "白名单铸造现已开放。" },
  "nftMint.phase.public": { en: "Public mint is open.", zh: "公开铸造已开放。" },

  // ---------- NFT mint page redesign (Brai, 2026-09-19: "este es el
  // formato de la pagina de mint que quiero" -- Facets-style layout, ZODD's
  // real 2-stage presale, floor price only from the stats row) ----------
  "nftMint.badge.locked": { en: "MINT LOCKED", zh: "铸造未开放" },
  "nftMint.badge.whitelist": { en: "WHITELIST LIVE", zh: "白名单铸造进行中" },
  "nftMint.badge.public": { en: "PUBLIC MINT LIVE", zh: "公开铸造进行中" },
  "nftMint.badge.soldOut": { en: "SOLD OUT", zh: "已售罄" },
  // Brai, 2026-09-19: "SUPPLY ... debe ir bajando" -- {supply} is
  // collection.aliveSupply (live, drops as people forge/burn), not the
  // old always-increasing mintedCount.
  "nftMint.supply": { en: "SUPPLY {supply} / {total}", zh: "供应量 {supply} / {total}" },
  "nftMint.stats.floorPrice": { en: "Floor Price", zh: "地板价" },
  "nftMint.stats.noFloor": { en: "No listings yet", zh: "暂无挂单" },
  "nftMint.schedule.title": { en: "Mint Schedule", zh: "铸造时间表" },
  "nftMint.schedule.whitelistStage": { en: "Whitelist Stage", zh: "白名单阶段" },
  "nftMint.schedule.publicStage": { en: "Public Stage", zh: "公开阶段" },
  "nftMint.schedule.eligible": { en: "ELIGIBLE", zh: "有资格" },
  "nftMint.schedule.notEligible": { en: "NOT ELIGIBLE", zh: "无资格" },
  "nftMint.schedule.free": { en: "Free (up to {max})", zh: "免费（最多 {max} 个）" },
  "nftMint.schedule.notScheduled": { en: "Not scheduled yet", zh: "尚未安排时间" },
  // Brai, 2026-09-25: "abajo del current stage ... pongas MINT DATE / WHITELIST
  // / PUBLIC" -- informational lines under the locked-phase message, values
  // computed from the real collection.whitelistStartsAt/publicStartsAt.
  "nftMint.schedule.mintDateLabel": { en: "MINT DATE", zh: "铸造日期" },
  "nftMint.schedule.whitelistLabel": { en: "WHITELIST", zh: "白名单" },
  "nftMint.schedule.publicLabel": { en: "PUBLIC", zh: "公开" },
  "nftMint.stage.currentLabel": { en: "Current Stage", zh: "当前阶段" },
  "nftMint.stage.yourPrice": { en: "Your price", zh: "你的价格" },
  "nftMint.stage.freeRemaining": { en: "{count} free mints left for your wallet", zh: "你的钱包还剩 {count} 次免费铸造" },
  "nftMint.stage.freeUsedUp": { en: "Your free mints are used up — minting now pays full price.", zh: "你的免费铸造名额已用完，继续铸造需支付全价。" },
  // Brai, 2026-09-24: cosmetic-only notice on the mint screen -- see the
  // big comment where it's rendered in mint/page.tsx. Not tied to any
  // real per-wallet cap; public minting stays unlimited.
  "nftMint.publicMaxNote": { en: "MAXIMUM 10 PER WALLET", zh: "每个钱包最多 10 个" },
  "nftMint.quantity.label": { en: "Quantity", zh: "数量" },
  "nftMint.quantity.remaining": { en: "{count} left for your wallet", zh: "你的钱包还可铸造 {count} 个" },
  "nftMint.total.label": { en: "Total", zh: "总计" },
  "nftMint.mintedTag": { en: "You've minted {count} / {max}", zh: "你已铸造 {count} / {max}" },
  "nftMint.limitReached": { en: "You've reached the limit for this wallet.", zh: "该钱包已达到铸造上限。" },
  "nftMint.notWhitelisted": { en: "Not on the approved whitelist — check back at public mint.", zh: "未通过白名单审核，请等待公开铸造。" },
  "nftMint.connectToMint": { en: "Connect your wallet to mint", zh: "连接钱包以开始铸造" },
  "nftMint.live.mints": { en: "Live Mints", zh: "实时铸造" },
  "nftMint.live.sales": { en: "Live Sales", zh: "实时成交" },
  "nftMint.live.empty": { en: "Nothing yet.", zh: "暂无记录。" },
  // Brai, 2026-09-21: "programar algo para el mint... conectar
  // autentificador de twitter" -- self-service link for a preapproved
  // handle that never went through the (now closed) wallet+handle wizard.
  // Shown on the mint page only while the connected wallet has no free
  // mint eligibility yet. Reuses nftWhitelist.wizard.connectX/xConnected
  // and nftWhitelist.wizard.noirAutofill(ing) for the shared bits.
  "nftMint.xClaim.intro": {
    en: "Already approved but never linked a wallet? Connect your X account to check.",
    zh: "已获批但从未关联钱包？连接你的 X 账号进行核实。",
  },
  "nftMint.xClaim.checkButton": { en: "CHECK ELIGIBILITY", zh: "核实资格" },
  "nftItem.notFound": { en: "Piece not found.", zh: "未找到该作品。" },
  "nftItem.price": { en: "Price", zh: "价格" },
  "nftItem.listPriceLabel": { en: "List price ({currency})", zh: "上架价格（{currency}）" },
  "nftItem.listButton": { en: "List for sale", zh: "上架出售" },
  "nftItem.unlistButton": { en: "Remove listing", zh: "取消上架" },
  "nftItem.buyButton": { en: "Buy now", zh: "立即购买" },
  "nftItem.buyFilled": { en: "Purchase complete — this piece is now yours.", zh: "购买完成 —— 这件作品现在属于你了。" },
  // Brai, 2026-09-24: "necesito que esa transaccion pongas el link hacia
  // esa transaccion ... para que la gente vea que es una inscripcion que
  // vive en la blockchain" -- on-chain proof link, shown when this piece's
  // mint payment has a real txid (not a forge-created piece).
  "nftItem.viewOnChain": { en: "View mint transaction on-chain ↗", zh: "在链上查看铸造交易 ↗" },
  "nftItem.reservedByOther": {
    en: "This piece is currently reserved by another buyer's pending payment — try again shortly.",
    zh: "该作品目前正被另一位买家的待处理付款锁定 —— 请稍后再试。",
  },
  "portfolio.nfts.title": { en: "Your NFTs", zh: "你的 NFT" },
  "portfolio.nfts.listed": { en: "Listed", zh: "已上架" },
  "portfolio.nfts.unlisted": { en: "Not listed", zh: "未上架" },
  "activity.nft.MINT": { en: "Minted", zh: "铸造了" },
  "activity.nft.FORGE": { en: "Forged", zh: "熔炼了" },
  "activity.nft.LIST": { en: "Listed", zh: "上架了" },
  "activity.nft.SALE": { en: "Sold", zh: "售出了" },
  // Brai, 2026-09-07: tried a Noir-specific banner (first a quiet 2-line
  // copy button, then a big bronze "GOT NOIR" box copying address+memo
  // together) across a few rounds, but it still didn't work reliably for
  // Noir buyers in practice -- Brai asked to pull it entirely ("no
  // funciona"). Removed from BuyModal.tsx/create/page.tsx.
  //
  // Brai, 2026-09-07 (later): turned out the real bug was one level below
  // that banner -- the plain "copy address" button was copying the full
  // zcash:<addr>?amount=..&memo=.. URI, not the address shown in the box,
  // which is why it looked to Brai like clicking copy gave "a completely
  // different address". Most wallets (Noir included) can't parse that
  // pasted URI at all, only a bare address. Fixed copyAddress() in both
  // BuyModal.tsx and create/page.tsx to copy the plain address instead --
  // the backend's per-order unique amount (see zcashReal.ts) still prevents
  // any collision even without the memo, so nothing is lost. The QR still
  // encodes the full URI for wallets that scan it.
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
  "portfolio.col.value": { en: "Value", zh: "价值" },

  // ---------- Wallet onboarding modal ----------
  "onboard.badge.intro": { en: "BEFORE YOUR FIRST TRADE", zh: "开始交易之前" },
  "onboard.title.intro": { en: "Two wallets, both yours", zh: "两个钱包，都是你的" },
  "onboard.body.intro": {
    en: "The token wallet is created by this platform and holds what you buy. Your real Zcash wallet (Zashi, Ywallet, Zingo, Zodl) is the one that pays for every trade — we never touch it.",
    zh: "代币钱包由本平台创建，用于存放你买到的代币。你真正的 Zcash 钱包（Zashi、Ywallet、Zingo、Zodl）才是用来支付每笔交易的——我们不会碰它。",
  },
  // Brai, 2026-09-07: "asi funciona el sistema de wallets en la otra
  // plataforma... el primero tiene que decir wallet de ZODD y sino importa
  // tu wallet de ZCASH" -- two-card breakdown of onboard.body.intro above
  // (kept for anywhere that still wants the one-paragraph version). Same
  // two-wallet distinction, just laid out as two visually separate cards
  // instead of one paragraph, so it reads as two DIFFERENT THINGS at a
  // glance instead of one dense sentence to parse.
  "onboard.cards.tokens.label": { en: "TOKENS", zh: "代币" },
  "onboard.cards.tokens.title": { en: "Your ZODD wallet", zh: "你的 ZODD 钱包" },
  "onboard.cards.tokens.body": {
    en: "Created here. Holds the tokens you buy; backed up once, with twelve words.",
    zh: "在这里创建，用于存放你买到的代币；只需备份一次，十二个助记词。",
  },
  "onboard.cards.money.label": { en: "MONEY", zh: "资金" },
  "onboard.cards.money.title": { en: "Your Zcash wallet", zh: "你的 Zcash 钱包" },
  "onboard.cards.money.body": {
    en: "Zodl, Ywallet, whichever you use. Holds your ZEC and pays for every trade; we never see it.",
    zh: "Zodl、Ywallet，随你用哪个。存放你的 ZEC，支付每一笔交易；我们看不到它。",
  },
  "onboard.cards.reassurance": { en: "Nothing here can touch your ZEC.", zh: "这里的任何东西都碰不到你的 ZEC。" },
  "onboard.cards.restoreHint": {
    en: "Bought here before? Restore your phrase: a new wallet will not find those tokens.",
    zh: "以前在这里买过？请恢复你的助记词——新建钱包找不到那些代币。",
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
  // Brai, 2026-09-18: "conectas la extension de la wallet NOIR para
  // navegador y ya te asocia tu wallet" -- third onboarding option.
  "onboard.noir.connectButton": { en: "Connect Noir Wallet", zh: "连接 Noir 钱包" },
  "onboard.noir.connecting": { en: "Connecting…", zh: "连接中…" },
  "onboard.noir.notInstalled": {
    en: "Noir Wallet isn't installed. Get the extension from the Chrome Web Store, then try again.",
    zh: "未安装 Noir 钱包。请从 Chrome 网上应用店安装扩展程序后重试。",
  },
  "onboard.noir.rejected": { en: "Connection request was closed before approving — try again when you're ready.", zh: "连接请求在批准前被关闭——准备好后请重试。" },

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
  "nft.whitelistBanner.label": { en: "NFT Whitelist is open", zh: "NFT 白名单现已开放" },
  "nft.whitelistBanner.cta": { en: "Enter to Whitelist", zh: "进入白名单" },

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
  "buy.youPay": { en: "You pay ({currency})", zh: "你支付（{currency}）" },
  "buy.button": { en: "Buy", zh: "买入" },
  "buy.sendAtLeast": { en: "Send at least {amount} {currency}: the address is the order", zh: "至少发送 {amount} {currency}：这个地址就是订单本身" },
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
  "buy.refundAddressLabel": { en: "Refund address (yours; kept on this device only)", zh: "退款地址（你的地址，仅保存在本设备）" },
  "buy.refundAddressHint": { en: "Must start with u1... or zs1... (transparent t1... addresses aren't accepted). If this order ever needs a manual refund, this is where it goes.", zh: "必须以 u1... 或 zs1... 开头（不接受透明的 t1... 地址）。如果这笔订单日后需要人工退款，会退到这个地址。" },
  // Brai, 2026-09-11: same as above but for a YEC order -- Ycash's shielded
  // addresses use the "ys1" prefix instead of "zs1".
  "buy.refundAddressHintYec": { en: "Must start with u1... or ys1... (transparent t1... addresses aren't accepted). If this order ever needs a manual refund, this is where it goes.", zh: "必须以 u1... 或 ys1... 开头（不接受透明的 t1... 地址）。如果这笔订单日后需要人工退款，会退到这个地址。" },
  "buy.error.invalidAddress": { en: "enter a valid shielded refund address (u1... or zs1...)", zh: "请输入有效的屏蔽式退款地址（u1... 或 zs1...）" },
  "buy.addressCopied": { en: "Copied", zh: "已复制" },

  // ---------- Sell modal ----------
  "sell.title": { en: "Sell {symbol}", zh: "卖出 {symbol}" },
  "sell.amountLabel": { en: "Amount ({symbol})", zh: "数量（{symbol}）" },
  "sell.balance": { en: "You have: {amount} {symbol}", zh: "你持有：{amount} {symbol}" },
  "sell.half": { en: "Half", zh: "一半" },
  "sell.max": { en: "Max", zh: "最大" },
  "sell.addressLabel": { en: "Your shielded Zcash address (payout)", zh: "你的屏蔽式 Zcash 地址（收款）" },
  "sell.addressHint": { en: "Must start with u1... or zs1... (transparent t1... addresses aren't accepted)", zh: "必须以 u1... 或 zs1... 开头（不接受透明的 t1... 地址）" },
  // Brai, 2026-09-11: same as above but for a YEC sell -- see the matching
  // buy.refundAddressHintYec.
  "sell.addressHintYec": { en: "Must start with u1... or ys1... (transparent t1... addresses aren't accepted)", zh: "必须以 u1... 或 ys1... 开头（不接受透明的 t1... 地址）" },
  "sell.button": { en: "Sell", zh: "卖出" },
  "sell.payoutSent": { en: "Payout sent", zh: "打款已发送" },
  "sell.payoutBody.real": { en: "{amount} {currency} sent to your address.", zh: "{amount} {currency} 已发送到你的地址。" },
  "sell.payoutBody.simulated": { en: "{amount} {currency} (simulated) to your address.", zh: "{amount} {currency}（模拟）已发送到你的地址。" },
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
  "activity.heading": { en: "LIVE ACTIVITY", zh: "实时动态" },
  "official.badge": { en: "OFFICIAL", zh: "官方" },
} as const satisfies Record<string, Record<Lang, string>>;

export type TranslationKey = keyof typeof translations;
