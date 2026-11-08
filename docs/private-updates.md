# Updates while Capri is private

> Historical guide for pre-1.0.0 early access. Current downloads and updates use the public [CapriChooms/CapriCore releases](https://github.com/CapriChooms/CapriCore/releases) without an account or token. Run the current installer over the existing installation to switch from the old private channel. The instructions below apply only to the former private repository.

Anyone who has accepted an invitation to **CapriChooms/Capri** and has Read
access can update inside Capri. Membership in the CapriChooms organization is
optional. The repository stays private.

Starting with v0.3.6, open **Settings → Updates → Connect GitHub for private
updates**. GitHub CLI is optional, not a prerequisite.

1. If you were invited directly to the repository, click **GitHub access token
   (classic · repo)**. Sign in to GitHub with the account that accepted the
   repository invitation, keep the `repo` scope selected, and set an expiry.
2. If you joined the organization, use **Create read-only token** to limit access
   to Capri. Select **CapriChooms → Only select repositories → Capri** and set
   **Contents → Read-only**. If GitHub marks this token **Pending**, wait for
   approval from the organization owner.
3. Paste the token into Capri's password field and click **Save and check
   access**. Once saved, use **Check for updates** directly in Capri.

GitHub requires classic tokens for outside collaborators. The classic `repo`
scope covers other repositories the same account can access, so keep the token
private. An expired or revoked token must be replaced. Either token inherits the
account's existing repository permissions.

The token stays in the main process. On Windows its local file under
`data/secrets` contains OS-encrypted ciphertext, not the token. Electron uses
Windows DPAPI, tied to the Windows account; this does not protect against another
application already running with that same user's access. The renderer only gets
connection status and clears the password field after submission or panel close.
Diagnostics omit the credential file and redact known token formats. Never paste
a token into a conversation, issue or bug report.

**Remove saved access** removes Capri's saved credential. It does not sign out of
GitHub in a browser, revoke the token on GitHub or change an existing GitHub CLI
login. Existing environment/CLI credentials remain supported as a fallback when
no credential is stored in Capri. The same saved read access can retrieve a
missing release voice pack; it does not authorize desktop actions.

The first upgrade from an older build without this connection screen may need a
one-time manual run of the new Capri Setup. Keep the current installation folder
to preserve data. Subsequent private update checks can use the saved access.

References: [GitHub token creation and prefilled permissions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens),
[Electron safeStorage and Windows protection](https://www.electronjs.org/docs/latest/api/safe-storage).
