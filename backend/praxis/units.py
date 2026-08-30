"""
PRAX amounts.

Everything below the API boundary works in wei, because that is what the
contracts use and rounding a bond before slashing it would put the orchestrator
out of step with the chain. Everything above it is a decimal string in whole
PRAX, because that is what the dashboard's types declare ("8000", not
"8000000000000000000000").

This module owns the conversion so no other module has to think about it.
"""

from __future__ import annotations

from decimal import Decimal

__all__ = ["DECIMALS", "WEI", "to_wei", "format_prax", "parse_prax"]

DECIMALS = 18
WEI = 10**DECIMALS


def to_wei(whole: int | str | Decimal) -> int:
    """Whole PRAX -> wei. Accepts fractional input ("0.5") and truncates below 1 wei."""
    return int(Decimal(str(whole)) * WEI)


def format_prax(amount_wei: int) -> str:
    """wei -> the decimal string the API serves.

    Exact: no rounding, no thousands separators, no trailing zeros.
    10_000 * 10**18 renders as "10000"; a half-token as "0.5". The dashboard's
    ``formatPrax`` adds the separators for display.
    """
    negative = amount_wei < 0
    magnitude = -amount_wei if negative else amount_wei
    whole, fraction = divmod(magnitude, WEI)
    text = str(whole)
    if fraction:
        text = f"{text}.{str(fraction).rjust(DECIMALS, '0').rstrip('0')}"
    return f"-{text}" if negative else text


def parse_prax(amount: str) -> int:
    """Inverse of :func:`format_prax`, for reading config and fixtures."""
    return to_wei(amount)
