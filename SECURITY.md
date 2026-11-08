# Security and dependency risks

## Accepted dependency findings

On 2026-11-08, the project owner requested acceptance of the dependency audit
findings below. This is acceptance of the documented residual risk for this
assignment, not a claim that the vulnerabilities are fixed. The full `npm audit`
jobs remain enabled and will fail while npm reports vulnerabilities. Audit
results can change as advisories and dependencies change; review new findings
individually rather than treating this record as a blanket exception.

| Component | Observed result | Assessment and treatment |
| --- | --- | --- |
| `garage/` | 11 moderate findings in development dependencies | The audit traces findings to Drizzle Kit's esbuild loader ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)) and typescript-eslint's minimatch ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). They are tooling, not production dependencies. Avoid exposing development servers to untrusted networks or processing untrusted glob patterns. Reassess compatible upstream fixes before upgrading; npm's suggested forced changes can break tooling. |
| Supplied `simulator/` | 2 high findings: `axios` and `follow-redirects` | The pinned Axios version has [multiple advisories](https://github.com/advisories/GHSA-jr5f-v2jv-69x6), including SSRF and credential-leak risks. The transitive redirect dependency has a [sensitive-header redirect advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). Preserve the supplied simulator for now and use it only in a trusted local test environment with test-only secrets and data, a trusted local destination, and no untrusted proxy or redirect target. Do not use it with production credentials or services. These precautions reduce exposure; they do not eliminate the vulnerabilities. |

The simulator accepts a destination URL and sends a signed payment body using
Axios. Do not assume a trusted initial URL makes redirects or proxy settings safe;
ensure the local test service does not redirect and the environment does not
route traffic through an untrusted proxy. The simulator's unsigned legacy mode
does not authenticate a payment and must not be treated as a security exception
for the backend.

Re-run `npm audit` in each directory when dependencies or advisories change, and
revisit this acceptance before any non-local use, release, or upgrade. The
2026-11-08 audits were full audits; the last separately recorded backend
production-only audit reported no findings. The audit jobs' failing status is
intentional until the underlying findings are resolved or a separately agreed
CI policy is implemented.
