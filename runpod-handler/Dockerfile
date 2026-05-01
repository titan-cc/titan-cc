# Titan CC — RunPod GPU transcription worker
# Base: CUDA 12.4 + cuDNN runtime on Ubuntu 24.04 (Python 3.12 in default repos)
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH}

# ── System packages ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-dev python3-pip \
        ffmpeg \
        git \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.12 /usr/bin/python3 \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

# ── Python packages ────────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .

# Install PyTorch (CUDA 12.4 wheel) first so faster-whisper links the GPU build
RUN pip install --no-cache-dir \
        torch==2.3.1 torchaudio==2.3.1 \
        --index-url https://download.pytorch.org/whl/cu124

RUN pip install --no-cache-dir -r requirements.txt

# ── Bake Whisper large-v3 into the image (eliminates cold-start download) ──────
# Uses CTranslate2 int8 during build (CPU); at runtime it will load float16 on GPU.
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8')"

# ── Bake Silero VAD model ──────────────────────────────────────────────────────
RUN python -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True)"

# ── App code ───────────────────────────────────────────────────────────────────
COPY . .

CMD ["python", "handler.py"]
