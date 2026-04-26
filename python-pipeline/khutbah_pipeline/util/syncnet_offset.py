"""SyncNet-based A/V offset detection (Chung & Zisserman, BMVC 2016).

The pretrained SyncNet network embeds 5-frame face crops + 0.2s MFCC into
1024-D vectors. Audio and visual embeddings of the same time window have
minimal L2 distance only when synchronised. Trying every lag in
[-vshift, +vshift] frames and picking the distance-minimising lag yields
sub-frame precision (~20ms at 25fps).

Model file: resources/models/syncnet_v2.model (53MB, gitignored).
Face crops: mediapipe FaceLandmarker (already in our deps).
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from typing import Optional

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG


SYNCNET_MODEL_PATH = "/home/farouq/Development/alhimmah/resources/models/syncnet_v2.model"
SYNCNET_FPS = 25
SYNCNET_AUDIO_HZ = 16000
SYNCNET_CROP = 224
DEFAULT_VSHIFT = 15  # ±15 frames @ 25fps = ±600ms


def _build_syncnet_model():
    import torch
    import torch.nn as nn

    class S(nn.Module):
        def __init__(self, num_layers_in_fc_layers=1024):
            super().__init__()
            self.netcnnaud = nn.Sequential(
                nn.Conv2d(1, 64, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)),
                nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(1, 1), stride=(1, 1)),
                nn.Conv2d(64, 192, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)),
                nn.BatchNorm2d(192), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(3, 3), stride=(1, 2)),
                nn.Conv2d(192, 384, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(384), nn.ReLU(inplace=True),
                nn.Conv2d(384, 256, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(256), nn.ReLU(inplace=True),
                nn.Conv2d(256, 256, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(256), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(3, 3), stride=(2, 2)),
                nn.Conv2d(256, 512, kernel_size=(5, 4), padding=(0, 0)),
                nn.BatchNorm2d(512), nn.ReLU(),
            )
            self.netfcaud = nn.Sequential(
                nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(),
                nn.Linear(512, num_layers_in_fc_layers),
            )
            self.netfclip = nn.Sequential(
                nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(),
                nn.Linear(512, num_layers_in_fc_layers),
            )
            self.netcnnlip = nn.Sequential(
                nn.Conv3d(3, 96, kernel_size=(5, 7, 7), stride=(1, 2, 2), padding=0),
                nn.BatchNorm3d(96), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
                nn.Conv3d(96, 256, kernel_size=(1, 5, 5), stride=(1, 2, 2), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2), padding=(0, 1, 1)),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
                nn.Conv3d(256, 512, kernel_size=(1, 6, 6), padding=0),
                nn.BatchNorm3d(512), nn.ReLU(inplace=True),
            )

        def forward_aud(self, x):
            mid = self.netcnnaud(x)
            return self.netfcaud(mid.view((mid.size()[0], -1)))

        def forward_lip(self, x):
            mid = self.netcnnlip(x)
            return self.netfclip(mid.view((mid.size()[0], -1)))

    return S()


def _extract_audio_wav(src, start, duration, dst):
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
         "-vn", "-ac", "1", "-ar", str(SYNCNET_AUDIO_HZ),
         "-f", "wav", dst],
        check=True, capture_output=True,
    )


def _extract_face_crops(src, start, duration, crop_size=SYNCNET_CROP):
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision
    import cv2

    raw_w, raw_h = 640, 360
    proc = subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
         "-an", "-vf", f"scale={raw_w}:{raw_h},fps={SYNCNET_FPS}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        capture_output=True, check=True,
    )
    fb = raw_w * raw_h * 3
    n = len(proc.stdout) // fb
    if n < SYNCNET_FPS * 2:
        return None
    frames = np.frombuffer(proc.stdout[:n*fb], dtype=np.uint8).reshape(n, raw_h, raw_w, 3)

    options = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(
            model_asset_path="/home/farouq/Development/alhimmah/resources/models/face_landmarker.task"
        ),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_faces=1, min_face_detection_confidence=0.4,
    )
    crops = np.zeros((n, crop_size, crop_size, 3), dtype=np.uint8)
    n_det = 0
    with mp_vision.FaceLandmarker.create_from_options(options) as fm:
        for i, frame in enumerate(frames):
            ts = int(i * 1000 / SYNCNET_FPS)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
            r = fm.detect_for_video(mp_image, ts)
            if not r.face_landmarks:
                continue
            lm = r.face_landmarks[0]
            xs = [p.x * raw_w for p in lm]
            ys = [p.y * raw_h for p in lm]
            cx = (min(xs) + max(xs)) / 2
            cy = min(ys) * 0.4 + max(ys) * 0.6
            half = max(max(xs) - min(xs), max(ys) - min(ys)) * 0.7
            x0 = int(max(0, cx - half))
            y0 = int(max(0, cy - half))
            x1 = int(min(raw_w, cx + half))
            y1 = int(min(raw_h, cy + half))
            if x1 - x0 < 30 or y1 - y0 < 30:
                continue
            crops[i] = cv2.resize(frame[y0:y1, x0:x1], (crop_size, crop_size))
            n_det += 1
    if n_det < n * 0.7:
        return None
    return crops


def _calc_pdist(feat1, feat2, vshift):
    import torch
    win = vshift * 2 + 1
    feat2p = torch.nn.functional.pad(feat2, (0, 0, vshift, vshift))
    dists = []
    for i in range(len(feat1)):
        dists.append(
            torch.nn.functional.pairwise_distance(
                feat1[[i], :].repeat(win, 1), feat2p[i:i + win, :]
            )
        )
    return dists


def syncnet_offset(src, probe_start, probe_duration=8.0, vshift=DEFAULT_VSHIFT, device=None):
    """SyncNet inference on a single probe window."""
    import torch
    import python_speech_features
    from scipy.io import wavfile

    if not os.path.exists(SYNCNET_MODEL_PATH):
        return None
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    crops = _extract_face_crops(src, probe_start, probe_duration)
    if crops is None or len(crops) < SYNCNET_FPS * 2:
        return None

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        _extract_audio_wav(src, probe_start, probe_duration, wav)
        sr, audio = wavfile.read(wav)
        mfcc = np.stack([np.array(c) for c in zip(*python_speech_features.mfcc(audio, sr))])

    model = _build_syncnet_model().to(device)
    state = torch.load(SYNCNET_MODEL_PATH, map_location=device, weights_only=False)
    model.load_state_dict(state)
    # PyTorch eval mode (sets dropout/batchnorm to inference behaviour).
    model.eval()  # noqa: pytorch-eval

    im = crops.transpose(3, 0, 1, 2)
    im = np.expand_dims(im, axis=0)
    imtv = torch.from_numpy(im.astype(np.float32))

    cc = np.expand_dims(np.expand_dims(mfcc, axis=0), axis=0)
    cct = torch.from_numpy(cc.astype(np.float32))

    min_len = min(len(crops), int(np.floor(len(audio) / 640)))
    last = min_len - 5
    if last < 5:
        return None

    im_feat, cc_feat = [], []
    batch = 32
    with torch.no_grad():
        for i in range(0, last, batch):
            ib = torch.cat(
                [imtv[:, :, v:v+5, :, :] for v in range(i, min(last, i+batch))], 0
            ).to(device)
            im_feat.append(model.forward_lip(ib).data.cpu())
            cb = torch.cat(
                [cct[:, :, :, v*4:v*4+20] for v in range(i, min(last, i+batch))], 0
            ).to(device)
            cc_feat.append(model.forward_aud(cb).data.cpu())
    im_feat = torch.cat(im_feat, 0)
    cc_feat = torch.cat(cc_feat, 0)
    dists = _calc_pdist(im_feat, cc_feat, vshift=vshift)
    mdist = torch.mean(torch.stack(dists, 1), 1)
    minval, minidx = torch.min(mdist, 0)
    offset_frames = int(vshift - minidx.item())
    confidence = float(torch.median(mdist).item() - minval.item())
    offset_ms = int(round(offset_frames * 1000 / SYNCNET_FPS))
    return {
        "offset_ms": offset_ms,
        "confidence": confidence,
        "min_dist": float(minval.item()),
        "median_dist": float(torch.median(mdist).item()),
        "probe_window": [probe_start, probe_start + probe_duration],
    }


def syncnet_offset_robust(src, probe_starts, probe_duration=8.0, min_confidence=1.0, device=None):
    samples = []
    for s in probe_starts:
        r = syncnet_offset(src, probe_start=s, probe_duration=probe_duration, device=device)
        if r and r["confidence"] >= min_confidence:
            samples.append(r)
    if not samples:
        return None
    offs = sorted(s["offset_ms"] for s in samples)
    return {
        "offset_ms": offs[len(offs) // 2],
        "confidence": sum(s["confidence"] for s in samples) / len(samples),
        "n_samples": len(samples),
        "samples": samples,
    }
