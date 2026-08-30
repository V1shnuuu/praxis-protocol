"""
The agents' brain: Ollama when it is there, nothing when it isn't.

``Brain.decide`` returns ``None`` rather than raising whenever the model can't
answer usefully — unreachable, slow, or replying with prose instead of a
decision. The caller then falls back to its deterministic rule. That keeps the
orchestrator runnable on a laptop with no GPU and a judge's machine with no
Ollama at all, without either path being a special case.

What the model is *not* allowed to do is change the shape of the record. It
supplies the reasoning and the output fields; the orchestrator still hashes the
same canonical body and the watcher still checks the same policy. A model that
argues its way into a policy breach produces exactly the artefact this protocol
is built to catch.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

__all__ = ["Answer", "Brain", "OllamaBrain", "NullBrain"]

log = logging.getLogger("praxis.llm")

_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)

_SYSTEM = """You are an autonomous agent operating under a policy you registered publicly and staked a bond against.

Decide what to do with the inputs you are given, then reply with ONLY a JSON object:
{"output": {...}, "reasoning": "two or three sentences explaining the decision"}

The "output" object must use exactly the keys listed for your role. Do not add prose outside the JSON."""

#: The output shape each role must return, spelled out for the model.
_OUTPUT_SHAPES = {
    "trading": (
        '{"action": "BUY" | "SELL" | "HOLD", "notional": <number, USD>, '
        '"resultingAllocation": <number, 0..1, the share of the book this asset '
        "holds after the trade>}"
    ),
    "dao-voting": '{"action": "YES" | "NO" | "ABSTAIN", "rationale": "<short phrase>"}',
    "lending": (
        '{"action": "APPROVE" | "REJECT", "principal": <number, PRAX>, '
        '"reason": "<short phrase, only when rejecting>"}'
    ),
}

#: Keys that must be present and of the right type for an answer to be usable.
_REQUIRED_ACTIONS = {
    "trading": {"BUY", "SELL", "HOLD"},
    "dao-voting": {"YES", "NO", "ABSTAIN"},
    "lending": {"APPROVE", "REJECT"},
}


@dataclass(frozen=True)
class Answer:
    output: dict[str, Any]
    reasoning: str
    model: str


class Brain:
    """Interface the agents decide against."""

    available: bool = False
    model: str | None = None

    async def decide(self, *, kind: str, policy: str, inputs: dict[str, Any]) -> Answer | None:
        raise NotImplementedError

    async def probe(self) -> bool:
        """Refreshes ``available``. Cheap enough to call on every status poll."""
        return False

    async def aclose(self) -> None:
        return None


class NullBrain(Brain):
    """No model. Every agent uses its deterministic rule."""

    async def decide(self, *, kind: str, policy: str, inputs: dict[str, Any]) -> Answer | None:
        return None

    async def probe(self) -> bool:
        return False


class OllamaBrain(Brain):
    """Talks to a local Ollama daemon.

    Availability is cached rather than probed per decision: a dead daemon
    shouldn't cost every agent a connection timeout on every tick.
    """

    def __init__(self, base_url: str, model: str, timeout_seconds: float = 20.0):
        self._base_url = base_url.rstrip("/")
        self.model = model
        self._timeout = timeout_seconds
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout_seconds)
        self.available = False

    async def aclose(self) -> None:
        await self._client.aclose()

    async def probe(self) -> bool:
        """True when the daemon answers and has the configured model pulled."""
        try:
            response = await self._client.get("/api/tags", timeout=2.0)
            response.raise_for_status()
            tags = response.json().get("models", [])
        except (httpx.HTTPError, ValueError) as error:
            if self.available:
                log.info("ollama became unreachable (%s); falling back to rules", error)
            self.available = False
            return False

        names = {str(entry.get("name", "")) for entry in tags}
        # Ollama reports "gemma3:latest" for a model pulled as "gemma3".
        stem = self.model.split(":")[0]
        self.available = any(name == self.model or name.split(":")[0] == stem for name in names)
        if not self.available and names:
            log.warning(
                "ollama is up but %r is not pulled (have: %s); using rule-based decisions",
                self.model,
                ", ".join(sorted(names)) or "nothing",
            )
        return self.available

    async def decide(self, *, kind: str, policy: str, inputs: dict[str, Any]) -> Answer | None:
        if not self.available:
            return None

        prompt = (
            f"Your declared policy: {policy}\n\n"
            f"Inputs for this decision:\n{json.dumps(inputs, indent=2, ensure_ascii=False)}\n\n"
            f'The "output" object must have this shape: {_OUTPUT_SHAPES.get(kind, "{}")}\n\n'
            "Reply with the JSON object only."
        )

        try:
            response = await self._client.post(
                "/api/generate",
                json={
                    "model": self.model,
                    "system": _SYSTEM,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {"temperature": 0.4},
                },
            )
            response.raise_for_status()
            raw = response.json().get("response", "")
        except (httpx.HTTPError, ValueError) as error:
            log.info("ollama call failed (%s); falling back to rules", error)
            self.available = False
            return None

        answer = _parse(raw, kind, self.model)
        if answer is None:
            log.info("ollama returned an unusable decision for %s; falling back to rules", kind)
        return answer


def _parse(raw: str, kind: str, model: str) -> Answer | None:
    """Pulls a decision out of a model response, or None if there isn't one."""
    if not raw or not raw.strip():
        return None

    text = raw.strip()
    fenced = _JSON_FENCE.search(text)
    if fenced:
        text = fenced.group(1)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Last resort: the outermost braces in a reply that wrapped the JSON in prose.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None

    if not isinstance(parsed, dict):
        return None

    output = parsed.get("output")
    if not isinstance(output, dict):
        return None

    action = str(output.get("action", "")).upper()
    if action not in _REQUIRED_ACTIONS.get(kind, set()):
        return None
    output["action"] = action

    reasoning = parsed.get("reasoning")
    if not isinstance(reasoning, str) or not reasoning.strip():
        return None

    # Numbers must be numbers: the trail is hashed, and "4000" and 4000 are
    # different bytes. Coerce what is coercible, drop the answer if it isn't.
    for key in ("notional", "resultingAllocation", "principal"):
        if key in output and not isinstance(output[key], (int, float)):
            try:
                output[key] = float(str(output[key]).replace(",", "").replace("$", ""))
            except ValueError:
                return None

    return Answer(output=output, reasoning=reasoning.strip(), model=model)


def build_brain(
    *, enabled: bool, base_url: str, model: str, timeout_seconds: float
) -> Brain:
    """The brain implied by configuration. ``PRAXIS_LLM_ENABLED=0`` forces the rules."""
    if not enabled:
        return NullBrain()
    return OllamaBrain(base_url=base_url, model=model, timeout_seconds=timeout_seconds)
