// Brai, 2026-09-21: "los nfts seran esos videos que son loops... ninguno
// tiene que reproducirse con audio" -- shared by every place that renders
// an NftItem's imageDataUrl (marketplace grid, item detail, mint reveal,
// portfolio) so the <video> vs <img> decision and the muted/loop/autoPlay
// attributes live in exactly one place instead of being copy-pasted four
// times. A tier-variant piece's imageDataUrl is now a URL under
// /api/nft/media/ (see toNftItemView's resolvedImage in backend/src/lib/store.ts)
// -- everything else (the old single-shared-image-per-tier fallback,
// manifest-seeded per-item images) is a real small data:image/... URL and
// keeps rendering as a plain <img>, unchanged.
export function isNftVideoUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  return src.includes("/api/nft/media/") || /\.(mp4|webm|mov)(\?|$)/i.test(src) || src.startsWith("data:video/");
}

export function NftMedia({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) return null;
  if (isNftVideoUrl(src)) {
    return (
      // Brai: "ninguno tiene que reproducirse con audio" -- muted is
      // required (not just polite) for autoPlay to be allowed by browsers
      // at all, so this also happens to be the only way autoplay works
      // reliably. playsInline keeps it from going fullscreen on iOS.
      <video src={src} className={className} autoPlay loop muted playsInline aria-label={alt} />
    );
  }
  return <img src={src} alt={alt} className={className} />;
}
