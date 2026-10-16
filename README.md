# GRCC Raider Assist — Desktop Ticketing Starter

Cross-platform Windows system tray / macOS menu bar application for GRCC support, using Angular 20, Electron 38, Node.js 22 and TeamDynamix Sandbox integration foundations.

**Current state:** functional local form + native device discovery + validated demo submission, with a configurable TeamDynamix integration backend. **Not production-ready.** No real TeamDynamix tickets are created in default demo mode.

## Requirements

- Node.js 22.12+ and npm 10+
- On Windows: PowerShell / CIM accessible for BIOS and model queries
- On macOS: `ioreg` and `system_profiler` accessible

## Quick start

```bash
cd grcc-raider-assist
npm install
cd desktop && npm install && cd ..
cp backend/.env.example backend/.env
npm run dev
```

The application starts Angular at http://127.0.0.1:4200, Electron opens the support form, and the demo backend starts on http://127.0.0.1:8789. Submitting a ticket in demo mode only validates the request and returns a demo confirmation.

## Key directories

```text
grcc-raider-assist/
├── desktop/
│   ├── electron/
│   │   ├── main.cjs            # Tray/menu bar, safe IPC, networking
│   │   ├── preload.cjs         # Limited contextBridge API
│   │   └── device.cjs          # Windows/macOS device discovery
│   ├── src/
│   │   ├── main.ts             # Angular form component
│   │   ├── app.html            # Template
│   │   └── styles.css          # GRCC branded styling
│   ├── angular.json
│   └── package.json
├── backend/
│   ├── server.mjs              # Node trusted backend service
│   ├── identity.mjs            # Trusted gateway assertions boundary
│   ├── tdx.mjs                 # Sandbox ticket + asset workflows
│   └── .env.example
├── docs/SECURITY.md
└── brand/README.md
```

## TeamDynamix Sandbox wiring

`backend/.env.example` documents the required variables. GRCC's sandbox: `https://supportdesk.grcc.edu/SBTDWebAPI`; tickets app `28`; example assets app `40` (verify ID). Configure `TDX_TYPE_ID`, `TDX_STATUS_ID`, `TDX_PRIORITY_ID`, `TDX_FORM_ID`, and optionally `TDX_ACCOUNT_ID` from your actual Sandbox form. API token is retrieved server-side using `POST /api/auth/loginadmin` and cached briefly. Verify endpoint/payload fields in your GRCC Swagger.

The backend's production mode is **deliberately gated** behind `IDENTITY_INTEGRATION=trusted-proxy` and `TRUSTED_PROXY_ENABLED=true`. These are only configuration gates, not a substitute for an enterprise identity gateway; see `docs/SECURITY.md`. Do not turn on production until that independent gateway and TDX form mappings are deployed and security reviewed.

## Build and package

```bash
npm run build
cd desktop
npm run package:mac # on a Mac
npm run package:win # on Windows
```

Builds require an `npm install` beforehand; signing/notarization and official app icons are not provided. Cross-platform packaging is most reliable when performed on each target OS.

## Tests

```bash
npm test
```

## Sources

- GRCC branding: https://www.grcc.edu/faculty-staff/marketing-communications/design-identity-center/logos-brand-standards
- Mascot: https://www.grcc.edu/faculty-staff/marketing-communications/mascot
- Sandbox Swagger: https://supportdesk.grcc.edu/SBTDWebAPI/swagger

## Next development stages

- GRCC-approved official logo and mascot supplied by Marketing & Communications
- Enterprise mTLS/endpoint identity gateway and authenticated person-to-UID mapping
- Validate precise TDX ticket creation / asset search DTOs against GRCC Sandbox
- Test multiple-asset matches, ownership checks and create/link partial failures
- Screenshot selection with review/redaction and multipart upload
- Enterprise device installer, signed binaries, automatic updates, logging and support playbooks
