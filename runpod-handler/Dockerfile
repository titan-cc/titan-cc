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
# Use CPU/int8 during build (no GPU on build nodes); at runtime CTranslate2
# re-quantises to float16 on the GPU from the same cached weights.
# HF_HUB_OFFLINE=0 overrides the ENV so the download can actually happen here.
RUN HF_HUB_OFFLINE=0 python -c "\
from faster_whisper import WhisperModel; \
WhisperModel('large-v3', device='cpu', compute_type='int8'); \
print('Whisper large-v3 baked OK')"

# ── Bake Silero VAD ────────────────────────────────────────────────────────────
RUN python -c "\
import torch; \
torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True); \
print('Silero VAD baked OK')"

# ── App code ───────────────────────────────────────────────────────────────────
COPY . .

CMD ["python", "handler.py"]
