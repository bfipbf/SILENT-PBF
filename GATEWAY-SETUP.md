# SILENT-PBF Gateway Migration — Configuration Checklist

## Target architecture

- **Public execution:** `bfipbf/SILENT-PBF`
- **Private storage:** `bfipbf/PRIVATE-PBF`
- **Source metadata:** `bfi-finance/bfi-pbf-live`, branch `Branch_Gabungan`
- **Legacy gateway:** `bfipbf/GPT-PBF` (unchanged until safe cutover)

## Settings required in SILENT-PBF

| Type | Exact key | Purpose | Status |
| --- | --- | --- | --- |
| Actions Secret | `PRIVATE_PBF_TOKEN` | Fine-grained token with PRIVATE-PBF Issues read/write | **Verified at runtime** via sync Issue #2 → PRIVATE #1 |
| Actions Secret | `SF_BFI_PROD_CLIENT_ID` | Salesforce PROD Connected App client ID | Not configured/verified by migration |
| Actions Secret | `SF_BFI_PROD_CLIENT_SECRET` | Salesforce PROD Connected App client secret | Not configured/verified by migration |
| Actions Secret | `SF_BFI_PROD_APIKEY` | External Services PROD API key; only if Jim Request is approved | Not configured/verified by migration |
| Actions Variable | `SF_BFI_PROD_LOGIN_URL` | Exactly `https://ptbfifinance.my.salesforce.com` | Not configured/verified by migration |
| Actions Variable | `SF_GATEWAY_ENABLED` | Explicit activation guard in a future reviewed gateway | Do **not** set true before safety review and authorization |

Legacy secret fallback names: `SF_CLIENT_ID` and `SF_CLIENT_SECRET`. Prefer the BFI_PROD-scoped names above.

**No secrets in Issue bodies, code, Actions run output, or public artifacts.**
The exact secret values cannot be read back from GitHub. Token scope must be least-privilege. Disable secret exposure to untrusted code and third-party PRs.

## Security acceptance criteria for any migrated sf.yaml / jim.yaml

1. Read-only Salesforce REST/Tooling endpoints only by default; block POST/patch/delete/deploy unless independently authorized and approved.
2. Preserve author and actor allowlists and exact request heading matching.
3. No sensitive Salesforce/External Service response in SILENT-PBF issue comments, public job logs, or Actions artifacts.
4. Publish complete evidence to the linked PRIVATE-PBF issue using `PRIVATE_PBF_TOKEN`, idempotently by run ID.
5. Review Apex REST and Jim POST paths as write-capable. Disable unsafe methods until explicitly approved.
6. Review Jim Bash as arbitrary code execution. Do not enable the old unrestricted script in the public gateway.
7. Use a separate SIT credential and an explicit SIT host/org guard for SIT testing. Existing PROD scripts pin the PROD origin, so merely changing a variable will not retarget safely.
8. Validate production OAuth scopes, external service host allowlist, installed permissions, and effective running user before activation.
9. Disable legacy gateway only after successful sandbox exercise and controlled cutover; never run both request gateways against PROD.

## Evidence publisher

`.github/mjs/private-evidence.mjs` is a private-only utility for a **future reviewed** gateway.
Requires `ISSUE_NUMBER`, `PRIVATE_PBF_TOKEN`, `EVIDENCE_FILE`, and `GITHUB_RUN_ID`.
It locates the linked PRIVATE-PBF issue by stable marker; it refuses ambiguous duplicates.
It upserts one PRIVATE-PBF comment per run ID and suppresses content from public logs.
**Not yet connected to an executable Salesforce workflow, and not runtime-tested.**

## Verified tests

- [x] SILENT #2 → PRIVATE #1: create mirror and reverse backlink
- [x] Comment create and update reused original mirror comment ID
- [x] Subsequent Issue title/body edit changed PRIVATE #1 without creating a second Issue (run 44234576575)
- [ ] Replaying an identical event does not create another Issue/comment
- [ ] Private evidence publisher smoke test
- [ ] SIT read-only Salesforce gateway
- [ ] Safe PROD cutover

Do not treat this document or a GitHub Actions green status as LIVE Salesforce verification.
