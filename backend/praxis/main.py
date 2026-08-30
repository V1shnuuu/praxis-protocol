"""
Entry point.

    uvicorn praxis.main:app --reload        # development
    python -m praxis.main                   # same thing, no reload
    praxis-orchestrator                     # after `pip install -e .`
"""

from __future__ import annotations

import logging
import os

from .api import create_app

__all__ = ["app", "run"]

logging.basicConfig(
    level=os.environ.get("PRAXIS_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-7s %(name)-22s %(message)s",
    datefmt="%H:%M:%S",
)

app = create_app()


def run() -> None:
    """Serves the app with uvicorn, reading host and port from the environment."""
    import uvicorn

    uvicorn.run(
        "praxis.main:app",
        host=os.environ.get("PRAXIS_HOST", "127.0.0.1"),
        port=int(os.environ.get("PRAXIS_PORT", "8000")),
        reload=os.environ.get("PRAXIS_RELOAD", "").lower() in {"1", "true", "yes"},
    )


if __name__ == "__main__":
    run()
