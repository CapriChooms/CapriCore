# Credits and Hall of Fame

Open **Settings → Credits**, beside **Support the author**. The Hall of Fame honours the core team, major supporters and community helpers, and early access supporters listed by GitHub nickname. The curated `majorSupporters` and `communityHelpers` groups accept display names, including spaces and underscores, independently of GitHub logins. Manual roster refresh preserves both groups.

The packaged `config/hall-of-fame.json` contains public nicknames and the three credited team roles. Capri reads this local file only when Credits is opened. It does not contact GitHub, load remote avatars, or request authentication to display the list. Names are displayed as text and are excluded from interface translation. Search filters the local list without sending the query anywhere.

## Updating the acknowledgements

From the project checkout, run `node tools/community/update-hall-of-fame.mjs` using an already authenticated GitHub CLI account that can list the repository's collaborators. The importer reads all pages of collaborators for `CapriChooms/Capri`, including users whose access comes through the organization and its teams. Pending invitations are not accepted access and are not included.

Only validated GitHub login names are retained. Access levels, email addresses, profile details, credentials, and API response bodies are not packaged. A failed request or invalid response preserves the existing file. The importer merges newly found users into existing acknowledgements, so removing someone's repository access later does not erase their credit. Review and commit the updated JSON with the next release; the application never runs this maintainer tool itself.

The initial snapshot covers current collaborators visible to the authenticated maintainer. It cannot recover people whose access was removed before the first import. Add missing historical acknowledgements manually to `supporters` using their GitHub nicknames.

## Presentation

Each credited nickname also has a unique randomly assigned adjective/noun epithet, such as an English cyberpunk callsign. The curated word bank contains neutral or positive terms. These proper-name descriptions stay in English across interface languages. Assignments are saved in the roster's `epithets` map and kept on future imports, so reopening Credits or restarting Capri does not rename people. The same identity shares its epithet across the team, donor, helper and supporter lists. Search matches both the original supporter nickname and its epithet.

The panel has a compact title and unboxed names with six stable gradient palettes, soft bloom and gently staggered vertical motion. Visible names also have a slow animated colour sweep, capped at 20 colour steps per second. The three team names emit God Rays from their own letter shapes: three small sheets of ten static glyph projections per name, with a coloured highlight passing through the actual letters. The sheets breathe and shimmer between palette tones using only transform and opacity; blur stays static. A generous, softly feathered emission area reaches full transparency before its edges, without per-card paint clipping. The light follows the same drift as its source letters. Decorative copies are excluded from accessibility and selection; only the original nickname is semantic text.

The panel adapts to narrow Settings windows and offers a local nickname search. Ordinary nicknames use text shadows instead of per-name filter surfaces; the bounded ray sheets exist only for the three main credits. One viewport observer prepares nearby names in an 80-pixel margin; far-offscreen names, hidden tabs and hidden Settings windows do not animate. Scrolling pauses drift, colour sweeps, glyph highlights and rays together with one shared idle timeout; motion resumes afterward. All effects share the saved animation time when names leave and re-enter the observed area. No full-roster layout measurements run during scroll. Reduced-motion preferences disable the motion and compositing hints, while forced colours disable the rays and highlights. The three main credits are Overyx (Developer), v1rch (Discord developer), and Leberrr (Discord moderator).

## Verification

`node tools/verify/verify-credits.mjs` opens the real Settings window in an isolated profile. It checks navigation beside Support, every imported nickname, search and no-match results, five interface languages including RTL, a second theme, a narrow window, reduced motion, and closing without a settings draft. It also rejects external network requests during the checks. No owner settings, history, microphone, or models are needed. Unit tests for the roster importer cover pagination, validation, permanent credits, and keeping the previous file intact after failed imports.

`node tools/verify/verify-credits-motion.mjs` checks the floating names, gradient/bloom styling, real vertical movement, non-overlap, bounded visible animation count, scrolling/search, reduced motion and native window hide/restore. Its frame sample describes that isolated fixture on the current computer, rather than a performance guarantee for other hardware.
