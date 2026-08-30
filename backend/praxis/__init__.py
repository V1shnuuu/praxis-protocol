"""
Praxis Protocol orchestrator.

Runs three autonomous agents, commits a hashed reasoning trail for every
decision they make, watches those decisions against the policies the agents
declared on-chain, and serves the whole thing to the dashboard.

The module layout follows the flow of one decision:

    agents.py       decide, with an LLM or a rule
    canonical.py    serialise the trail the one way all three parties agree on
    ledger.py       commit the hash (simulation)  ─┐ one interface
    chain.py        commit the hash (Polygon Amoy) ─┘
    store.py        file the trail off-chain
    policy.py       read the decision back and judge it
    orchestrator.py drive the loop, hold the feed
    api.py          serve it
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
