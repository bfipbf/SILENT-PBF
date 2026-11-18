# Controlled PROD mutation — handoff checklist

## What remains automatic
- `sf.yaml`: read-only REST/Tooling queries in BFI_PROD. No approval.
- `jim.yaml`: read-only GET/HEAD with LIVE Named Credential host matching. No approval.
- Public SILENT-PBF issues mirror to PRIVATE-PBF, and evidence is posted privately.

## New protected preflight
`.github/workflows/mutation-preflight.yaml` uses **workflow_dispatch**, not Issue edit events, to avoid accidental replay. It reads a manifest from an independently created PRIVATE-PBF Issue, verifies the allowlisted user and manifest author, matches an immutable request ID, checks existing executed markers and runs only syntactic validation. It does **not** call Salesforce or any external write API. A successful preflight is **not** proof of a completed mutation or approval configuration.

### Required admin setup before use
1. In `bfipbf/SILENT-PBF` → Settings → Environments, create `prod-write-approval`.
2. Configure **required reviewers**, preferably independent of the initiating request author, and prohibit self-review where supported.
3. Restrict deployment branches to the reviewed `main` branch.
4. Verify with a workflow_dispatch test that the job waits for the configured review. If it immediately starts, **approval is not configured**.
5. Keep `PRIVATE_PBF_TOKEN` scoped to `bfipbf/PRIVATE-PBF` Issues read/write and do not place mutation credentials into this workflow.

### Private Issue manifest format
Use a new PRIVATE-PBF Issue, not a public Issue. In its body write:

    ### Mutation Request

    ```json
    {
      "requestId": "PBF-20261118-CHANGE-001",
      "org": "BFI_PROD",
      "kind": "SF_DML",
      "reason": "Authorized example change with an attached private change plan",
      "payloadSha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
    ```

The SHA-256 must represent the actual private immutable payload in a future execution implementation, not the placeholder. Supported manifest kinds: `SF_POST`, `SF_DML`, `JIM_POST`, and `DEPLOY`. The manifest identifies intent only; no mutation executor is connected.

### Run
Go to Actions → **Controlled PROD mutation preflight** → Run workflow. Enter the private Issue number and matching request ID. Approval, if configured, happens at the environment gate.

## Outstanding blocker for actual mutations
- A transactionally reliable replay ledger (claim before call, handle ambiguous HTTP outcomes).
- A specific payload location/hash and safe execution implementation with least-privilege credentials.
- Operation-specific policy, audit log and request-scope authorization.
- Testing in SIT and independent verification of environment protection.
- A controlled PROD rollout and explicit per-operation authorization.

Do not enable unrestricted POST, arbitrary DML, deploy or Jim Bash from public Issue edits.
