# Security architecture / deployment gate

**Prototype, not production-approved.** Managed-device identity is not accomplished by collecting a serial number, hostname, username or MAC address. All of those are untrusted client claims.

## Production prerequisites

1. Use an institution-managed reverse proxy or endpoint identity gateway that **authenticates the connecting managed device** (mTLS machine certificate or equivalent, with revocation and device compliance), and **authenticates the current employee** through a supported GRCC identity integration. Establish server-side mapping to the employee's TeamDynamix UID; device identity alone cannot reliably identify a person on shared computers.
2. Proxy must strip inbound `X-GRCC-Authenticated-TDX-UID` and `X-GRCC-Authenticated-Subject`, authenticate both assertions, then inject fresh values. It must not forward arbitrary client-supplied identity headers.
3. Backend must listen only on loopback or Unix domain socket and accept requests *exclusively* through that enforcing gateway. In production it binds `127.0.0.1` by default. The gateway is not implemented in this starter. A Windows/Mac endpoint must use the gateway's HTTPS URL, not the local demo service. **Do not enable production by setting flags alone.**
4. Deliver credentials securely to backend host. Never embed the BEID, Web Services Key, TDX admin JWT, trusted proxy claims, or managed-device certificate private keys in Electron assets.
5. TDX service account must have least-privilege access; map the authenticated user to `RequestorUid` only after server validation. Consider server-side checks on account, asset ownership and ticket visibility.
6. Implement request throttling, replay protection/idempotency, audit logs (without sensitive diagnostic bodies), strict enterprise TLS, patch policy, code signing, and macOS notarization before rollout.
7. This starter transmits device diagnostics from an Electron process. Those values are **not security assertions**. Only the trusted gateway establishes the requestor's identity.
8. Asset linking uses exact unique serial matching and does not link a computer to a peripheral report unless its serial was explicitly selected. Follow up with a user/ownership check in production.

## Known limitations

- Local demo backend runs on 127.0.0.1, not a managed enterprise gateway. Desktop `RAIDER_API_URL` default is localhost. To connect a deployed desktop client, configure an HTTPS gateway URL and distribute it through protected configuration / deployment tooling.
- Electron creates an initial application without auto launch (opt in with `RAIDER_AUTO_START=1` for pilot testing). Requires enterprise install integration for shared-device profiles.
- Ticket form IDs, asset search filters, and admin login payload should be verified against GRCC's specific Sandbox Swagger and pilot data. The ticket create payload is intentionally conservative.
- Device serial discovery is best-effort, and Windows PowerShell may be restricted by endpoint policy.
- Device memory and CPU information are included only if the employee chooses to include diagnostics, but the host serial is used for automatic asset matching even without including diagnostics in ticket description. Add explicit UI text if policy requires separate consent for asset lookups.
- No file attachments, push notifications, peripheral enumeration, Intune/Jamf attestations, telemetry, offline queue, auto-update, or rate-limiting implementation yet.
- The proxy-to-backend trust boundary is only safe when the gateway is independently hardened and the backend is inaccessible except from it. The current prototype is **not suitable for Internet exposure**.
