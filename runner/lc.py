"""What LeetCode gives your Python code, plus how test values go in and out (#62 D, E).

Test inputs and expected outputs are LeetCode's text format: one JSON value per parameter per line.
Linked lists and trees are written as lists ([1,2,4], [3,9,20,null,null,15,7]) and converted both ways.
"""

import json
import math
from collections import deque
from typing import Any, Optional

# Run before your code, like LeetCode's own preamble: the usual imports and the two node classes.
PRELUDE = """
from typing import *
import collections, heapq, bisect, math, itertools, functools, string, re, random, operator
from collections import *
from heapq import *
from bisect import *
from itertools import *
from functools import *
from math import inf

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
"""

MAX_NODES = 200_000  # a cycle in your list or tree stops here instead of running forever
FLOAT_TOLERANCE = 1e-5  # LeetCode accepts answers within 10^-5


def _kind(t: str) -> str:
    t = t.lower().replace(" ", "")
    if t in ("listnode", "treenode"):
        return t
    if t in ("listnode[]", "list<listnode>"):
        return "listnode[]"
    if t in ("treenode[]", "list<treenode>"):
        return "treenode[]"
    return "plain"


def build_list(values, ns):
    head = None
    for v in reversed(values or []):
        head = ns["ListNode"](v, head)
    return head


def build_tree(values, ns):
    if not values or values[0] is None:
        return None
    TreeNode = ns["TreeNode"]
    root = TreeNode(values[0])
    queue, i = deque([root]), 1
    while queue and i < len(values):
        node = queue.popleft()
        for side in ("left", "right"):
            if i < len(values) and values[i] is not None:
                child = TreeNode(values[i])
                setattr(node, side, child)
                queue.append(child)
            i += 1
    return root


def to_value(raw, t: str, ns):
    """A parsed JSON value as the type your function receives."""
    kind = _kind(t)
    if kind == "listnode":
        return build_list(raw, ns)
    if kind == "treenode":
        return build_tree(raw, ns)
    if kind == "listnode[]":
        return [build_list(v, ns) for v in raw]
    if kind == "treenode[]":
        return [build_tree(v, ns) for v in raw]
    return raw


def _is_list_node(x) -> bool:
    return hasattr(x, "val") and hasattr(x, "next") and not hasattr(x, "left")


def _is_tree_node(x) -> bool:
    return hasattr(x, "val") and hasattr(x, "left") and hasattr(x, "right")


def _list_out(node):
    out = []
    while node is not None:
        out.append(from_value(node.val))
        node = node.next
        if len(out) > MAX_NODES:
            raise ValueError("your linked list has a cycle or is too long")
    return out


def _tree_out(root):
    if root is None:
        return []
    out, queue = [], deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            out.append(None)
            continue
        out.append(from_value(node.val))
        queue.append(node.left)
        queue.append(node.right)
        if len(out) > MAX_NODES:
            raise ValueError("your tree has a cycle or is too big")
    while out and out[-1] is None:
        out.pop()
    return out


def from_value(x):
    """Your function's answer as plain JSON values (nodes back to lists)."""
    if x is None or isinstance(x, (bool, int, float, str)):
        return x
    if _is_tree_node(x):
        return _tree_out(x)
    if _is_list_node(x):
        return _list_out(x)
    if isinstance(x, (list, tuple, set, frozenset, deque)):
        return [from_value(v) for v in x]
    if isinstance(x, dict):
        return {str(k): from_value(v) for k, v in x.items()}
    raise ValueError(f"can't read an answer of type {type(x).__name__}")


def answer_value(x, t: str):
    """Your answer as plain JSON values; an empty list or tree is [], as LeetCode prints it."""
    if x is None and _kind(t) in ("listnode", "treenode"):
        return []
    return from_value(x)


def _canonical(x):
    if isinstance(x, list):
        items = [_canonical(v) for v in x]
        return sorted(items, key=lambda v: json.dumps(v, sort_keys=True))
    return x


def same(actual: Any, expected: Any, any_order: bool = False) -> bool:
    """LeetCode-style comparison: exact, except decimals within 10^-5 and order when it doesn't matter."""
    if any_order:
        actual, expected = _canonical(actual), _canonical(expected)
    return _same(actual, expected)


def _same(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if isinstance(a, float) or isinstance(b, float):
            if math.isnan(a) or math.isnan(b):
                return False
            return abs(a - b) <= FLOAT_TOLERANCE * max(1.0, abs(b))
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def parse_lines(text: str) -> list:
    """One JSON value per line, as LeetCode writes test inputs."""
    return [json.loads(line) for line in text.split("\n") if line.strip() != ""]


def show(value: Optional[Any]) -> str:
    """A value as LeetCode prints it."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
