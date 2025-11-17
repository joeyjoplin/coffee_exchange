// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { WalletConnectButton } from "@/components/wallet-connect-button";
import { useSolana } from "@/components/solana-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------- Types & Constants ----------------------

type StatusType = "success" | "error";

interface StatusMessage {
  type: StatusType;
  message: string;
}

// Amount to mint on each Harvest button click
const INITIAL_MINT_AMOUNT = 100;

// RPC endpoint used to read and write on devnet
const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

// Keys used to cache mint addresses in localStorage
const LOCAL_STORAGE_MINT_A_KEY = "coffee_exchange_mint_arabica";
const LOCAL_STORAGE_MINT_B_KEY = "coffee_exchange_mint_robusta";

// Program ID for your on-chain coffee_exchange program
const COFFEE_EXCHANGE_PROGRAM_ID = import.meta.env
  .VITE_COFFEE_EXCHANGE_PROGRAM_ID as string;

// ---------------------- UI helpers ----------------------

function truncate(addr: string) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function StatusBanner({ status }: { status: StatusMessage | null }) {
  if (!status) return null;

  const baseClasses =
    "mt-4 rounded-lg px-4 py-3 text-sm shadow-md border flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1";
  const typeClasses =
    status.type === "success"
      ? "bg-green-50 border-green-200 text-green-800"
      : "bg-red-50 border-red-200 text-red-800";

  const emoji = status.type === "success" ? "✅" : "⚠️";

  return (
    <div className={cn(baseClasses, typeClasses)}>
      <span className="text-lg">{emoji}</span>
      <p>{status.message}</p>
    </div>
  );
}

// ---------------------- Low-level Solana helpers ----------------------

// Sends a transaction that may need both:
//  - local signers (e.g. newly generated Keypairs), and
//  - the connected Phantom wallet as fee payer.
async function sendAndConfirmWithWallet(
  connection: Connection,
  wallet: any, // Phantom provider from window.solana
  transaction: Transaction,
  extraSigners: Keypair[] = []
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");

  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  if (extraSigners.length > 0) {
    transaction.partialSign(...extraSigners);
  }

  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}

// Sends a transaction using ONLY a local Keypair as fee payer and signer.
// Used by the Taker when calling `take_offer`.
async function sendAndConfirmWithLocalSigner(
  connection: Connection,
  transaction: Transaction,
  signer: Keypair
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");

  transaction.recentBlockhash = blockhash;
  transaction.feePayer = signer.publicKey;

  transaction.sign(signer);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}

// Convert a JS number (<= 2^53) to a 8-byte little-endian buffer (u64)
// using BigInt. This matches Rust's `to_le_bytes()` for u64.
function u64ToLeBuffer(value: number): Buffer {
  const big = BigInt(value);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(big);
  return buf;
}

// Compute Anchor-style instruction discriminator:
// first 8 bytes of sha256("global:<name>")
async function getAnchorDiscriminator(globalName: string): Promise<Buffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(globalName);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const fullHash = new Uint8Array(hashBuffer);
  return Buffer.from(fullHash.slice(0, 8));
}

// Creates a new SPL mint with 0 decimals, using the connected wallet as:
//  - fee payer
//  - mint authority
//  - freeze authority
// Also creates the associated token account (ATA) for the wallet
// and mints `mintAmount` tokens into it.
async function createMintAndMintToWallet(
  connection: Connection,
  wallet: any,
  mintAmount: number
): Promise<{ mint: PublicKey; ata: PublicKey }> {
  const walletPubkey = wallet.publicKey as PublicKey;

  const mintKeypair = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const ata = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    walletPubkey
  );

  const tx = new Transaction();

  tx.add(
    SystemProgram.createAccount({
      fromPubkey: walletPubkey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      0,
      walletPubkey,
      walletPubkey,
      TOKEN_PROGRAM_ID
    ),
    createAssociatedTokenAccountInstruction(
      walletPubkey,
      ata,
      walletPubkey,
      mintKeypair.publicKey
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      ata,
      walletPubkey,
      mintAmount
    )
  );

  await sendAndConfirmWithWallet(connection, wallet, tx, [mintKeypair]);

  return { mint: mintKeypair.publicKey, ata };
}

