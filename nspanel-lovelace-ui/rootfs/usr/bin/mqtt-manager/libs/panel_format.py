"""Time and date text as the panel sends it to the screensaver (mirrors
LovelaceUIPanel.update_time/update_date; panel.py keeps its own copy because the
existing compat tests stub babel when importing it)."""
import datetime

import babel.dates
from dateutil import tz


def format_time_text(settings, now=None):
    """Return the screensaver time string for a panel's settings."""
    use_timezone = tz.gettz(settings["timeZone"])
    now = now or datetime.datetime.now(use_timezone)
    return now.astimezone(use_timezone).strftime(settings["timeFormat"])


def format_date_text(settings, now=None):
    """Return the screensaver date string (without any additional template text)."""
    use_timezone = tz.gettz(settings["timeZone"])
    now = now or datetime.datetime.now(use_timezone)
    return babel.dates.format_date(now.astimezone(use_timezone), settings["dateFormat"], locale=settings["locale"])
