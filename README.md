# Coffee Exchange — A Solana-based P2P Coffee Commodities Escrow

Coffee Exchange is a decentralized peer-to-peer swap market for coffee commodity tokens built entirely on **Solana**, featuring on-chain escrow vaults using PDAs, Maker/Taker settlement flows, SPL token minting directly from the UI, and a fully trustless exchange mechanism. This project includes a complete frontend, Solana program, and Anchor test suite.

---

## Live Frontend

**Deployed Frontend:**  
https://coffee-exchange-six.vercel.app/

---

## Program ID

9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc

---

## Overview

### What the dApp Does

Coffee Exchange allows users to mint two SPL tokens representing coffee types:

- ☕ **Arabica (Token A)**
- 🌋 **Robusta (Token B)**

Users can:

- Create on-chain offers that lock Arabica inside a PDA-controlled vault.
- Have a simulated Taker accept the offer by sending Robusta and receiving Arabica.
- Execute swaps fully trustlessly through an Anchor smart contract.
- Mint SPL tokens directly in the browser using the connected wallet as mint authority.
- Interact with deterministic ATA and PDA accounts for secure settlement.

This dApp demonstrates a real commodity trading mechanism powered entirely by Solana’s high-performance runtime.

---

##  Architecture

The architecture follows a trustless Maker ↔ PDA ↔ Taker flow:

Maker Wallet <----> Program PDA Vault <----> Taker Wallet

### SPL Token Mints

Created directly from the frontend during the first **Harvest**, using:

- 0 decimal SPL mints
- Maker wallet as mint + freeze authority

### PDA-based Vault

Each offer creates a deterministic PDA:

seeds = ["offer", maker_pubkey, id_le_bytes]

This PDA:

- Stores offer metadata  
- Owns the vault ATA  
- Signs withdrawals during settlement  
- Ensures no one can tamper with locked tokens  

### Instructions

#### **1. make_offer**

- Creates an on-chain offer account  
- Derives vault PDA  
- Creates vault ATA owned by PDA  
- Transfers Arabica from Maker → vault  
- Stores offer metadata (maker, wanted amount, mints, bump)

#### **2. take_offer**

- Taker sends Robusta → Maker  
- PDA releases Arabica → Taker  
- PDA closes vault ATA and sends rent back to Maker  
- Offer account is closed automatically  

---

## Folder Structure

/anchor_project</br>
  /programs/coffee_exchange</br>
  /tests</br>
Anchor.toml</br></br>

/frontend</br>
  /src/App.tsx</br>
  /src/components</br>

---

## 🛠️ Setup & Installation

### 1. Clone the repo

```bash
git clone https://github.com/School-of-Solana/program-joeyjoplin.git
```
 
### 2. Build and test Smart Contract (Anchor)
```bash
1. Build the Solana program

cd anchor_project
anchor build

2. Run Anchor tests on localnet
Ensure Anchor.toml provider is:

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

3. Run test
anchor test
```

### 3. Run Frontend
```bash
1. Install dependencies

cd frontend
npm install

2. Create .env

VITE_RPC_ENDPOINT=https://api.devnet.solana.com
VITE_COFFEE_EXCHANGE_PROGRAM_ID=9VdKGKXs5ZJd6Cr9GtJcPP8fdUSmRgvkYScvhi1oPkFc

3. Run frontend

npm run dev

4. Open in browser

http://localhost:5173
```

## Using the dApp
1. Connect Wallet
  - Click the wallet button to connect Phantom (Maker).

2. Harvest Coffee Beans
  - Creates Arabica + Robusta SPL mints (first time)
  - Mints 100 tokens of each type to Maker

3. Create an Offer (Maker)
Input:
  - Amount of Arabica to offer
  - Amount of Robusta requested

The program:
  - Derives PDA
  - Creates vault
  - Locks Arabica inside the vault

4. Take Offer (Taker)
- Simulated Keypair mints/holds Robusta
- Sends Robusta → Maker
- Receives Arabica from PDA vault
- Vault and offer are closed

## Security Model
- PDA exclusively controls escrow vault
- TransferChecked prevents tampered mint/decimal changes
- Deterministic PDAs and ATAs prevent spoofing
- Maker cannot take own offer
- No trust needed between participants
- Vault always closes → no stranded funds

## Roadmap
- Add cancel offer instruction
- Add real Taker wallet support
- Add offer listing page
- Multi-offer orderbook

### Author
Daniele Rodrigues dos Santos
Solana Developer & Web3 Builder
