# Contributing

## Setup

No build step. Open `editor/index.html` in a browser.

## Validation

```bash
python validate.py examples/*.bt.json
```

Catches structural errors: cycles, orphans, missing children, invalid types. Use in CI or as a pre-commit hook.

## Code style

- Vanilla JavaScript with JSDoc types, checked by `tsc --checkJs`
- No frameworks, no bundler
- Logic and layout stored in separate JSON files

## Pull requests

- One clear change per PR
- Test manually in the editor and run `validate.py` before opening
- Describe what changed and why in the PR body
