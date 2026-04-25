"""FFT-based alignment for dual-file (separate audio + video) khutbah recordings.
Per spec §5.5.

Recovers the time offset between a 'reference' signal (typically the camera's
embedded audio) and a 'signal' (typically a lapel mic). Returns offset in
seconds and a confidence ratio (median_MSE / min_MSE).

Algorithm: FFT-accelerated minimum mean-square-error (MSE) alignment.
This is equivalent to FFT cross-correlation but uses the MSE formulation:

    MSE(L) = mean( (sig[L:] - ref[0:N-L])^2 )
           = (sum_sig_overlap^2 + sum_ref_overlap^2 - 2·xcorr_valid(L)) / M

where xcorr_valid(L) is computed via scipy.signal.correlate(..., method='fft')
and the energy terms are computed from prefix-sum arrays in O(1) per lag.

The MSE formulation is necessary (vs raw cross-correlation peak finding) because
cross-correlation peak amplitude is biased toward shorter lags: longer overlapping
windows produce higher raw correlation values even when the alignment is wrong.
MSE cancels this bias by dividing by window energy.

numpy/scipy imports are DEFERRED inside functions so this module can be imported
without those deps installed. Tests that need them use pytest.importorskip.
"""
import io
import subprocess
from typing import Any, Tuple

from khutbah_pipeline.util.ffmpeg import FFMPEG

# Maximum lag range searched (seconds). Real khutbah recordings rarely diverge
# by more than a few seconds.
_DEFAULT_MAX_LAG_SEC: float = 5.0

# Speech-band bandpass corners per spec §5.5.
_BANDPASS_LOW_HZ: float = 200.0
_BANDPASS_HIGH_HZ: float = 3400.0


def _bandpass(signal: Any, sr: int) -> Any:
    """Apply a 4th-order Butterworth bandpass (200-3400 Hz) per spec §5.5.

    Deferred numpy/scipy imports so this module can be imported without them.
    """
    import numpy as np
    import scipy.signal as ss  # type: ignore[import-untyped]

    signal = np.asarray(signal, dtype=np.float64)
    nyq = sr / 2.0
    low = _BANDPASS_LOW_HZ / nyq
    high = _BANDPASS_HIGH_HZ / nyq
    # Clamp to valid range in case sr is very low in tests
    low = max(low, 1e-6)
    high = min(high, 1.0 - 1e-6)
    b, a = ss.butter(4, [low, high], btype="band")
    return ss.filtfilt(b, a, signal)


