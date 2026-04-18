FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py sanctuary_descriptors.pkl ./

RUN useradd -m appuser
USER appuser

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
