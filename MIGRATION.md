# SILENT-PBF → PRIVATE-PBF

Public execution gateway: `bfipbf/SILENT-PBF`.
Private audit store: `bfipbf/PRIVATE-PBF`.

## Issue mirror (staged, requires review)
The `issue-sync.yaml` workflow listens to allowlisted issue opened/edited and issue_comment created/edited events.
It upserts the corresponding private issue and private comments with stable HTML markers.
A public backlink comment links to the private issue; the private issue links back to the public issue.
Private comments and private results are **never copied to public**.

## Configuration
Add repository Actions secret `PRIVATE_PBF_TOKEN` in SILENT-PBF with access **only** to PRIVATE-PBF and permission **Issues: Read & Write**. A fine-grained PAT or GitHub App installation token can be used if appropriately provisioned. No token value belongs in issues, logs, or commits.

Public issue creation/commenting requires `GITHUB_TOKEN` with issues:write (configured in workflow).
The workflow has an actor and original-issue-author allowlist. Maintain it deliberately.

## Safety and rollout
This PR only adds the mirror. It does **not** migrate or activate Salesforce/External Services workflows.
Before moving `sf.yaml`, `jim.yaml` and their .mjs dependencies:
- Replace public evidence comments/artifacts/logs with **private-only** publication.
- Audit scripts for stdout, error messages, action logs and credential leakage.
- Configure Salesforce secrets/vars on SILENT-PBF; test in SIT before PROD.
- Preserve existing allowlists, endpoint restrictions, no-DML defaults and approval gates.
- Confirm the legacy GPT-PBF gateway is no longer used **before** enabling production execution.

GitHub Actions in SILENT-PBF is public even if PRIVATE-PBF is private. Do not put sensitive data in SILENT-PBF issues or public run logs.

## Notes
The mirror only accepts events authored/triggered by users in its allowlist, to avoid abuse of a public issue form. It does not sync PRIVATE-PBF edits back to SILENT-PBF (only cross-links are bidirectional). Comments existing before initial rollout are not backfilled automatically.
