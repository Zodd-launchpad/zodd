const fs = require("fs");

function applyFix(path, edits) {
  const raw = fs.readFileSync(path, "utf8");
  const isCrlf = raw.includes("\r\n");
  let content = isCrlf ? raw.replace(/\r\n/g, "\n") : raw;
  const before = content;

  for (const [from, to] of edits) {
    content = content.split(from).join(to);
  }

  if (content === before) {
    console.error(`NADA CAMBIO en ${path} -- avisale a Claude.`);
    process.exit(1);
  }

  const out = isCrlf ? content.replace(/\n/g, "\r\n") : content;
  fs.writeFileSync(path, out);
  console.log(`OK ${path}`);
}

applyFix("frontend/lib/translations.ts", [
  [
    '  "nftMint.confirmButton": { en: "Mint now", zh: "????" },\n',
    '  "nftMint.confirmButton": { en: "Mint now", zh: "????" },\n' +
      '  "nftMint.freeMintButton": { en: "FREE MINT ({count})", zh: "????({count})" },\n' +
      '  "nftMint.buyButton": { en: "BUY", zh: "??" },\n' +
      '  "nftMint.total.free": { en: "FREE", zh: "??" },\n',
  ],
]);

applyFix("frontend/app/nft/test/mint/page.tsx", [
  [
    "  const [isSubmitting, setIsSubmitting] = useState(false);",
    '  const [submitting, setSubmitting] = useState("free_or_buy_placeholder");'.replace(
      '"free_or_buy_placeholder"',
      'null as "free" | "buy" | null'
    ),
  ],
  [
    "  const freeRemaining =\n    whitelistEntry && collection ? Math.max(0, collection.whitelistFreeMintLimit - whitelistEntry.claimedCount) : null;\n\n  const unitPriceZec",
    "  const freeRemaining =\n    whitelistEntry && collection ? Math.max(0, collection.whitelistFreeMintLimit - whitelistEntry.claimedCount) : null;\n  const freeMintQuantity = Math.max(0, Math.min(freeRemaining ?? 0, remainingWalletAllowance, remainingSupply));\n\n  const unitPriceZec",
  ],
  [
    "  async function startMint() {\n    if (!wallet) return;\n    setError(null);\n    setIsSubmitting(true);\n    try {\n      const result = await api.mintNft({ walletId: wallet.walletId, collectionSlug: COLLECTION_SLUG, quantity });",
    '  async function startMint(mintQuantity: number, which: "free" | "buy") {\n    if (!wallet || mintQuantity < 1) return;\n    setError(null);\n    setSubmitting(which);\n    try {\n      const result = await api.mintNft({ walletId: wallet.walletId, collectionSlug: COLLECTION_SLUG, quantity: mintQuantity });',
  ],
  [
    "    } catch (e: any) {\n      setError(e.message);\n    } finally {\n      setIsSubmitting(false);\n    }\n  }",
    "    } catch (e: any) {\n      setError(e.message);\n    } finally {\n      setSubmitting(null);\n    }\n  }",
  ],
  [
    '                  )}\n\n                  <div className="nft-mintpage-qty-row">',
    '                  )}\n\n' +
      '                  {freeMintQuantity > 0 && (\n' +
      '                    <button\n' +
      '                      className="btn btn-gold"\n' +
      '                      style={{ width: "100%", marginBottom: 12 }}\n' +
      '                      onClick={() => startMint(freeMintQuantity, "free")}\n' +
      '                      disabled={submitting !== null}\n' +
      '                    >\n' +
      '                      {submitting === "free" ? t("common.wait") : t("nftMint.freeMintButton", { count: freeMintQuantity })}\n' +
      '                    </button>\n' +
      '                  )}\n\n' +
      '                  <div className="nft-mintpage-qty-row">',
  ],
  [
    '                  {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}\n' +
      '                  <button className="btn btn-gold" style={{ width: "100%", marginTop: 10 }} onClick={startMint} disabled={isSubmitting}>\n' +
      '                    {isSubmitting ? t("common.wait") : t("nftMint.confirmButton")}\n' +
      '                  </button>',
    '                  {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}\n' +
      '                  <button\n' +
      '                    className="btn btn-outline"\n' +
      '                    style={{ width: "100%", marginTop: 10 }}\n' +
      '                    onClick={() => startMint(quantity, "buy")}\n' +
      '                    disabled={submitting !== null}\n' +
      '                  >\n' +
      '                    {submitting === "buy" ? t("common.wait") : t("nftMint.buyButton")}\n' +
      '                  </button>',
  ],
]);
