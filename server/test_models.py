"""Round-trip test: build tree → save → load → save → assert identical."""

import json
import tempfile
from pathlib import Path
from models import Tree, Layout


def test_round_trip():
    # Load the hand-authored example
    example = Path(__file__).parent.parent / "examples" / "guard_patrol.bt.json"
    tree = Tree.load(example)

    assert tree.title == "Guard Patrol"
    assert tree.root == "root_sel"
    assert len(tree.nodes) == 8
    assert tree.nodes["root_sel"].type == "selector"
    assert tree.nodes["root_sel"].children == ["attack_seq", "chase_seq", "patrol_act"]

    # Save → load → compare
    with tempfile.NamedTemporaryFile(suffix=".bt.json", mode="w", delete=False) as f:
        tmp = Path(f.name)
    tree.save(tmp)
    tree2 = Tree.load(tmp)
    assert tree.to_dict() == tree2.to_dict(), "Round-trip produced different data"
    tmp.unlink()


def test_build_from_code():
    tree = Tree(root="")
    root = tree.add_node("sequence", "Root")
    tree.root = root.id
    action = tree.add_node("action", "DoStuff", key="value")
    tree.connect(root.id, action.id)

    assert len(tree.nodes) == 2
    assert action.id in tree.nodes[root.id].children
    assert action.parameters == {"key": "value"}

    # Round-trip
    d = tree.to_dict()
    tree2 = Tree.from_dict(d)
    assert tree.to_dict() == tree2.to_dict()


def test_layout_round_trip():
    layout = Layout()
    layout.set_pos("node1", 100.0, 200.0)
    layout.set_pos("node2", 300.0, 400.0)

    with tempfile.NamedTemporaryFile(suffix=".bt.layout.json", mode="w", delete=False) as f:
        tmp = Path(f.name)
    layout.save(tmp)
    layout2 = Layout.load(tmp)
    assert layout.to_dict() == layout2.to_dict()
    tmp.unlink()


if __name__ == "__main__":
    test_round_trip()
    test_build_from_code()
    test_layout_round_trip()
    print("All tests passed.")
