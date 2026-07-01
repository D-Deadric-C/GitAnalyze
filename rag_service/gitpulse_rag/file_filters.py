from __future__ import annotations

import re


SKIP_PATTERN = re.compile(
    r"(\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css|woff|woff2|ttf|otf|eot)|package-lock\.json|yarn\.lock)$",
    re.IGNORECASE,
)


def prune_file_paths(paths: list[str]) -> list[str]:
    return [
        path
        for path in paths
        if not SKIP_PATTERN.search(path)
        and "node_modules/" not in path
        and ".git/" not in path
    ]

