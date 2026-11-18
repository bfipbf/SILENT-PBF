# Jim POST from GitHub Issue (single jim.yaml)

The single `.github/workflows/jim.yaml` receives Issue events. **GET/HEAD** still runs automatically under `### Jim Request`. **POST** starts from a new or edited public SILENT-PBF Issue under `### Jim POST Request`, with a protected environment approval before any write can be attempted. Do not use Actions → Run workflow.

## Prepare a private manifest first

Create a **PRIVATE-PBF** Issue with a single `### Jim POST` heading and a JSON code block holding `requestId`, `url`, `body`, and `reason`. The payload and any customer details must exist **only** in PRIVATE-PBF. The manifest author must be allowlisted.

## Public SILENT-PBF Issue body

Use this example with your real PRIVATE-PBF issue number and matching unique request ID (not as a production execution test):

~~~markdown
### Jim POST Request

```json
{
  "privateIssue": 21,
  "requestId": "PBF-20261118-TEST-0001"
}
```
~~~

The public body MUST NOT include the actual POST payload, credentials, or sensitive records. Only allowlisted issue actor and author can submit. Editing the Issue can retrigger a new run, but the private execution marker blocks ordinary replay after a claim; unknown outcomes must be investigated before any new request ID is issued.

## Approval

The `approved-post` job requires the `prod-write-approval` GitHub Environment with independent required reviewers and self-review disabled. The script checks those rules and fails closed if unverifiable. Approval happens in GitHub's protected environment interface, not via the public Issue body. A public Issue alone is **not** sufficient authorization to change production data.

After approval the job verifies the private manifest, request ID, LIVE Named Credential origin and duplicate marker, writes a STARTED claim privately, then sends one POST. Business response and evidence are posted privately.

**Not yet verified:** protected reviewers on the target repo, positive POST runtime, HTTP response or business outcome. Do not perform a mutating smoke test merely to verify routing.
