# Titan CC — RunPod GPU transcription worker
#
# Base: RunPod's official PyTorch 2.4 + CUDA 12.4 image.
# This base is pre-cached on every RunPod worker, so only our delta layers
# (~2 GB: packages + Whisper model) are pulled on cold start → ~90s total
# instead of 10+ minutes with a plain nvidia/cuda base.
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Prevent HuggingFace from hitting the network at runtime (model is baked in).
    HF_HUB_OFFLINE=1 \
    # Tell torch.hub to use the baked cache directory.
    TORCH_HOME=/root/.cache/torch

# ffmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# PyTorch is already in the base image; install only our extras.
RUN pip install --no-cache-dir -r requirements.txt

# ── Bake Whisper medium into image ─────────────────────────────────────────────
# Medium model (~800 MB) keeps image delta small → ~90s cold start total.
# Language is fixed to "en" in the frontend so accuracy is on par with large
# for English-only content. CPU/int8 on build node; float16 on GPU at runtime.
RUN HF_HUB_OFFLINE=0 python -c "\
from faster_whisper import WhisperModel; \
WhisperModel('medium', device='cpu', compute_type='int8'); \
print('Whisper medium baked OK')"

# ── Bake Silero VAD ────────────────────────────────────────────────────────────
# We then verify the exact cache path so the runtime source="local" load is
# guaranteed to find the model without any GitHub network call.
RUN python -c "\
import torch, pathlib; \
torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True); \
hub_dir = pathlib.Path(torch.hub.get_dir()); \
candidates = [p for b in ('master', 'main') for p in [hub_dir / f'snakers4_silero-vad_{b}'] if (p / 'hubconf.py').exists()]; \
assert candidates, f'silero-vad cache not found under {hub_dir}'; \
print('Silero VAD baked OK at', candidates[0])"

# ── App code ───────────────────────────────────────────────────────────────────
COPY . .

CMD ["python", "handler.py"]
