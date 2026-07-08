# Agent guidelines

## Commit and pull request conventions

- Do **not** add Claude/AI attribution to commits or pull requests. Specifically, omit:
  - `Co-Authored-By: Claude ...` trailers
  - `Claude-Session: ...` trailers
  - "🤖 Generated with Claude Code" / "Assisted by Claude" lines in PR bodies
- Write commit messages and PR descriptions as plain, human-authored text with no AI-assistant footer.

## Merge conventions

- Merge pull requests with **squash and merge** (keep `main` history one commit per PR).
- Preserve human co-authorship: when a change originates from someone else's work, keep their
  `Co-authored-by: Name <email>` trailer in the squashed commit so they're credited.
