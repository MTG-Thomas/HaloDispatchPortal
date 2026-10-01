# Halo Dispatch Portal

This repository owns a client-only React/TypeScript dispatching interface for HaloPSA: filtered ticket lists, calendar scheduling, ticket creation, and completion. Read [README.md](README.md) for tenant setup and current MVP limitations; `package.json` owns the Vite toolchain.

Keep client behavior compatible with Halo-native teams, agents, lists, ticket fields, and appointments. Inspect the existing state and API adapters before changing filtering or scheduling; preserve existing tenant defaults and distinguish a ticket update from an appointment update. Do not broaden the documented subset of fields without handling tenant-specific availability and validation.

Use `npm run dev` for local development; run `npm run lint` and `npm run build` before handing off source changes. `npm run preview` serves the built bundle. These scripts exist in `package.json`; there is no dedicated test script there. For affected behavior, document focused browser verification and any missing automated coverage rather than claiming lint proves scheduling works.

The documented authentication flow is Authorization Code for a native application. Preserve callback routing and OAuth handling; do not embed confidential client secrets in a browser bundle or commit tokens and customer ticket data. Tenant, auth-server, resource-server, and client-ID configuration belong to the selected Halo instance. README setup instructions do not authorize changing an existing tenant application's permissions or CORS settings.

Use synthetic fixtures for ticket and calendar checks. Creating tickets, completing appointments, writing time, or editing tenant authentication configuration requires the user's applicable authorization and exact tenant scope. Report source checks separately from deployed behavior and live Halo evidence.