// Mints more tokens to an existing mint and its ATA for the wallet.
async function mintMoreToExistingMint(
  connection: Connection,
  wallet: any,
  mintAddress: PublicKey,
  mintAmount: number
): Promise<void> {
  const walletPubkey = wallet.publicKey as PublicKey;

  const ata = await getAssociatedTokenAddress(mintAddress, walletPubkey);
  const tx = new Transaction();

  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        walletPubkey,
        ata,
        walletPubkey,
        mintAddress
      )
    );
  }

  tx.add(
    createMintToInstruction(mintAddress, ata, walletPubkey, mintAmount)
  );

  await sendAndConfirmWithWallet(connection, wallet, tx);
}

// Reads on-chain balances for the two mints (if they exist) for the given owner.
async function fetchOnChainBalances(
  connection: Connection,
  owner: PublicKey,
  mintAAddress: string | null,
  mintBAddress: string | null
): Promise<{ balanceA: number; balanceB: number }> {
  if (!mintAAddress || !mintBAddress) {
    return { balanceA: 0, balanceB: 0 };
  }

  const mintA = new PublicKey(mintAAddress);
  const mintB = new PublicKey(mintBAddress);

  const [ataA, ataB] = await Promise.all([
    getAssociatedTokenAddress(mintA, owner),
    getAssociatedTokenAddress(mintB, owner),
  ]);

  const [balanceAResult, balanceBResult] = await Promise.all([
    connection.getTokenAccountBalance(ataA).catch(() => null),
    connection.getTokenAccountBalance(ataB).catch(() => null),
  ]);

  const uiAmountA = balanceAResult?.value?.uiAmount ?? 0;
  const uiAmountB = balanceBResult?.value?.uiAmount ?? 0;

  return { balanceA: uiAmountA, balanceB: uiAmountB };
}

// Derives the PDA for an offer using the same seeds as in your Rust program:
// seeds = [b"offer", maker.key().as_ref(), &id.to_le_bytes()]
function deriveOfferPda(
  programId: PublicKey,
  maker: PublicKey,
  id: number
): [PublicKey, number] {
  const idBytes = u64ToLeBuffer(id);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("offer"), maker.toBuffer(), idBytes],
    programId
  );
}

// ---------------------- React Component ----------------------

