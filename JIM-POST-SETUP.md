# Jim POST — protected execution

A new `jim-post.yaml` workflow is **manual** and intentionally separate from the public Issue `jim.yaml` GET/HEAD workflow.

## How it works
1. Create a **PRIVATE-PBF** Issue with exact heading `### Jim POST` and one JSON code fence containing `requestId`, `url`, `body`, and `reason`.
2. Run the workflow from **SILENT-PBF → Actions → Jim POST - protected private request**, supplying the PRIVATE-PBF Issue number and matching request ID.
3. The `prod-write-approval` environment must have non-empty required reviewers and prevent self-review. The script validates configuration and fails closed if it cannot verify it.
4. After protected approval, the script checks the actor, private Issue author, exact manifest, prior replay marker, OAuth, and LIVE External Service/Named Credential origin. It writes a **STARTED** marker to the PRIVATE Issue before the POST, preventing retry after uncertain outcomes.
5. POST uses only the supplied HTTPS URL on a LIVE-registered Named Credential origin; no arbitrary public Issue payload is executed. Response evidence is written only to the PRIVATE Issue. Access tokens and API keys are never printed.

Example PRIVATE Issue body (illustrative only; don't run):
```markdown
### Jim POST

```json
{
  "requestId": "PBF-20261118-DUPCHECK-001",
  "url": "https://gateway.prod.bravo.bfi.co.id/sf/pbf/ro/dupcheck",
  "body": {"content": []},
  "reason": "Authorized targeted duplicate check against production endpoint"
}
```
```

**Security and scope**
- This can make a business-affecting POST. Never run without confirming the endpoint contract, request payload, and actual approval reviewers.
- A successful Actions run is not proof of business success; inspect HTTP and response in PRIVATE-PBF.
- A started claim is single-use, including failure/timeout. Do not automatically retry unknown outcomes.
- This is not Salesforce generic DML, deploy or arbitrary Jim Bash.
- A public repo's workflow code changes must require code review and branch protections; otherwise contributors with write access could weaken execution gates.
- GitHub connector cannot currently verify/update the environment reviewers. A smoke test without an actual POST is required prior to enabling execution.
