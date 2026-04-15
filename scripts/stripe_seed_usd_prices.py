#!/usr/bin/env python3
"""Backward-compatible entrypoint — seeds all tiers (T1–T6), not USD-only."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parent / "stripe_seed_prices.py"), run_name="__main__")
