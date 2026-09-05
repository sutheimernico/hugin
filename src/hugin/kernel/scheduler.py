"""Per-driver concurrency limits, kept pure so the kernel can ask without side effects.

The scheduler owns no queue and emits no events: it answers one question — may this driver
start one more process right now. The kernel owns the FIFO queue and acts on the answer,
which keeps the admission rule trivially testable and the ordering decisions in one place.
"""

# A driver the settings do not mention runs one process at a time: an unknown driver is more
# likely a typo or a heavy local model than something safe to fan out.
DEFAULT_LIMIT = 1


class Scheduler:
    def __init__(self, limits: dict[str, int]):
        self._limits = dict(limits)

    def limit_for(self, driver: str) -> int:
        return self._limits.get(driver, DEFAULT_LIMIT)

    def can_start(self, driver: str, running_by_driver: dict[str, int]) -> bool:
        return running_by_driver.get(driver, 0) < self.limit_for(driver)
