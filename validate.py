#!/usr/bin/env python3
"""Validate .bt.json files against the schema and structural rules. Use in CI or pre-commit hooks.

Usage: python validate.py *.bt.json
       python validate.py examples/
"""
import json
import sys
from pathlib import Path

VALID_TYPES = {"sequence", "selector", "parallel", "action", "condition", "invert", "repeat", "cooldown", "timeout", "guard"}
CATEGORIES = {"composite": {"sequence", "selector", "parallel"}, "decorator": {"invert", "repeat", "cooldown", "timeout", "guard"}, "leaf": {"action", "condition"}}
TYPE_TO_CAT = {t: cat for cat, types in CATEGORIES.items() for t in types}

def validate(path):
    errors = []
    try:
        data = json.loads(Path(path).read_text())
    except (json.JSONDecodeError, OSError) as e:
        return [f"Cannot read: {e}"]

    tree = data.get("tree", data) if "tree" in data else data
    nodes = tree.get("nodes", {})
    root = tree.get("root", "")

    if not root:
        errors.append("Missing root")
    elif root not in nodes:
        errors.append(f"Root '{root}' not in nodes")

    seen_children = set()
    for nid, n in nodes.items():
        ntype = n.get("type", "")
        if ntype not in VALID_TYPES:
            errors.append(f"Node '{nid}': unknown type '{ntype}'")
        cat = n.get("category", "")
        if cat and TYPE_TO_CAT.get(ntype) and cat != TYPE_TO_CAT[ntype]:
            errors.append(f"Node '{nid}': type '{ntype}' should be category '{TYPE_TO_CAT[ntype]}', got '{cat}'")
        children = n.get("children", [])
        if cat == "leaf" and children:
            errors.append(f"Leaf '{n.get('name', nid)}' has children")
        if cat == "decorator" and len(children) != 1:
            errors.append(f"Decorator '{n.get('name', nid)}' should have exactly 1 child, has {len(children)}")
        for cid in children:
            if cid not in nodes:
                errors.append(f"Node '{nid}' references missing child '{cid}'")
            if cid in seen_children:
                errors.append(f"Node '{cid}' has multiple parents")
            seen_children.add(cid)

    orphans = set(nodes) - seen_children - {root}
    if orphans:
        errors.append(f"{len(orphans)} orphan(s): {', '.join(list(orphans)[:5])}")

    return errors


def main():
    paths = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.is_dir():
            paths.extend(sorted(p.glob("**/*.bt.json")))
        elif p.suffix == ".json":
            paths.append(p)

    if not paths:
        print("Usage: python validate.py <file.bt.json | directory>")
        sys.exit(1)

    failed = 0
    for path in paths:
        if ".layout." in path.name:
            continue
        errs = validate(path)
        if errs:
            print(f"FAIL {path}")
            for e in errs:
                print(f"  - {e}")
            failed += 1
        else:
            print(f"  OK {path}")

    print(f"\n{len(paths)} files, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
