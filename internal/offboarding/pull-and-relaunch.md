# Offboarding — pull from the directory, relaunch fresh

**Date:** 2026-10-12 · **Status:** In progress — the backup bundle, the license commit on
`v2final`, and the fresh-history `relaunch` branch are done locally. Remaining steps are
external and manual: file the removal issue, delete + recreate the GitHub repo, push
`relaunch:master`, then work the §2 checklist.
**Decisions recorded:** license → BUSL-1.1 with a production-use Additional Use Grant
(free to use, modify, and redistribute; competing products/services need a commercial
license; each version converts to Apache-2.0 four years after release); MIT erased
from the repo going forward; the GitHub repo gets deleted and re-uploaded with a
clean single-commit history; the plugin is pulled from the Obsidian community
directory. Free tier stays until the pull lands.

Nothing in this file has been run against GitHub — every step here is manual.

## 1. Back up before anything destructive

Done — `curtis-ai-chat-full.bundle` sits next to the repo (one level up, outside the
worktree so it can't be committed). Original command, kept for reruns:

```sh
git bundle create ../curtis-ai-chat-full.bundle --all
```

Reminder, stated plainly: copies of v2.0.1 and earlier already went out under MIT,
and an MIT grant cannot be revoked. Deleting the repo erases *your* public copy of
that history — it does not claw back rights already granted. That was accepted as
the cost of the clean relaunch.

## 2. Pull from the Obsidian community directory

Removal is author-initiated: open an issue on `obsidianmd/obsidian-releases`.
Draft (edit before filing):

> **Title:** Remove `curtis-ai-chat` from the community plugin directory (author request)
>
> Plugin ID: `curtis-ai-chat` · Repo: `JordanNewell/curtis-ai-chat`
>
> Author request. Curtis is moving to a source-available distribution model and
> will no longer ship through the community directory. Please remove the listing.
> Existing installs keep working; new users can install via manual download or BRAT.

After the listing is confirmed gone:

- [ ] Remove the `community.obsidian.md` entries from `docs/index.html` (`sameAs`) and `docs/llms.txt` (two links).
- [ ] Flip the install docs (README quick start, `docs/RUNBOOK.md` §1.2) from "community plugins" to manual/BRAT — only after the listing is actually gone, so the current path keeps working until then.

## 3. Delete the GitHub repo and re-upload fresh

On github.com: Settings → Danger Zone → Delete this repository (type the name to
confirm). Stars, forks, issues, and all releases go with it — irreversible after
the 90-day restore window.

Recreate `JordanNewell/curtis-ai-chat` as an **empty** public repo (no README,
no license init), then from this clone push the prepared branch:

```sh
# relaunch already exists locally: one root commit (BUSL-1.1), no MIT-era history
git push origin relaunch:master
```

> **Known quirk:** the gitleaks pre-commit hook hangs on orphan-root commits — it
> diffs the index against HEAD, and a fresh orphan has none. The `relaunch` commit
> was made with `--no-verify` after a clean manual `gitleaks detect --source .`
> pass over the finished commit. Recreate the branch the same way if ever needed.

Then on github.com: set `master` as the default branch, re-set the About sidebar
(license label, description, topics — all reset with the deletion), and re-enable
Actions/Dependabot if wanted.

## 4. When Curtis Pro ships

The license is already BUSL-1.1 — selling needs no further LICENSE swap. What changes:

- [ ] Decide the gate: Polar license keys per `internal/design/entitlements.md` §2; the gate architecture in §3 stands.
- [ ] State on the purchase page and gate UI that it's a trust-based license: BUSL blocks competing offerings but does not by itself bar an end user stripping the gate.
- [ ] Remember the conversion: versions published under BUSL become Apache-2.0 four years after each release. If a future version should never convert, publish that version under a different (proprietary) license — the Change Date is per-version by design.
- [ ] `npm run version` (bumps manifest + versions.json together) → `npm run site:sync` → tag.
