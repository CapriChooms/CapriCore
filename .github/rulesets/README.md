# Main branch protection

These files describe main-branch protection for the public `CapriChooms/CapriCore` repository. Committing them alone does not activate GitHub rulesets. Import each JSON through **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, or use a reviewed GitHub API administrative tool.

- `main-safety.json`: active on `main`; blocks deletion and force pushes, with no bypass actors.
- `main-pr.json`: active on `main`; requires a pull request and resolution of review threads, with no bypass actors. Required approvals remain zero while the maintainer is the only account with write access. The separate `CODEOWNERS` file routes reviews to the maintainer; code-owner approval is not mandatory.

Public repositories can use these protections on GitHub Free. The former private `CapriChooms/Capri` repository is independent; these rules do not change its visibility or settings.

Required status checks are deliberately absent from these initial rules. Fix CI, obtain a successful run, and add the exact job names in a separate reviewed change. Add required human approvals when another trusted reviewer is available. An author cannot approve their own pull request.

The local `.githooks/pre-push` guard rejects pushes, force pushes and deletions targeting `refs/heads/main` from an opted-in checkout, for every remote. Feature branches remain pushable. Activate it with `git config --local core.hooksPath .githooks` only after checking that this will not replace existing hooks. It is a local safeguard, can be bypassed with Git options, and does not protect GitHub web/API operations or other clones.

References: [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [API schema](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset), [license users](https://docs.github.com/en/billing/reference/github-license-users).
