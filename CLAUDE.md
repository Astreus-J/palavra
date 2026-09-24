# Instructions for AI assistants working in this repo

- **Write everything in English**: code, identifiers, comments, log/error messages, tests, docs,
  commit messages and PR text. The hackathon is international. Only Portuguese test data under
  `fixtures/` is allowed. The user may chat in Portuguese; the repository stays English.
- Follow gitflow (see CONTRIBUTING.md): work on `feature/HACKATONSU-<n>-<slug>`, never commit
  to `main` or `develop`. Use Conventional Commits.
- Never commit `.env` or any secret. Do not print secret values in output.
- Fact types are `DECISION`, `COMMITMENT`, `AMENDMENT`, `COMPLETION`. The current state is
  computed by the State Resolver in code, never by an LLM. Walrus is the source of truth;
  SQLite is a rebuildable cache.
- Task tracking is on the team's Plane board (project HackatonSui). When a task is finished,
  check each acceptance criterion with real evidence and post a completion report as a comment.
