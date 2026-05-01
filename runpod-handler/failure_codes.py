"""
Failure classification — mirrored exactly in backend app/models.py.
Both the handler and the backend must agree on every code string.
"""

import enum


class FailureCode(str, enum.Enum):
    FILE_UNREADABLE = "FILE_UNREADABLE"
    FILE_NO_AUDIO_TRACK = "FILE_NO_AUDIO_TRACK"
    AUDIO_TOO_QUIET = "AUDIO_TOO_QUIET"
    FILE_TOO_LONG = "FILE_TOO_LONG"
    GPU_OOM = "GPU_OOM"
    S3_DOWNLOAD_FAILED = "S3_DOWNLOAD_FAILED"
    WORKER_CRASHED = "WORKER_CRASHED"
    JOB_TIMEOUT = "JOB_TIMEOUT"
    USER_CANCELLED = "USER_CANCELLED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"


class FailureClass(str, enum.Enum):
    user_content = "user_content"
    user_quota = "user_quota"
    system_transient = "system_transient"
    system_permanent = "system_permanent"
    timeout = "timeout"
    cancelled = "cancelled"


_CLASS_MAP: dict[FailureCode, FailureClass] = {
    FailureCode.FILE_UNREADABLE:     FailureClass.user_content,
    FailureCode.FILE_NO_AUDIO_TRACK: FailureClass.user_content,
    FailureCode.AUDIO_TOO_QUIET:     FailureClass.user_content,
    FailureCode.FILE_TOO_LONG:       FailureClass.user_content,
    FailureCode.GPU_OOM:             FailureClass.system_transient,
    FailureCode.S3_DOWNLOAD_FAILED:  FailureClass.system_transient,
    FailureCode.WORKER_CRASHED:      FailureClass.system_permanent,
    FailureCode.JOB_TIMEOUT:         FailureClass.timeout,
    FailureCode.USER_CANCELLED:      FailureClass.cancelled,
    FailureCode.QUOTA_EXCEEDED:      FailureClass.user_quota,
}

_USER_MESSAGES: dict[FailureCode, str] = {
    FailureCode.FILE_UNREADABLE:     "Your file appears corrupt. Try re-exporting.",
    FailureCode.FILE_NO_AUDIO_TRACK: "No audio track found.",
    FailureCode.AUDIO_TOO_QUIET:     "No speech detected.",
    FailureCode.FILE_TOO_LONG:       "File exceeds maximum duration.",
    FailureCode.GPU_OOM:             "Temporary system issue. Retrying...",
    FailureCode.S3_DOWNLOAD_FAILED:  "Network issue. Retrying...",
    FailureCode.WORKER_CRASHED:      "Something went wrong on our end.",
    FailureCode.JOB_TIMEOUT:         "Taking longer than expected. Retrying...",
    FailureCode.USER_CANCELLED:      "Cancelled.",
    FailureCode.QUOTA_EXCEEDED:      "Monthly limit reached.",
}


class PipelineError(Exception):
    """Raised by any pipeline stage to signal a classified failure."""

    def __init__(self, code: FailureCode, detail: str, extra: dict | None = None) -> None:
        super().__init__(detail)
        self.code = code
        self.failure_class = _CLASS_MAP[code]
        self.user_message = _USER_MESSAGES[code]
        self.extra = extra or {}
