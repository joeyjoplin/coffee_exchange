import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  SendTransactionError,
} from "@solana/web3.js";

import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

import { assert } from "chai";

// Type of your program account (you can replace `any` with the real IDL type if you have it)
type CoffeeExchangeProgram = Program<any>;

describe("coffee_exchange", () => {
  /**
   * 1) Anchor provider & program setup
   *
   * We use AnchorProvider.local(), which expects a local validator
   * on 127.0.0.1:8899. `anchor test` will handle booting it for us.
   */
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .coffee_exchange as CoffeeExchangeProgram;
  const connection = provider.connection;

  // Local wallet used by Anchor as payer/maker
  const payer = (provider.wallet as anchor.Wallet).payer;
  const maker = payer.publicKey;

  // Global vars shared between tests (we rely on Mocha's sequential execution)
  let tokenMintA: PublicKey;
  let tokenMintB: PublicKey;
  let makerTokenAccountA: PublicKey; // ATA of maker for Mint A
  let offerPda: PublicKey;
  let vault: PublicKey; // ATA of offer PDA for Mint A
  let tokenAOfferedAmount: anchor.BN;
  let tokenBWantedAmount: anchor.BN;
  const decimals = 6;

  it("Smoke Testing", async () => {
    console.log("Program ID: ", program.programId.toBase58());

    const expectedProgramId =
      "9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc";

    // We don't hard-fail here, only warn if there's a mismatch.
    if (program.programId.toBase58() !== expectedProgramId) {
      console.warn(
        "Warning: programId does not match expected. " +
          "Check if your Anchor.toml and declare_id! in lib.rs are aligned."
      );
    }

    assert.ok(program.programId instanceof PublicKey);
  });

  it("MAKE_OFFER with real mints and token accounts", async () => {
    /**
     * 2) Create Mint A and Mint B on the local validator
     */
    tokenMintA = await createMint(
      connection,
      payer,
      payer.publicKey, // mint authority
      null, // freeze authority
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    tokenMintB = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      decimals,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    console.log("tokenMintA:", tokenMintA.toBase58());
    console.log("tokenMintB:", tokenMintB.toBase58());

    /**
     * 3) Derive and create the maker's ATA for Mint A manually
     */
    makerTokenAccountA = await getAssociatedTokenAddress(
      tokenMintA,
      maker,
      false, // maker is an on-curve key
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Create the ATA via explicit transaction
    {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey, // payer for the ATA creation
          makerTokenAccountA,
          maker,
          tokenMintA,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [payer]);
    }

    console.log("makerTokenAccountA:", makerTokenAccountA.toBase58());

    /**
     * 4) Mint some amount of token A to the maker's ATA
     */
    tokenAOfferedAmount = new anchor.BN(1_000_000); // 1 token if decimals = 6

    await mintTo(
      connection,
      payer, // fee payer
      tokenMintA,
      makerTokenAccountA,
      payer, // mint authority
      tokenAOfferedAmount.toNumber(),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    /**
     * 5) Derive the PDA for the Offer account
     */
    const id = new anchor.BN(1);

    [offerPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("offer"),
        maker.toBuffer(),
        Buffer.from(id.toArray("le", 8)), // u64 little-endian
      ],
      program.programId
    );

    console.log("offerPda:", offerPda.toBase58());

    /**
     * 6) Compute the expected vault ATA for Offer + Mint A
     *    (this ATA will be created by the program using associated_token + init)
     */
    vault = await getAssociatedTokenAddress(
      tokenMintA,
      offerPda,
      true, // owner is PDA (off-curve)
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log("vault (ATA for offer+mintA):", vault.toBase58());

    /**
     * 7) Call make_offer on the program
     */
    tokenBWantedAmount = new anchor.BN(2_000_000); // arbitrary wanted amount in Mint B

    const txSig = await program.methods
      .makeOffer(id, tokenAOfferedAmount, tokenBWantedAmount)
      .accounts({
        maker,
        tokenMintA,
        tokenMintB,
        makerTokenAccountA,
        offer: offerPda,
        vault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("make_offer tx:", txSig);

    /**
     * 8) Validate on-chain state of the Offer account
     */
    const offerAccount: any = await program.account.offer.fetch(offerPda);

    assert.strictEqual(
      offerAccount.id.toNumber(),
      id.toNumber(),
      "Offer id mismatch"
    );
    assert.ok(offerAccount.maker.equals(maker), "Offer maker mismatch");
    assert.ok(
      offerAccount.tokenMintA.equals(tokenMintA),
      "Offer tokenMintA mismatch"
    );
    assert.ok(
      offerAccount.tokenMintB.equals(tokenMintB),
      "Offer tokenMintB mismatch"
    );
    assert.strictEqual(
      offerAccount.tokenBWantedAmount.toNumber(),
      tokenBWantedAmount.toNumber(),
      "Offer tokenBWantedAmount mismatch"
    );
  });

  it("TAKE_OFFER - transfer tokens and close offer & vault", async () => {
    /**
     * At this point we already have:
     * - tokenMintA, tokenMintB
     * - makerTokenAccountA
     * - offerPda & vault
     * - tokenBWantedAmount (what taker has to pay)
     */

    // 1) Create a taker (different signer from maker)
    const taker = Keypair.generate();

    // Airdrop SOL so the taker can pay for rent and fees
    const airdropSig = await connection.requestAirdrop(
      taker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    // 2) Derive and create taker's ATA for Mint B manually
    const takerTokenAccountB = await getAssociatedTokenAddress(
      tokenMintB,
      taker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey, // payer for ATA creation
          takerTokenAccountB,
          taker.publicKey, // owner
          tokenMintB,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [payer]);
    }

    console.log("takerTokenAccountB:", takerTokenAccountB.toBase58());

    // 3) Mint enough token B to the taker so they can pay the offer
    await mintTo(
      connection,
      payer, // fee payer
      tokenMintB,
      takerTokenAccountB,
      payer, // mint authority
      tokenBWantedAmount.toNumber(),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    // 4) Derive expected taker ATA for Mint A
    const takerTokenAccountAAddr = await getAssociatedTokenAddress(
      tokenMintA,
      taker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // 5) Derive expected maker ATA for Mint B
    const makerTokenAccountBAddr = await getAssociatedTokenAddress(
      tokenMintB,
      maker,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log(
      "takerTokenAccountA (expected):",
      takerTokenAccountAAddr.toBase58()
    );
    console.log(
      "makerTokenAccountB (expected):",
      makerTokenAccountBAddr.toBase58()
    );

    // 6) Call take_offer on the program
    const txSig = await program.methods
      .takeOffer()
      .accounts({
        taker: taker.publicKey,
        maker,
        tokenMintA,
        tokenMintB,
        takerTokenAccountA: takerTokenAccountAAddr,
        takerTokenAccountB,
        makerTokenAccountB: makerTokenAccountBAddr,
        offer: offerPda,
        vault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    console.log("take_offer tx:", txSig);

    // 7) Offer account must be closed (close = maker in TakeOffer)
    const offerAccountInfo = await connection.getAccountInfo(offerPda);
    assert.strictEqual(
      offerAccountInfo,
      null,
      "Offer account should be closed"
    );

    // 8) Vault ATA must also be closed
    const vaultInfo = await connection.getAccountInfo(vault);
    assert.strictEqual(
      vaultInfo,
      null,
      "Vault token account should be closed"
    );
  });

  /**
   * =========================
   * UNHAPPY PATH TESTS
   * =========================
   */

  it("MAKE_OFFER should fail if maker has insufficient token A balance", async () => {
    /**
     * At this point, after TAKE_OFFER:
     * - makerTokenAccountA no longer has token A (it was transferred to taker).
     * So any positive amount we try to offer again will cause
     * "insufficient funds" inside the SPL Token program.
     */

    const id = new anchor.BN(2);

    const [offerPda2] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("offer"),
        maker.toBuffer(),
        Buffer.from(id.toArray("le", 8)),
      ],
      program.programId
    );

    const vault2 = await getAssociatedTokenAddress(
      tokenMintA,
      offerPda2,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const tooMuch = new anchor.BN(5_000_000); // more than current balance (0)

    let failed = false;

    try {
      await program.methods
        .makeOffer(id, tooMuch, tokenBWantedAmount)
        .accounts({
          maker,
          tokenMintA,
          tokenMintB,
          makerTokenAccountA,
          offer: offerPda2,
          vault: vault2,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err: any) {
      failed = true;

      const sendErr = err as SendTransactionError;
      const logs: string[] = (sendErr as any).logs ?? [];

      console.log(
        "Expected make_offer failure (insufficient token A balance):",
        sendErr.message,
        logs
      );

      // Check that the SPL Token program complained about insufficient funds
      const hasInsufficientFunds = logs.some((l) =>
        l.includes("Error: insufficient funds")
      );
      assert.isTrue(
        hasInsufficientFunds,
        "Expected 'insufficient funds' error from SPL Token program"
      );
    }

    assert.isTrue(
      failed,
      "Expected make_offer to fail when maker has insufficient token A balance"
    );
  });

  it("MAKE_OFFER should fail if makerTokenAccountA is not maker's ATA", async () => {
    /**
     * Here we intentionally pass an ATA whose owner is NOT the maker.
     * This should trigger an Anchor `ConstraintTokenOwner` error on
     * the `maker_token_account_a` account in your context.
     */

    // Create a fake owner and its ATA for Mint A
    const fakeOwner = Keypair.generate();

    const fakeOwnerAta = await getAssociatedTokenAddress(
      tokenMintA,
      fakeOwner.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          fakeOwnerAta,
          fakeOwner.publicKey,
          tokenMintA,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      await provider.sendAndConfirm(tx, [payer]);
    }

    const id = new anchor.BN(3);

    const [offerPda3] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("offer"),
        maker.toBuffer(),
        Buffer.from(id.toArray("le", 8)),
      ],
      program.programId
    );

    const vault3 = await getAssociatedTokenAddress(
      tokenMintA,
      offerPda3,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let failed = false;

    try {
      await program.methods
        .makeOffer(id, new anchor.BN(1_000_000), tokenBWantedAmount)
        .accounts({
          maker,
          tokenMintA,
          tokenMintB,
          // INTENTIONALLY WRONG: not maker's ATA
          makerTokenAccountA: fakeOwnerAta,
          offer: offerPda3,
          vault: vault3,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (err: any) {
      failed = true;

      console.log(
        "Expected make_offer failure (wrong makerTokenAccountA / ATA constraint):",
        err?.message ?? err
      );

      // If we have logs, we try to parse them as an AnchorError
      const logs: string[] = (err as any).logs ?? [];
      if (logs.length > 0) {
        const anchorErr = anchor.AnchorError.parse(logs);
        assert.strictEqual(
          anchorErr.error.errorCode.code,
          "ConstraintTokenOwner",
          "Expected ConstraintTokenOwner Anchor error for maker_token_account_a"
        );
      }
    }

    assert.isTrue(
      failed,
      "Expected make_offer failure when makerTokenAccountA is not maker's ATA"
    );
  });

  it("TAKE_OFFER should fail if taker has insufficient token B balance", async () => {
    /**
     * We create a fresh offer where the maker offers token A again,
     * then we create a taker with an ATA for Mint B but we DO NOT
     * mint enough tokens to cover `tokenBWantedAmount`.
     * This should again trigger "Error: insufficient funds" inside
     * the SPL Token program during the transfer in `take_offer`.
     */

    // 1) Mint some token A back to the maker so a new offer can be created
    const newAmountA = new anchor.BN(1_000_000);

    await mintTo(
      connection,
      payer,
      tokenMintA,
      makerTokenAccountA,
      payer,
      newAmountA.toNumber(),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    // 2) Create a NEW offer (id = 4)
    const id = new anchor.BN(4);

    const [offerPda4] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("offer"),
        maker.toBuffer(),
        Buffer.from(id.toArray("le", 8)),
      ],
      program.programId
    );

    const vault4 = await getAssociatedTokenAddress(
      tokenMintA,
      offerPda4,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await program.methods
      .makeOffer(id, newAmountA, tokenBWantedAmount)
      .accounts({
        maker,
        tokenMintA,
        tokenMintB,
        makerTokenAccountA,
        offer: offerPda4,
        vault: vault4,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // 3) Create a new taker with almost no token B
    const poorTaker = Keypair.generate();

    const airdropSig = await connection.requestAirdrop(
      poorTaker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    const poorTakerTokenAccountB = await getAssociatedTokenAddress(
      tokenMintB,
      poorTaker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          poorTakerTokenAccountB,
          poorTaker.publicKey,
          tokenMintB,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      await provider.sendAndConfirm(tx, [payer]);
    }

    // Mint 0 or a very small amount of token B (definitely less than tokenBWantedAmount)
    const smallAmountB = new anchor.BN(1); // << way less than tokenBWantedAmount
    await mintTo(
      connection,
      payer,
      tokenMintB,
      poorTakerTokenAccountB,
      payer,
      smallAmountB.toNumber(),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    // 4) Derive expected ATA for taker (Mint A) and maker (Mint B)
    const poorTakerTokenAccountA = await getAssociatedTokenAddress(
      tokenMintA,
      poorTaker.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const makerTokenAccountBAddr = await getAssociatedTokenAddress(
      tokenMintB,
      maker,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let failed = false;

    try {
      await program.methods
        .takeOffer()
        .accounts({
          taker: poorTaker.publicKey,
          maker,
          tokenMintA,
          tokenMintB,
          takerTokenAccountA: poorTakerTokenAccountA,
          takerTokenAccountB: poorTakerTokenAccountB,
          makerTokenAccountB: makerTokenAccountBAddr,
          offer: offerPda4,
          vault: vault4,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([poorTaker])
        .rpc();
    } catch (err: any) {
      failed = true;

      const sendErr = err as SendTransactionError;
      const logs: string[] = (sendErr as any).logs ?? [];

      console.log(
        "Expected take_offer failure (insufficient token B balance for taker):",
        sendErr.message,
        logs
      );

      const hasInsufficientFunds = logs.some((l) =>
        l.includes("Error: insufficient funds")
      );
      assert.isTrue(
        hasInsufficientFunds,
        "Expected 'insufficient funds' error from SPL Token program in take_offer"
      );
    }

    assert.isTrue(
      failed,
      "Expected take_offer to fail when taker has insufficient token B balance"
    );
  });
});
