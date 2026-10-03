# History Purge Runbook — committed `api_responses` tenant data

Status: NOT EXECUTED. Forward-fix only is in the working tree (the live
`api_responses/1_ClientCache.json` is now a small synthetic fixture). The git
history still contains the original tenant export with real names, emails,
and agent photo data. Purging it rewrites history and requires owner approval
plus coordinated force-pushes. Do not run the commands below casually.

## Why

`api_responses/1_ClientCache.json` (committed in `90f2c9f`, ~2.9 MB) contains
real tenant data: agent/staff names, email addresses, and base64 agent photos.
`api_responses/4_Tickets.json` also contains real customer and end-user names
plus at least one email address. AGENTS.md forbids committing customer ticket
data; removing the files from HEAD alone leaves every byte recoverable via
`git log -- api_responses/`.

## Scope decision (get this approved first)

- Minimum: purge `api_responses/1_ClientCache.json` (bulk PII + photo blobs).
- Recommended: also purge `api_responses/4_Tickets.json` (customer/user
  names), or replace it with a synthetic fixture first and purge the original
  blobs the same way.
- `api_responses/2_ViewLists.json` and `3_ViewFilter.json` are structural
  workflow labels with no emails found; include them in the purge only if the
  owner wants the whole directory scrubbed.

## Prerequisites

- Owner approval for a history rewrite + force-push of every affected branch.
- Announce a merge freeze: all collaborators must push their work, then delete
  and re-clone after the purge (no pulling across the rewrite).
- Back up first: `git clone --mirror <repo-url> repo-backup.git` stored
  somewhere safe, so a botched rewrite is recoverable.
- Install `git filter-repo` (preferred). `git filter-branch` is deprecated;
  BFG is the fallback.

## Purge with git filter-repo (preferred)

From a fresh mirror clone:

```sh
git clone --mirror <repo-url> purge.git
cd purge.git

# Purge the PII fixture blobs from ALL refs (minimum scope).
git filter-repo --invert-paths --path api_responses/1_ClientCache.json

# Recommended wider scope (uncomment to include the tickets export):
# git filter-repo --invert-paths \
#   --path api_responses/1_ClientCache.json \
#   --path api_responses/4_Tickets.json
```

`filter-repo` strips the paths from every commit, drops the now-empty
commits, and removes the corresponding blobs. Note the real tenant hostname
(`gocovi.halopsa.com`) also appears in `api_responses/README.md`; if the
owner wants that scrubbed too, add `--replace-text` with a mapping file such
as:

```sh
printf 'gocovi\\.halopsa\\.com==>example.halopsa.com\n' > replacements.txt
git filter-repo --replace-text replacements.txt
```

## Push and verify

```sh
# Inspect before pushing: history should no longer mention the file.
git log --oneline --all -- api_responses/1_ClientCache.json
git rev-list --objects --all | grep -i clientcache || echo "blobs gone"

# Repack and push every rewritten ref (requires force-push permission).
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push origin --force --all
git push origin --force --tags
```

Then on GitHub (or the host in use):

1. Confirm the file's history page is empty and old blob URLs 404.
2. Ask support to purge cached views if commit pages still render the data.
3. Have every collaborator delete their old clone and re-clone; stale clones
   reintroduce the blobs on the next push.
4. Rotate anything the export may have exposed (it contains no passwords or
   tokens by inspection, but confirm with the tenant owner).

## BFG fallback

```sh
git clone --mirror <repo-url> purge.git
cd purge.git
bfg --delete-files 1_ClientCache.json .
# BFG wider scope: bfg --delete-files '{1_ClientCache,4_Tickets}.json' .
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push origin --force --all && git push origin --force --tags
```

Same verification and re-clone steps apply.

## After the purge

- Re-apply the synthetic `api_responses/1_ClientCache.json` on the new HEAD
  (the purge removes the path from every commit, including HEAD).
- Keep this runbook: it documents why history was rewritten and when.
