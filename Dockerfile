FROM python:3.11-slim

# ffmpeg para corte/mix de video, fontconfig+curl para instalar a fonte Poppins no build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Poppins instalada em build-time (nao precisa mais baixar em cada execucao)
RUN mkdir -p /usr/share/fonts/truetype/poppins && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf" -o /usr/share/fonts/truetype/poppins/Poppins-Bold.ttf && \
    curl -sL "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf" -o /usr/share/fonts/truetype/poppins/Poppins-Regular.ttf && \
    fc-cache -f

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 5000

# timeout alto porque processamento de video pode demorar (deteccao de batida + ffmpeg)
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "300", "app:app"]
