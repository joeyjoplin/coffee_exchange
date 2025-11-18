# Project Description

**Deployed Frontend URL:** [TODO: Link to your deployed frontend]

**Solana Program ID:** 9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc
**Solana Program ID:** 9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc

## Project Overview

### Description
Coffee Exchange is a decentralized peer-to-peer swap market for coffee commodity tokens built on Solana.
Users can mint two SPL tokens representing different types of coffee beans:

- Arabica (Token A)

- Robusta (Token B)

A wallet connected through the frontend acts as the Maker, creating offers on-chain by locking Arabica tokens inside a secure PDA-owned vault. A simulated Keypair acts as a Taker, accepting offers by sending Robusta and receiving the locked Arabica in return.

The dApp demonstrates:
- PDA-secured vaults
- Two-sided token escrow
- Anchor instruction encoding
- SPL token minting via frontend
- Cross-signer flows (Maker = wallet, Taker = local Keypair)
- Programmatically derived ATAs
- Secure token transfers and account closing

This is a complete real-world example of building a custom escrow on Solana without using Serum or a central orderbook.
Coffee Exchange is a decentralized peer-to-peer swap market for coffee commodity tokens built on Solana.
Users can mint two SPL tokens representing different types of coffee beans:

- Arabica (Token A)

- Robusta (Token B)

A wallet connected through the frontend acts as the Maker, creating offers on-chain by locking Arabica tokens inside a secure PDA-owned vault. A simulated Keypair acts as a Taker, accepting offers by sending Robusta and receiving the locked Arabica in return.

The dApp demonstrates:
- PDA-secured vaults
- Two-sided token escrow
- Anchor instruction encoding
- SPL token minting via frontend
- Cross-signer flows (Maker = wallet, Taker = local Keypair)
- Programmatically derived ATAs
- Secure token transfers and account closing

This is a complete real-world example of building a custom escrow on Solana without using Serum or a central orderbook.

### Key Features

- Mint Commodity Tokens (Arabica / Robusta): Users can mint SPL tokens directly from the frontend using their wallet as the mint authority.
- Create On-chain Offer (Maker): Lock Arabica tokens inside a PDA-owned vault and specify how much Robusta you want in return.
- Take Offer (Taker): A simulated user accepts the offer by sending Robusta and receiving Arabica from the vault.
- PDA-Based Vaults: Every offer creates a deterministic PDA account that owns the vault ATA, ensuring full trustlessness.
- Automatic Token Account Creation: The program and frontend create ATAs as needed for Maker, Taker, and the vault.
- Safe Token Settlement: Transfers use TransferChecked to enforce mint decimals and avoid tampering.

- Mint Commodity Tokens (Arabica / Robusta): Users can mint SPL tokens directly from the frontend using their wallet as the mint authority.
- Create On-chain Offer (Maker): Lock Arabica tokens inside a PDA-owned vault and specify how much Robusta you want in return.
- Take Offer (Taker): A simulated user accepts the offer by sending Robusta and receiving Arabica from the vault.
- PDA-Based Vaults: Every offer creates a deterministic PDA account that owns the vault ATA, ensuring full trustlessness.
- Automatic Token Account Creation: The program and frontend create ATAs as needed for Maker, Taker, and the vault.
- Safe Token Settlement: Transfers use TransferChecked to enforce mint decimals and avoid tampering.
  
### How to Use the dApp
1. Connect Wallet:Connect Phantom or any Solana wallet supported by the Solana Provider.

2. Harvest Coffee Beans (Mint Tokens): Click Harvest to mint Arabica and Robusta to your wallet.
- First click: creates both mints
- Next clicks: mint more tokens

3. Create On-chain Offer (Maker): Choose how much Arabica you want to offer
- Choose how much Arabica you want to offer
- Choose how much Robusta you want in return
- Click Create On-chain Offer: This sends make_offer to the Anchor program.

4. Take Offer (Taker): 
- A simulated Keypair takes the offer
- The Taker sends Robusta
- The Taker receives the Arabica locked in the vaul. This executes take_offer.

5. Balances Update Automatically
- The UI queries devnet to show fresh token balances after each action.
1. Connect Wallet:Connect Phantom or any Solana wallet supported by the Solana Provider.

2. Harvest Coffee Beans (Mint Tokens): Click Harvest to mint Arabica and Robusta to your wallet.
- First click: creates both mints
- Next clicks: mint more tokens

3. Create On-chain Offer (Maker): Choose how much Arabica you want to offer
- Choose how much Arabica you want to offer
- Choose how much Robusta you want in return
- Click Create On-chain Offer: This sends make_offer to the Anchor program.

4. Take Offer (Taker): 
- A simulated Keypair takes the offer
- The Taker sends Robusta
- The Taker receives the Arabica locked in the vaul. This executes take_offer.

5. Balances Update Automatically
- The UI queries devnet to show fresh token balances after each action.

## Program Architecture
The program follows a two-instruction escrow architecture with separate logic for:
- Creating an offer (Maker)
- Accepting an offer (Taker)
- Each offer creates a PDA-owned vault that holds the locked Arabica. Only the PDA can release these funds.
The program follows a two-instruction escrow architecture with separate logic for:
- Creating an offer (Maker)
- Accepting an offer (Taker)
- Each offer creates a PDA-owned vault that holds the locked Arabica. Only the PDA can release these funds.

