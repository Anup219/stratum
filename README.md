# Stratum — 3D Print Studio & Slicing Engine

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![Firebase](https://img.shields.io/badge/firebase-auth%20%7C%20rtdb%20%7C%20storage-orange.svg)
![Printer](https://img.shields.io/badge/calibrated%20for-Bambu%20Lab%20P1S-black.svg)

Stratum is a high-performance web platform and automated slicing backend built for on-demand 3D printing quotation and order management, specifically tuned for the **Bambu Lab P1S**.

---

## Features

- **Interactive 3D Model Viewer**: Real-time WebGL STL preview with automatic bounding box computation, mesh validation, and orientation detection.
- **Dual-Mode Slicing Engine**:
  - **OrcaSlicer CLI (Headless)**: Server-side slicing via OrcaSlicer headless execution using calibrated Bambu Lab P1S profiles.
  - **Analytical Fallback Engine**: High-fidelity mathematical estimation of print time and filament usage when headless OrcaSlicer is unavailable.
- **Dynamic Cost & Pricing Engine**:
  - Filament cost breakdown (Model + Support weight).
  - Machine runtime and electricity wear calculation.
  - Batch discounts and minimum order threshold protections.
- **Admin Management Dashboard**:
  - Real-time order tracking and status workflow (`Pending` -> `Review` -> `Slicing` -> `Printing` -> `Shipped` -> `Delivered`).
  - Live configuration editor for pricing constants, material rates (PLA, PETG, ABS, Resin), and slicer presets.
- **Cloud Infrastructure**:
  - Firebase Authentication (customer & admin roles).
  - Firebase Realtime Database for instant state updates.
  - Firebase Cloud Storage for model files.

---

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3, Three.js (STL rendering).
- **Backend**: Node.js, Express, Multer.
- **Slicing**: OrcaSlicer CLI / Custom P1S Calibrated Engine.
- **Database & Auth**: Firebase Authentication, Realtime Database, Cloud Storage.
- **Containerization**: Docker (Ubuntu 22.04 + Xvfb for headless OpenGL context).

---

## Project Structure

```text
stratum/
├── assets/                     # Branding logos and graphics
├── server/                     # Backend API & Slicing Engine
│   ├── profiles/               # OrcaSlicer JSON profiles for Bambu P1S
│   │   ├── machine/            # Bambu_P1S_0.4_nozzle.json
│   │   ├── process/            # 0.12mm_Fine, 0.20mm_Standard, 0.30mm_Draft
│   │   └── filament/           # Bambu_PLA, Bambu_PETG, Bambu_ABS
│   ├── slicer/                 # Slicer runners, validators, parsers, and cache
│   │   ├── orcaslicer.js       # CLI execution & fallback simulation
│   │   ├── mesh-validator.js   # Bounding volume & non-manifold checks
│   │   ├── pricing.js          # Quotation calculator
│   │   ├── parser.js           # G-code / OrcaSlicer output parser
│   │   └── cache.js            # In-memory LRU model slice cache
│   ├── test/                   # Backend tests
│   ├── Dockerfile              # Headless OrcaSlicer container definition
│   ├── package.json            # Server dependencies
│   └── server.js               # Express API entrypoint
├── stratum.html                # Main Customer Quotation & Ordering Studio
├── stratum.js                  # Customer app logic & Three.js 3D viewer
├── stratum.css                 # Studio styles and theme tokens
├── admin.html                  # Admin Order Dashboard & Pricing Configurator
├── admin.js                    # Admin dashboard logic
├── admin.css                   # Admin dashboard styles
├── login.html                  # Authentication portal
├── login.js                    # Auth state handler
├── login.css                   # Auth styles
├── firebase-config.js          # Firebase web app credentials & helpers
├── database.rules.json         # Realtime Database security rules
├── storage.rules               # Cloud Storage security rules
├── firebase.json               # Firebase hosting & service configurations
└── package.json                # Project scripts and dependencies
```

---

## Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18 or v20 LTS recommended)
- [Git](https://git-scm.com/)
- (Optional) [OrcaSlicer](https://github.com/SoftFever/OrcaSlicer) or [Docker](https://www.docker.com/) for native headless slicing.

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Anup219/stratum.git
cd stratum
npm install
```

### 3. Firebase Configuration

Edit `firebase-config.js` with your Firebase project credentials from the [Firebase Console](https://console.firebase.google.com/):

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Deploy Firebase security rules:
```bash
firebase deploy --only database,storage
```

> **Security Note**: Ensure your database and storage rules restrict sensitive paths (like `admin_emails`, `orders`, and `config`) to authorized users before production deployment.

### 4. Running the Development Server

Start the Node.js API and static file server:

```bash
npm run dev
```

Visit the application in your browser:
- **Customer Studio**: [http://localhost:3001/](http://localhost:3001/)
- **Admin Dashboard**: [http://localhost:3001/admin](http://localhost:3001/admin)
- **Login**: [http://localhost:3001/login](http://localhost:3001/login)

### 5. Running with Docker (OrcaSlicer Headless)

To run the backend with full native OrcaSlicer CLI slicing support:

```bash
cd server
docker build -t stratum-slicer .
docker run -p 3001:3001 stratum-slicer
```

---

## API Reference

### Health Check
`GET /api/health`
- Returns engine status, printer calibration target, and cache metrics.

### Mesh Sanity Check
`POST /api/validate-mesh`
- **Body**: `multipart/form-data` with `file` (STL).
- Validates model dimensions against Bambu Lab P1S build volume ($256 \times 256 \times 256\text{ mm}$).

### Slice Model
`POST /api/slice`
- **Body**: `multipart/form-data` or JSON with `fileHash`, `materialId`, `qualityId`, `infill`.
- Returns print time, filament weight, layer count, and support breakdown.

### Calculate Quote
`POST /api/quote`
- **Body**: JSON with `modelWeightG`, `supportWeightG`, `printTimeSeconds`, `materialRatePerG`, `qty`, `pricingConfig`.
- Returns itemized pricing breakdown.

---

## Contributing

1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
