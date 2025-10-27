# SECURITY_NOTES

## Overview
This document records trust assumptions, authorization rules, and operational controls
for the smart contracts in this repository.

## Trust Assumptions
- **Admin Key**: The address with `DEFAULT_ADMIN_ROLE` can grant/revoke roles. We assume this key
  is hardware-protected and rotated if compromised.
- **Gateway/Endorser**: Addresses with `ENDORSER_ROLE` are trusted to approve sensitive actions
  via EIP-712 signatures. We assume gateway infra enforces business policies (KYC, limits, etc.).
- **Chain Finality**: We rely on L1/L2 finality rules of the target network.

## Authorization Model
- **Roles**
  - `DEFAULT_ADMIN_ROLE`: Role management, break-glass ops.
  - `PAUSER_ROLE`: Pause/unpause.
  - `OPERATOR_ROLE`: Limited operational functions (e.g., sweeps).
  - `ENDORSER_ROLE`: Off-chain endorsement (EIP-712) for sensitive user actions.
- **Pause Behavior**
  - Paused state blocks user flows; admin retains break-glass functions if implemented.
- **Endorsement Policy**
  - Sensitive calls (e.g., `withdraw`) require an EIP-712 signature binding:
    - `caller`, `actionId`, `value`, `nonce`, `deadline`.
  - Nonces are per-caller to prevent replay; deadlines to limit validity.
- **Key Rotation**
  - Admin can add/remove endorsers/operators without redeploy.
- **Limits & Invariants**
  - Balance never underflows; reentrancy is avoided by effect-before-interaction pattern.
  - Endorsement replay prevented by nonces; cross-contract replay prevented by domain separator.

## Operational Procedures
- **Granting Roles**
  - `npx hardhat role:grant --contract <addr> --role ENDORSER_ROLE --to <addr>`
- **Emergency Pause**
  - `pause()` by `PAUSER_ROLE`; announce publicly; investigate root cause; unpause after fix.
- **Compromise Response**
  - Revoke compromised role, rotate keys, reissue endorsements if needed.

## Threats Not In Scope (Examples)
- User endpoint malware / private key theft.
- L1/L2 censorship or catastrophic consensus failure.

## Testing & Auditing
- Unit tests assert authorization failures for non-role users.
- Fuzz tests recommended for signature parsing and nonce handling.
- External audit strongly recommended prior to mainnet launch.
