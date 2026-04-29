# Contributing to OrbitTest

Thanks for helping improve OrbitTest.

## Development Setup

```bash
npm install
npm test
```

Run the CLI locally:

```bash
node cli.js run
node cli.js --help
```

Check the npm package contents:

```bash
npm pack --dry-run
```

## Before Opening a Pull Request

- Keep changes focused and easy to review.
- Add or update tests when behavior changes.
- Update `README.md` or `CHANGELOG.md` when user-facing behavior changes.
- Run `npm test`.
- Run `npm pack --dry-run` for packaging changes.

## Code Style

- Use CommonJS to match the current package.
- Keep APIs small and predictable.
- Prefer clear error messages over silent failures.
- Avoid unrelated formatting or refactors in feature PRs.

## Reporting Bugs

Please include:

- OrbitTest version
- Node.js version
- Operating system
- Command you ran
- Expected behavior
- Actual behavior
- A small test case when possible

## Feature Requests

Open an issue with the workflow you want to support and a short example of how the API or CLI should feel.