### PDA Usage
The dApp uses a single deterministic PDA to store and control escrow vaults.
Seeds:
[b"offer", maker_pubkey, offer_id_le_bytes]
The dApp uses a single deterministic PDA to store and control escrow vaults.
Seeds:
[b"offer", maker_pubkey, offer_id_le_bytes]

**PDAs Used:**
Offer PDA:
- Purpose: Stores offer metadata and acts as the authority of the vault ATA
- Controls: Locked Arabica tokens
- Seeds: "offer", maker_pubkey, id.to_le_bytes()
Offer PDA:
- Purpose: Stores offer metadata and acts as the authority of the vault ATA
- Controls: Locked Arabica tokens
- Seeds: "offer", maker_pubkey, id.to_le_bytes()

### Program Instructions
1. make_offer
Creates an on-chain offer:
- Initializes the Offer account at the PDA address
- Creates a vault ATA owned by the PDA
- Transfers Arabica from Maker’s ATA → PDA vault
- Stores:
- maker pubkey
- token mint addresses
- offered amount A
- wanted amount B
- bump
High-level flow:
Maker → transfers Token A → Vault PDA
Program → saves offer metadata

2. take_offer
Allows a taker to accept the Maker's offer:
- Transfers Robusta from Taker → Maker
- PDA releases Arabica from vault → Taker
- PDA closes the vault ATA and returns rent to the Maker
- Offer account is automatically closed

High-level flow:
Taker → sends Token B → Maker
PDA → releases Token A → Taker
PDA → closes vault → sends rent to Maker
1. make_offer
Creates an on-chain offer:
- Initializes the Offer account at the PDA address
- Creates a vault ATA owned by the PDA
- Transfers Arabica from Maker’s ATA → PDA vault
- Stores:
- maker pubkey
- token mint addresses
- offered amount A
- wanted amount B
- bump
High-level flow:
Maker → transfers Token A → Vault PDA
Program → saves offer metadata

2. take_offer
Allows a taker to accept the Maker's offer:
- Transfers Robusta from Taker → Maker
- PDA releases Arabica from vault → Taker
- PDA closes the vault ATA and returns rent to the Maker
- Offer account is automatically closed

High-level flow:
Taker → sends Token B → Maker
PDA → releases Token A → Taker
PDA → closes vault → sends rent to Maker

### Account Structure

```rust
#[account]
pub struct Offer {
    pub id: u64,                // Unique offer ID
    pub maker: Pubkey,          // Maker's wallet
    pub token_mint_a: Pubkey,   // Mint for Arabica
    pub token_mint_b: Pubkey,   // Mint for Robusta
    pub token_b_wanted_amount: u64, // How much Robusta Maker wants
    pub bump: u8,               // PDA bump
pub struct Offer {
    pub id: u64,                // Unique offer ID
    pub maker: Pubkey,          // Maker's wallet
    pub token_mint_a: Pubkey,   // Mint for Arabica
    pub token_mint_b: Pubkey,   // Mint for Robusta
    pub token_b_wanted_amount: u64, // How much Robusta Maker wants
    pub bump: u8,               // PDA bump
}
 ```   
 ```   

## Testing

### Test Coverage
Tests are written using Anchor’s TypeScript test runner.
They cover the full lifecycle of the escrow:
Tests are written using Anchor’s TypeScript test runner.
They cover the full lifecycle of the escrow:

**Happy Path Tests:**
- Test 1: Smoke Testing - Check program ID 
- Test 2: MAKE_OFFER with real mints and token accounts 
- Test 3: TAKE_OFFER - transfer tokens and close offer & vault 

- Test 1: Smoke Testing - Check program ID 
- Test 2: MAKE_OFFER with real mints and token accounts 
- Test 3: TAKE_OFFER - transfer tokens and close offer & vault 


**Unhappy Path Tests:**
- Test 1: MAKE_OFFER should fail if maker has insufficient token A balance
- Test 2: MAKE_OFFER should fail if makerTokenAccountA is not maker's ATA
- Test 3: TAKE_OFFER should fail if taker has insufficient token B balance
- Test 1: MAKE_OFFER should fail if maker has insufficient token A balance
- Test 2: MAKE_OFFER should fail if makerTokenAccountA is not maker's ATA
- Test 3: TAKE_OFFER should fail if taker has insufficient token B balance

### Running Tests
```bash
# Commands to run your tests
cd anchor_project
anchor test
```

### Additional Notes for Evaluators

The entire escrow flow is trustless and fully enforced by PDA-owned accounts.
The frontend implements Anchor-compatible instruction encoding manually, demonstrating low-level Solana development.
The Taker uses a local Keypair, proving that the smart contract does not rely on the frontend wallet beyond Maker actions.
The project demonstrates mastery of:
- SPL token creation
- PDA vault authorities
- Cross-wallet transaction flows
- Closing token accounts safely
- Encoding Anchor instructions by hand for browser compatibility

This project goes beyond tutorial patterns and implements a practical two-asset escrow workflow that could be expanded into a real on-chain commodity marketplace.
The entire escrow flow is trustless and fully enforced by PDA-owned accounts.
The frontend implements Anchor-compatible instruction encoding manually, demonstrating low-level Solana development.
The Taker uses a local Keypair, proving that the smart contract does not rely on the frontend wallet beyond Maker actions.
The project demonstrates mastery of:
- SPL token creation
- PDA vault authorities
- Cross-wallet transaction flows
- Closing token accounts safely
- Encoding Anchor instructions by hand for browser compatibility

This project goes beyond tutorial patterns and implements a practical two-asset escrow workflow that could be expanded into a real on-chain commodity marketplace.
