 Casper EdgeGuard

Casper EdgeGuard is a privacy-first, mobile-native autonomous compliance agent for global Real World Assets (RWAs). Running locally via React Native, the agent dynamically fetches asset parameters, calculates multi-jurisdictional risk matrix constraints, hashes the compliance payload using SHA-256, and autonomously signs the data structure before anchoring the state proofs onto the Casper Testnet via a resilient Web RPC Gateway.

 Hybrid Blockchain Architecture

To optimize performance on mobile edge devices, Casper EdgeGuard utilizes a high-efficiency hybrid on-chain design:

Edge-Native Autonomy: The agent completely provisions its cryptographic account identity, processes regional risk profiles, and executes secure SHA-256 asset payload hashing directly on-device.

Gasless Validation & Integrity: Instead of imposing heavy transaction gas fee overhead or wallet-balance friction on the edge node, the agent signs the data structure locally. 

State Consensus Verification: It utilizes a resilient Web RPC Gateway to read the Casper Testnet state, anchoring the validated cryptographic execution directly against live block heights (e.g., Block #3263056) to ensure tamper-proof enterprise compliance with zero token friction.

On-Device Termux Deployment & Quick Start

Casper EdgeGuard is designed to bring heavy-lifting enterprise compliance logic straight to the client edge. Follow these steps to spin up the local execution container and the Metro bundler loop within an isolated terminal environment:
(NOTE: To install Termux on mobile, we recommend that you install F-Droid first and install Termux by Tarek Sander through the F-Droid app)

1. Environment Setup & Core Dependencies

Open your Termux terminal interface and initialize your system dependencies:

Update native packages and core repositories
```pkg update && pkg upgrade -y```

Install Node.js runtime and Git:
```pkg install nodejs git -y```

Optional but recommended:
```npm install -g npm@latest```

Verify system environment versions:
```node -v && npm -v```

2. Repository Cloning & Installation 
​
Clone the public repository directly into your Termux environment and install the required dependencies:

Clone the open-source repository:
```git clone https://github.com/obednc-glitch/casper-edgeguard.git```

Move into the project's root development workspace:
```cd casper-edgeguard```

Install required node modules and dependency trees:
```npm install```

3. Local Execution & Expo Go Preview
​Launch the native development server macro

Start the Expo development server:
```npm start```
How to preview: Once the server starts, a QR code will generate directly in your terminal. Scan this QR code using the free Expo Go app (available on the App Store) to run the full, localized agent UI on your device instantly. You can also press w to spin it up in your local mobile browser.