function App() {
  const { isConnected, selectedAccount } = useSolana();

  // Maker is the connected wallet account (Phantom, etc.)
  const makerAddress = selectedAccount?.address ?? "";

  // Taker is a random Keypair generated once on page load (simulated user)
  const [takerKeypair] = useState(() => Keypair.generate());

  // Maker balances (Arabica / Robusta)
  const [tokenABalance, setTokenABalance] = useState(0);
  const [tokenBBalance, setTokenBBalance] = useState(0);

  // Offer form state
  const [offerTokenA, setOfferTokenA] = useState("");
  const [offerTokenB, setOfferTokenB] = useState("");

  // Last on-chain offer created in this session
  const [lastOfferId, setLastOfferId] = useState<number | null>(null);
  const [lastOfferWantedB, setLastOfferWantedB] = useState<number | null>(null);

  // Separate processing flags
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [isCreatingOffer, setIsCreatingOffer] = useState(false);
  const [isTakingOffer, setIsTakingOffer] = useState(false);

  const [status, setStatus] = useState<StatusMessage | null>(null);

  const connectedLabel = useMemo(() => {
    if (!isConnected || !makerAddress) {
      return "No wallet connected. Please connect to start exchanging coffee beans.";
    }
    return `Maker (you): ${truncate(makerAddress)}`;
  }, [isConnected, makerAddress]);

  const takerLabel = useMemo(
    () => `Taker (simulated): ${truncate(takerKeypair.publicKey.toBase58())}`,
    [takerKeypair]
  );

  const showError = (message: string) => {
    setStatus({ type: "error", message });
  };

  const showSuccess = (message: string) => {
    setStatus({ type: "success", message });
  };

  // Load balances whenever wallet connects and mints exist
  useEffect(() => {
    const loadBalancesIfMintsExist = async () => {
      if (!isConnected || !selectedAccount) return;

      const mintAAddress = localStorage.getItem(LOCAL_STORAGE_MINT_A_KEY);
      const mintBAddress = localStorage.getItem(LOCAL_STORAGE_MINT_B_KEY);

      if (!mintAAddress || !mintBAddress) {
        setTokenABalance(0);
        setTokenBBalance(0);
        return;
      }

      try {
        const connection = new Connection(RPC_ENDPOINT, "confirmed");
        const owner = new PublicKey(selectedAccount.address);

        const { balanceA, balanceB } = await fetchOnChainBalances(
          connection,
          owner,
          mintAAddress,
          mintBAddress
        );

        setTokenABalance(balanceA);
        setTokenBBalance(balanceB);

        showSuccess(
          `On-chain balances loaded 🌐 You currently have ${balanceA} ☕ Arabica and ${balanceB} ☕ Robusta on devnet.`
        );
      } catch (error) {
        console.error("Failed to load token balances from devnet:", error);
        showError(
          "Could not read your token balances from devnet. Please try again after refreshing the page."
        );
      }
    };

    void loadBalancesIfMintsExist();
  }, [isConnected, selectedAccount]);

  // ------------------------- Harvest -------------------------

  const handleHarvest = async () => {
    if (!isConnected || !makerAddress || !selectedAccount) {
      showError("Please connect your wallet before harvesting new coffee beans.");
      return;
    }

    const wallet = (window as any).solana;
    if (!wallet || !wallet.publicKey) {
      showError(
        "No compatible Solana wallet found in the browser. Please use Phantom or a similar wallet."
      );
      return;
    }

    setIsHarvesting(true);
    try {
      const connection = new Connection(RPC_ENDPOINT, "confirmed");
      const owner = new PublicKey(selectedAccount.address);

      let mintAAddress = localStorage.getItem(LOCAL_STORAGE_MINT_A_KEY);
      let mintBAddress = localStorage.getItem(LOCAL_STORAGE_MINT_B_KEY);

      if (!mintAAddress || !mintBAddress) {
        const { mint: mintA } = await createMintAndMintToWallet(
          connection,
          wallet,
          INITIAL_MINT_AMOUNT
        );
        const { mint: mintB } = await createMintAndMintToWallet(
          connection,
          wallet,
          INITIAL_MINT_AMOUNT
        );

        mintAAddress = mintA.toBase58();
        mintBAddress = mintB.toBase58();

        localStorage.setItem(LOCAL_STORAGE_MINT_A_KEY, mintAAddress);
        localStorage.setItem(LOCAL_STORAGE_MINT_B_KEY, mintBAddress);

        showSuccess(
          `First harvest created 🌾 New mints deployed on devnet and ${INITIAL_MINT_AMOUNT} tokens of each type were minted to your wallet.`
        );
      } else {
        await mintMoreToExistingMint(
          connection,
          wallet,
          new PublicKey(mintAAddress),
          INITIAL_MINT_AMOUNT
        );
        await mintMoreToExistingMint(
          connection,
          wallet,
          new PublicKey(mintBAddress),
          INITIAL_MINT_AMOUNT
        );

        showSuccess(
          `Harvest complete 🌾 You received +${INITIAL_MINT_AMOUNT} ☕ Arabica and +${INITIAL_MINT_AMOUNT} ☕ Robusta (on-chain).`
        );
      }

      const { balanceA, balanceB } = await fetchOnChainBalances(
        connection,
        owner,
        mintAAddress,
        mintBAddress
      );

      setTokenABalance(balanceA);
      setTokenBBalance(balanceB);
    } catch (err) {
      console.error("Error while harvesting (on-chain):", err);
      showError(
        "Unexpected error while executing the harvest transaction. Please check your wallet and try again."
      );
    } finally {
      setIsHarvesting(false);
    }
  };

  // ------------------------- make_offer (Maker) -------------------------

  const handleCreateOffer = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isConnected || !makerAddress || !selectedAccount) {
      showError("Connect your wallet before creating an offer.");
      return;
    }

    const wallet = (window as any).solana;
    if (!wallet || !wallet.publicKey) {
      showError(
        "No compatible Solana wallet found in the browser. Please use Phantom or a similar wallet."
      );
      return;
    }

    const amountA = Number(offerTokenA);
    const amountB = Number(offerTokenB);

    if (!amountA || amountA <= 0 || !Number.isFinite(amountA)) {
      showError("Please enter a valid amount of Arabica to offer.");
      return;
    }

    if (!amountB || amountB <= 0 || !Number.isFinite(amountB)) {
      showError("Please enter a valid amount of Robusta you want to receive.");
      return;
    }

    if (amountA > tokenABalance) {
      showError(
        `You do not have enough Arabica ☕. Available: ${tokenABalance}, tried to offer: ${amountA}.`
      );
      return;
    }

    const mintAAddress = localStorage.getItem(LOCAL_STORAGE_MINT_A_KEY);
    const mintBAddress = localStorage.getItem(LOCAL_STORAGE_MINT_B_KEY);

    if (!mintAAddress || !mintBAddress) {
      showError(
        "No coffee mints found on this session. Please run a Harvest at least once before creating an offer."
      );
      return;
    }

    setIsCreatingOffer(true);
    try {
      const connection = new Connection(RPC_ENDPOINT, "confirmed");
      const makerPubkey = new PublicKey(selectedAccount.address);
      const mintA = new PublicKey(mintAAddress);
      const mintB = new PublicKey(mintBAddress);
      const programId = new PublicKey(COFFEE_EXCHANGE_PROGRAM_ID);

      const offerId = Date.now(); // safe JS integer

      const [offerPda] = deriveOfferPda(programId, makerPubkey, offerId);

      const makerTokenAccountA = await getAssociatedTokenAddress(
        mintA,
        makerPubkey
      );

      const vault = await getAssociatedTokenAddress(
        mintA,
        offerPda,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const discriminator = await getAnchorDiscriminator("global:make_offer");
      const data = Buffer.concat([
        discriminator,
        u64ToLeBuffer(offerId),
        u64ToLeBuffer(amountA),
        u64ToLeBuffer(amountB),
      ]);

      const keys = [
        { pubkey: makerPubkey, isSigner: true, isWritable: true },
        { pubkey: mintA, isSigner: false, isWritable: false },
        { pubkey: mintB, isSigner: false, isWritable: false },
        { pubkey: makerTokenAccountA, isSigner: false, isWritable: true },
        { pubkey: offerPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
      ];

      const ix = new TransactionInstruction({
        programId,
        keys,
        data,
      });

      const tx = new Transaction().add(ix);

      await sendAndConfirmWithWallet(connection, wallet, tx);

      setLastOfferId(offerId);
      setLastOfferWantedB(amountB);

      const { balanceA, balanceB } = await fetchOnChainBalances(
        connection,
        makerPubkey,
        mintAAddress,
        mintBAddress
      );

      setTokenABalance(balanceA);
      setTokenBBalance(balanceB);

      showSuccess(
        `On-chain offer created successfully! ☕ You offered ${amountA} Arabica for ${amountB} Robusta.`
      );

      setOfferTokenA("");
      setOfferTokenB("");
    } catch (err) {
      console.error("Error while creating on-chain offer:", err);
      showError(
        "Unexpected error while creating the on-chain offer. Please check your wallet and RPC connection, then try again."
      );
    } finally {
      setIsCreatingOffer(false);
    }
  };

  // ------------------------- take_offer (Taker) -------------------------

  const handleTakeOffer = async () => {
    if (!isConnected || !makerAddress || !selectedAccount) {
      showError("Connect your wallet (Maker) before taking an offer.");
      return;
    }

    if (lastOfferId === null) {
      showError("There is no on-chain offer to take. Create one first.");
      return;
    }

    const wallet = (window as any).solana;
    if (!wallet || !wallet.publicKey) {
      showError(
        "No compatible Solana wallet found in the browser. Please use Phantom or a similar wallet."
      );
      return;
    }

    const mintAAddress = localStorage.getItem(LOCAL_STORAGE_MINT_A_KEY);
    const mintBAddress = localStorage.getItem(LOCAL_STORAGE_MINT_B_KEY);

    if (!mintAAddress || !mintBAddress) {
      showError(
        "No coffee mints found for this session. Please run a Harvest and create an offer first."
      );
      return;
    }

    setIsTakingOffer(true);
    try {
      const connection = new Connection(RPC_ENDPOINT, "confirmed");
      const makerPubkey = new PublicKey(selectedAccount.address);
      const takerPubkey = takerKeypair.publicKey;
      const mintA = new PublicKey(mintAAddress);
      const mintB = new PublicKey(mintBAddress);
      const programId = new PublicKey(COFFEE_EXCHANGE_PROGRAM_ID);

      // 1) Ensure Taker has enough SOL (funded by Maker instead of airdrop)
      const currentBalance = await connection.getBalance(takerPubkey);
      const minBalanceLamports = 0.05 * LAMPORTS_PER_SOL;

      if (currentBalance < minBalanceLamports) {
        const txFund = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: makerPubkey,
            toPubkey: takerPubkey,
            lamports: 0.1 * LAMPORTS_PER_SOL,
          })
        );

        await sendAndConfirmWithWallet(connection, wallet, txFund);
      }

      // 2) Ensure Taker has an ATA for Token B with enough Robusta
      const takerTokenAccountB = await getAssociatedTokenAddress(
        mintB,
        takerPubkey
      );
      const infoB = await connection.getAccountInfo(takerTokenAccountB);

      const amountNeededB =
        lastOfferWantedB && lastOfferWantedB > INITIAL_MINT_AMOUNT
          ? lastOfferWantedB
          : INITIAL_MINT_AMOUNT;

      if (!infoB) {
        const txFundTaker = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            takerTokenAccountB,
            takerPubkey,
            mintB
          ),
          createMintToInstruction(
            mintB,
            takerTokenAccountB,
            wallet.publicKey,
            amountNeededB
          )
        );

        await sendAndConfirmWithWallet(connection, wallet, txFundTaker);
      } else {
        const balResult = await connection
          .getTokenAccountBalance(takerTokenAccountB)
          .catch(() => null);
        const currentB = balResult?.value?.uiAmount ?? 0;

        if (currentB < amountNeededB) {
          const toMint = amountNeededB - currentB;
          const txMintMore = new Transaction().add(
            createMintToInstruction(
              mintB,
              takerTokenAccountB,
              wallet.publicKey,
              toMint
            )
          );
          await sendAndConfirmWithWallet(connection, wallet, txMintMore);
        }
      }

      // 3) Build all accounts for `take_offer`

      const takerTokenAccountA = await getAssociatedTokenAddress(
        mintA,
        takerPubkey
      );

      const makerTokenAccountB = await getAssociatedTokenAddress(
        mintB,
        makerPubkey
      );

      const [offerPda] = deriveOfferPda(programId, makerPubkey, lastOfferId);

      const vault = await getAssociatedTokenAddress(
        mintA,
        offerPda,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // 4) Instruction data for `take_offer` (discriminator only)
      const takeDiscriminator = await getAnchorDiscriminator("global:take_offer");
      const data = takeDiscriminator;

      const keys = [
        { pubkey: takerPubkey, isSigner: true, isWritable: true }, // taker
        { pubkey: makerPubkey, isSigner: false, isWritable: true }, // maker
        { pubkey: mintA, isSigner: false, isWritable: false },
        { pubkey: mintB, isSigner: false, isWritable: false },
        { pubkey: takerTokenAccountA, isSigner: false, isWritable: true },
        { pubkey: takerTokenAccountB, isSigner: false, isWritable: true },
        { pubkey: makerTokenAccountB, isSigner: false, isWritable: true },
        { pubkey: offerPda, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
      ];

      const ix = new TransactionInstruction({
        programId,
        keys,
        data,
      });

      const tx = new Transaction().add(ix);

      // 5) Taker pays fees and signs
      await sendAndConfirmWithLocalSigner(connection, tx, takerKeypair);

      // 6) Refresh Maker balances after the swap
      const { balanceA, balanceB } = await fetchOnChainBalances(
        connection,
        makerPubkey,
        mintAAddress,
        mintBAddress
      );

      setTokenABalance(balanceA);
      setTokenBBalance(balanceB);

      showSuccess(
        "Offer taken successfully! 🤝 Taker sent Robusta and received Arabica from the vault."
      );
    } catch (err) {
      console.error("Error while taking offer on-chain:", err);
      showError(
        "Unexpected error while taking the on-chain offer. Check the console and make sure the offer is still valid."
      );
    } finally {
      setIsTakingOffer(false);
    }
  };

  // ------------------------- JSX -------------------------

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-amber-50 via-amber-100 to-orange-100 flex items-center justify-center px-4 py-8 overflow-x-hidden">
      <div className="w-full max-w-5xl bg-card border border-border rounded-2xl shadow-xl p-6 md:p-8 space-y-6 animate-in fade-in slide-in-from-bottom-2">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight flex items-center gap-3">
              <span>☕ Coffee Exchange</span>
              <span className="text-2xl">🫘</span>
            </h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              Trade Arabica and Robusta beans on-chain — one delicious swap at a time.
            </p>
          </div>
          <div className="flex-shrink-0">
            <WalletConnectButton />
          </div>
        </header>

        {/* Session box */}
        <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Session
            </span>
            <span className="text-sm font-medium text-amber-900 flex items-center gap-2">
              <span>{connectedLabel}</span>
              {!isConnected && <span className="animate-pulse text-lg">🔌</span>}
            </span>
            <span className="text-xs text-amber-800">{takerLabel}</span>
            {lastOfferId !== null && (
              <span className="text-[11px] text-amber-900">
                Last on-chain offer ID (internal):{" "}
                <span className="font-mono">
                  {lastOfferId.toString()}
                </span>
              </span>
            )}
          </div>
          <div className="text-xs md:text-sm text-amber-800 flex items-center gap-2">
            {!isConnected ? (
              <>
                <span role="img" aria-label="point-right">
                  👉
                </span>
                <span>Connect your wallet to start harvesting and trading beans.</span>
              </>
            ) : (
              <>
                <span role="img" aria-label="fire">
                  🔥
                </span>
                <span>You are ready to brew some on-chain coffee swaps.</span>
              </>
            )}
          </div>
        </section>

        {/* Balances + Harvest */}
        <section className="grid md:grid-cols-[2fr,1fr] gap-4 md:gap-6 items-stretch">
          {/* Balances */}
          <div className="rounded-2xl border bg-background p-4 md:p-5 shadow-sm">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <span>My Coffee Beans</span>
              <span className="text-xl">🧺</span>
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              These are your available beans for making offers (on-chain balances on
              devnet).
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border bg-amber-50/80 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">☕</span>
                  <div>
                    <p className="text-sm font-semibold">Arabica (Token A)</p>
                    <p className="text-xs text-muted-foreground">
                      Smooth &amp; aromatic — premium beans.
                    </p>
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums">{tokenABalance}</p>
              </div>

              <div className="flex items-center justify-between rounded-xl border bg-amber-50/80 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🌋</span>
                  <div>
                    <p className="text-sm font-semibold">Robusta (Token B)</p>
                    <p className="text-xs text-muted-foreground">
                      Strong &amp; bold — perfect for swaps.
                    </p>
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums">{tokenBBalance}</p>
              </div>
            </div>
          </div>

          {/* Harvest */}
          <div className="rounded-2xl border bg-gradient-to-br from-emerald-50 to-emerald-100 p-4 flex flex-col justify-between shadow-sm">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-1">
                <span>Harvest</span>
                <span className="text-xl">🌱</span>
              </h2>
              <p className="text-xs text-emerald-900 mb-3">
                Mint a fresh batch of beans on devnet. Each harvest adds{" "}
                <span className="font-semibold">{INITIAL_MINT_AMOUNT}</span> Arabica and{" "}
                <span className="font-semibold">{INITIAL_MINT_AMOUNT}</span> Robusta
                tokens to your wallet.
              </p>
            </div>
            <Button
              variant="default"
              className={cn(
                "w-full mt-2 font-semibold",
                "transition-transform active:scale-95",
                (!isConnected || isHarvesting) && "cursor-not-allowed opacity-60"
              )}
              onClick={handleHarvest}
              disabled={!isConnected || isHarvesting}
            >
              {isHarvesting ? "Processing harvest..." : "🌾 Harvest More Beans"}
            </Button>
          </div>
        </section>

        {/* Offer + Take */}
        <section className="rounded-2xl border bg-background p-4 md:p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <span>Create Coffee Offer</span>
              <span className="text-xl">🤝</span>
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Define how many Arabica beans you want to offer and how many Robusta beans
              you would like in return. This calls the on-chain coffee_exchange program (
              <code>make_offer</code>).
            </p>

            <form
              onSubmit={handleCreateOffer}
              className="grid md:grid-cols-2 gap-4 md:gap-6 items-end"
            >
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Arabica Offered (Token A)
                </label>
                <div className="flex items-center gap-2 rounded-xl border bg-amber-50/60 px-3 py-2">
                  <span className="text-xl">☕</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={offerTokenA}
                    onChange={(e) => setOfferTokenA(e.target.value)}
                    className="w-full bg-transparent outline-none text-sm"
                    placeholder="e.g. 10"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Available: <span className="font-semibold">{tokenABalance}</span>{" "}
                  Arabica.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Robusta Wanted (Token B)
                </label>
                <div className="flex items-center gap-2 rounded-xl border bg-amber-50/60 px-3 py-2">
                  <span className="text-xl">🌋</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={offerTokenB}
                    onChange={(e) => setOfferTokenB(e.target.value)}
                    className="w-full bg-transparent outline-none text-sm"
                    placeholder="e.g. 20"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This is the amount of Robusta you expect in the swap.
                </p>
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button
                  type="submit"
                  className={cn(
                    "font-semibold px-6",
                    "transition-transform active:scale-95",
                    (!isConnected || isCreatingOffer) &&
                      "opacity-60 cursor-not-allowed"
                  )}
                  disabled={!isConnected || isCreatingOffer}
                >
                  {isCreatingOffer
                    ? "Brewing on-chain offer..."
                    : "☕ Create On-chain Offer"}
                </Button>
              </div>
            </form>
          </div>

          <div className="pt-4 border-t border-dashed mt-2">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <span>Take Coffee Offer as Taker</span>
              <span className="text-lg">🧍‍♀️</span>
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              This uses the simulated taker wallet to send Robusta and receive Arabica
              from the vault on-chain (<code>take_offer</code>).
            </p>
            <Button
              variant="outline"
              className={cn(
                "font-semibold px-4",
                "transition-transform active:scale-95",
                (!isConnected || !lastOfferId || isTakingOffer) &&
                  "opacity-60 cursor-not-allowed"
              )}
              disabled={!isConnected || !lastOfferId || isTakingOffer}
              onClick={handleTakeOffer}
            >
              {isTakingOffer
                ? "Executing on-chain swap..."
                : "🤝 Take Last On-chain Offer"}
            </Button>
            {!lastOfferId && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Create an on-chain offer first to enable this action.
              </p>
            )}
          </div>

          <StatusBanner status={status} />
        </section>
      </div>
    </div>
  );
}

export default App;





