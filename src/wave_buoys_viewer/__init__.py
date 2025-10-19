import logging

from .scrap import scrap_wave_buoy_data

FORMAT = "%(message)s"
logging.basicConfig(
    level="INFO",
    format=FORMAT,
    datefmt="[%X]",
)

__all__ = ["scrap_wave_buoy_data"]

# Disable loggers for third-party libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
