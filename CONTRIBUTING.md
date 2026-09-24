# Contributing

## Language policy
**Everything in this repository is written in English**: code, identifiers, comments, log and
error messages, test names, docs, `.env.example`, git hook messages, commit messages and pull
requests. The hackathon is international and the repository is public.

- Exception: Portuguese chat samples used as test data, kept under a `fixtures/` directory.
- The bot **always replies in English** (decision D-08), even when group members write in Portuguese; source strings and prompts are English too.
- Team chat and the internal Plane board may use Portuguese.
- The `pre-commit` and `commit-msg` hooks reject accented Portuguese text outside `fixtures/`.

## Gitflow
We use **gitflow** (git-flow AVH). Never commit directly to `main` or `develop`.

| Branch | From | Into | Purpose |
|---|---|---|---|
| `main` | — | — | Always stable; every published version is tagged `vX.Y.Z` |
| `develop` | `main` | — | Integration of finished work |
| `feature/<ID>-<slug>` | `develop` | `develop` | One Plane task |
| `release/<X.Y.Z>` | `develop` | `main` + `develop` | Prepare a version (e.g. the submission) |
| `hotfix/<slug>` | `main` | `main` + `develop` | Urgent fix in production |

`<ID>` is the task number on the Plane board, e.g. `feature/HACKATONSU-16-state-resolver`.

### Daily flow
```bash
git checkout develop && git pull
git flow feature start HACKATONSU-16-state-resolver
# ... commits ...
git flow feature finish HACKATONSU-16-state-resolver    # merges into develop
```
With a remote, prefer opening a Pull Request from `feature/*` into `develop`
(`git flow feature publish`) and finishing afterwards.

### Release
```bash
git flow release start 1.0.0
# final touches (version in package.json, README, CHANGELOG)
git flow release finish 1.0.0     # tags v1.0.0, merges into main and develop
```
For the hackathon submission: `release/1.0.0` by Oct 8, tag `v1.0.0`.

## Commits
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`.
Types: `feat fix docs chore refactor test perf ci build style`.
Example: `feat(core): add State Resolver`. Reference the task in the body: `Refs HACKATONSU-16`.

## Hooks (enable once per clone)
```bash
npm run setup:hooks
```
- `commit-msg`: validates Conventional Commits and English.
- `pre-commit`: blocks `.env`, key patterns (Sui, Gemini, Telegram, Plane) and non-English text.

## Secrets
Never commit `.env`, keys, seeds or tokens. Document variables in `.env.example`.
If a secret leaks, treat it as compromised and rotate it.

## Before finishing a feature
- `npm run typecheck` and `npm test` pass.
- The acceptance criteria of the Plane task are met.
- No secrets or personal data in the diff.
- Post a completion report as a comment on the Plane task.
