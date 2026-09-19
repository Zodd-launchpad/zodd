"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Brai, 2026-09-19: this route (/nft/test/item/<editionNumber>, no tier
// segment) is DEAD -- editionNumber moved to being scoped per tier (see
// nftItemPath in api.ts and the new .../item/[tier]/[editionNumber]/page.tsx
// route), so a bare edition number can't uniquely resolve to one item
// anymore. This file used to call api.getNftItem with the pre-migration
// 2-arg signature, which no longer type-checks now that api.ts requires a
// tier -- replaced with a stub so the build doesn't break. It just bounces
// straight to the marketplace grid. You can delete this whole
// frontend/app/nft/test/item/[editionNumber]/ folder whenever it's
// convenient -- this stub only exists so nothing breaks in the meantime.
export default function LegacyNftItemRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/nft/test");
  }, [router]);
  return null;
}
