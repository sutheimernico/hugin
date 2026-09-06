"""Replay: the stored event log played back as if it were happening now.

A run is already a fully ordered list of events, so replay needs no second state model — the
player re-emits what the log holds and the recorder freezes a run into a committable file.
"""

from hugin.replay.player import Player
from hugin.replay.recorder import SECRET_PATTERNS, Recorder, ScrubError, scrub

__all__ = ["SECRET_PATTERNS", "Player", "Recorder", "ScrubError", "scrub"]