def align_audio_arrays(
    sig: Any,
    ref: Any,
    sr: int = 16000,
    max_lag_sec: float = _DEFAULT_MAX_LAG_SEC,
) -> Tuple[float, float]:
    """Return (offset_seconds, confidence_ratio).

    Bandpass-filters BOTH inputs to the speech band (200-3400 Hz) per spec §5.5
    to reject mains hum / rumble / out-of-speech-band noise that would weaken
    the alignment peak in real lapel-vs-camera recordings.

    Uses FFT-accelerated MSE minimization rather than raw cross-correlation
    argmax to avoid the overlap-length bias that affects short or strongly-
    periodic signals.

    Convention: positive offset = sig's content is delayed relative to ref
    (sig file has extra content at start that doesn't appear in ref).
    Confidence: peak / median(|score|); >5 indicates clear single minimum.

    Algorithm complexity: O(N log N) via FFT cross-correlation + O(N) prefix sums.
    """
    import numpy as np
    import scipy.signal  # type: ignore[import-untyped]

    sig = np.asarray(sig, dtype=np.float64)
    ref = np.asarray(ref, dtype=np.float64)

    # Bandpass FIRST to suppress out-of-speech-band noise.
    sig = _bandpass(sig, sr)
    ref = _bandpass(ref, sr)
    N = min(len(sig), len(ref))
    sig = sig[:N]
    ref = ref[:N]
    max_lag = min(int(max_lag_sec * sr), N - 1)

    # Full cross-correlation via FFT.
    # xcorr[(N-1)+L] = sum_n sig[n] * ref[n - L]  (zero-padded at boundaries)
    # This equals the "valid overlap" cross-correlation for every lag L.
    xcorr = scipy.signal.correlate(sig, ref, mode="full", method="fft")

    # Prefix sums for energy over any contiguous window in O(1).
    sig_sq_cs = np.concatenate([[0.0], np.cumsum(sig ** 2)])  # sig_sq_cs[i] = sum sig[0:i]^2
    ref_sq_cs = np.concatenate([[0.0], np.cumsum(ref ** 2)])

    # Vectorised MSE over all integer lags in [-max_lag, +max_lag].
    lags = np.arange(-max_lag, max_lag + 1)
    M = N - np.abs(lags)  # overlap length for each lag

    # Energy of sig in its overlap window.
    # L >= 0 → overlap is sig[L:N]  →  sig_sq_cs[N] - sig_sq_cs[L]
    # L <  0 → overlap is sig[0:N+L] →  sig_sq_cs[N+L]
    sig_start = np.where(lags >= 0, lags, 0)
    sig_end = np.where(lags >= 0, N, N + lags)
    sum_sig2 = sig_sq_cs[sig_end] - sig_sq_cs[sig_start]

    # Energy of ref in its overlap window.
    # L >= 0 → overlap is ref[0:N-L] →  ref_sq_cs[N-L]
    # L <  0 → overlap is ref[-L:N]  →  ref_sq_cs[N] - ref_sq_cs[-L]
    ref_start = np.where(lags >= 0, 0, -lags)
    ref_end = np.where(lags >= 0, N - lags, N)
    sum_ref2 = ref_sq_cs[ref_end] - ref_sq_cs[ref_start]

    # Cross-correlation values for each lag.
    xcorr_at_lags = xcorr[(N - 1) + lags]

    # MSE = (E_sig + E_ref - 2·xcorr) / M.
    # Clip to 0 to prevent FFT floating-point rounding (which can produce tiny
    # negatives at lags that should be exactly zero) from distorting argmin.
    mse = np.maximum(
        (sum_sig2 + sum_ref2 - 2.0 * xcorr_at_lags) / np.maximum(M, 1),
        0.0,
    )

    # Tiny lag penalty: among lags with equal or near-equal MSE (e.g. a
    # periodic test signal that has multiple zero-MSE solutions), prefer the
    # smallest absolute lag. The penalty is negligible for real-audio MSE
    # values but decisive when MSE differences are below ~1e-7.
    lag_penalty = 1e-8 * np.abs(lags)
    best_idx = int(np.argmin(mse + lag_penalty))
    best_lag = int(lags[best_idx])

    min_mse = float(mse[best_idx])
    median_mse = float(np.median(mse))
    confidence = median_mse / (min_mse + 1e-9)

    return best_lag / sr, confidence


def _extract_pcm16k(path: str) -> Any:
    """Extract the audio track of *path* as mono 16 kHz float32 PCM."""
    import numpy as np
    import scipy.io.wavfile as wav  # type: ignore[import-untyped]

    out = subprocess.run(
        [
            FFMPEG, "-hide_banner", "-i", path,
            "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", "-f", "wav", "-",
        ],
        check=True,
        capture_output=True,
    )
    sr, data = wav.read(io.BytesIO(out.stdout))
    if sr != 16000:
        raise RuntimeError(f"Expected 16 kHz output from FFmpeg, got {sr}")
    return data.astype(np.float32) / 32768.0


def align_files(video_path: str, audio_path: str) -> dict[str, Any]:
    """Align an external audio track against a video's embedded audio.

    Returns ``{"offset_seconds": float, "confidence": float}``.

    The video's audio is the reference; the external file is the signal.
    A positive ``offset_seconds`` means the external audio lags the camera
    audio (pass ``-itsoffset <offset>`` to FFmpeg to pad the front of the
    audio track and produce a correctly muxed output).
    """
    ref = _extract_pcm16k(video_path)
    sig = _extract_pcm16k(audio_path)
    n = min(len(ref), len(sig))
    offset, conf = align_audio_arrays(sig[:n], ref[:n])
    return {"offset_seconds": offset, "confidence": conf}
