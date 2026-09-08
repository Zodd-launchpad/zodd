# zingolib patches

`0001-per-address-payment-diversifier.patch` is applied on top of a pinned
zingolib commit during the Docker build (see the Dockerfile) before
`zingo-cli` is compiled.

## What it does

zingo-cli never exposed which of a wallet's many diversified addresses a
given incoming note landed on -- only account/scope (always 0 so far).
That's why payment matching (see `backend/src/lib/zcashReal.ts`) has had to
rely on a decrypted memo, falling back to amount matching, instead of the
address itself -- even though the address IS the order
("la direccion ES la orden", same model as SHLD.fun).

The diversifier (ZIP 32 `d`) that identifies which address received a note
is already present in the note's own decrypted plaintext -- it's a basic
property of the Zcash protocol, not something zingo-cli would need to
compute or guess. `NoteInterface::note()` already returns "Decrypted note
with recipient and value"; this patch just reads the recipient's
diversifier back out and threads it through to the CLI's JSON output. No
wallet.dat format change, no new dependency (uses the `hex` crate already
in every affected crate's Cargo.toml).

Concretely, it adds:

- `NoteInterface::diversifier_bytes()` (pepper-sync/src/wallet.rs) --
  implemented for SaplingNote, OrchardNote, IronwoodNote.
- `diversifier_hex` on every note in the `notes` command's JSON output
  (zingolib/src/wallet/summary.rs, zingolib/src/wallet/summary/data.rs).
- `sapling_diversifier_hex` / `orchard_diversifier_hex` on every address in
  the `addresses` command's JSON output (zingolib/src/wallet.rs) AND on the
  address returned directly by `new_address` (zingo-cli/src/commands.rs) --
  ZODD's backend only ever calls the latter to mint an order's address, so
  both had to be patched, not just one.
- New tests (zingolib/src/wallet/summary.rs,
  zingo-cli/src/commands/tests.rs) proving: two different addresses'
  notes are never confused with each other even when their amounts are
  identical (both sapling and orchard); this holds at 5+ simultaneously
  open addresses, not just two; the SAME address receiving two separate
  payments reports the same diversifier both times, without ever
  colliding with a different order's address; `new_address` and
  `addresses` never disagree about the same address's diversifier.

## How it was validated (2026-09-08)

- `cargo test -p zingolib -p pepper-sync --lib` and `cargo test -p
  zingo-cli --lib`, patched vs. the unpatched base commit: byte-identical
  sets of pre-existing failures both ways (all environment-specific --
  blocked parameter/network downloads in a sandboxed dev environment,
  unrelated to this patch), and every one of this patch's own new tests
  passes. Zero regressions.
- Manually run against a real (testnet, throwaway, not connected to any
  real funds) wallet: `new_address` and `addresses` report matching,
  correct, distinct diversifier hex values per generated address and per
  shielded pool.

## Keeping this current

`ZINGOLIB_REF` in the Dockerfile is pinned to the exact commit this patch
was generated against. If zingolib needs to move forward (a real tagged
release ships, or a newer `dev` commit is needed for some other reason):

1. Clone zingolib at the new target commit.
2. `git apply --check zingolib-patches/0001-per-address-payment-diversifier.patch`
   -- if it fails, the patch needs to be regenerated against the new base
   (re-apply the same changes described above, or ask Claude to redo it).
3. Re-run the validation above before updating `ZINGOLIB_REF`.
