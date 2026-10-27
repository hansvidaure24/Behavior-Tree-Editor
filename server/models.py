"""Behavior tree data model. Trees are data, not code."""

from __future__ import annotations
import json
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@dataclass
class Node:
    id: str
    type: str  # sequence | selector | action | condition | invert
    category: str  # composite | decorator | leaf
    name: str = ""
    children: list[str] = field(default_factory=list)
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass
class Tree:
    root: str
    nodes: dict[str, Node] = field(default_factory=dict)
    title: str = ""
    description: str = ""
    version: str = "1.0"

    # --- builders ---

    def add_node(self, type: str, name: str = "", **params) -> Node:
        category = _CATEGORIES[type]
        node = Node(
            id=_uid(), type=type, category=category,
            name=name or type, parameters=params,
        )
        self.nodes[node.id] = node
        return node

    def connect(self, parent_id: str, child_id: str) -> None:
        self.nodes[parent_id].children.append(child_id)

    # --- serialization ---

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "title": self.title,
            "description": self.description,
            "root": self.root,
            "nodes": {nid: asdict(n) for nid, n in self.nodes.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> Tree:
        tree = cls(
            root=data["root"],
            title=data.get("title", ""),
            description=data.get("description", ""),
            version=data.get("version", "1.0"),
        )
        for nid, ndata in data["nodes"].items():
            tree.nodes[nid] = Node(**ndata)
        return tree

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.write_text(json.dumps(self.to_dict(), indent=2) + "\n")

    @classmethod
    def load(cls, path: str | Path) -> Tree:
        return cls.from_dict(json.loads(Path(path).read_text()))


_CATEGORIES = {
    "sequence": "composite",
    "selector": "composite",
    "action": "leaf",
    "condition": "leaf",
    "invert": "decorator",
}


@dataclass
class Layout:
    """Visual positions, kept separate from tree logic."""
    version: str = "1.0"
    nodes: dict[str, dict[str, float]] = field(default_factory=dict)

    def set_pos(self, node_id: str, x: float, y: float) -> None:
        self.nodes[node_id] = {"x": x, "y": y}

    def to_dict(self) -> dict:
        return {"version": self.version, "nodes": self.nodes}

    @classmethod
    def from_dict(cls, data: dict) -> Layout:
        return cls(version=data.get("version", "1.0"), nodes=data.get("nodes", {}))

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2) + "\n")

    @classmethod
    def load(cls, path: str | Path) -> Layout:
        return cls.from_dict(json.loads(Path(path).read_text()))
