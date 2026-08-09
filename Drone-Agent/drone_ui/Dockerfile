# LabAtHome Ground Control - single container serving both the FastAPI
# backend and the static dashboard (mounted by server.py at "/").
#
# Build from the repo root:
#   docker build -t labathome-ground-control .
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

WORKDIR /app/backend
EXPOSE 8765

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
