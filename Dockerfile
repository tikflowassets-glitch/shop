FROM python:3.11-slim

# ffmpeg para corte/mix de video, fontconfig+curl para instalar a fonte,
# pip pra rodar o fonttools que extrai a instancia estatica da fonte variavel
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fontconfig \
    curl \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# TikTok Sans (fonte oficial da TikTok, open-source) instalada em build-time.
# E uma fonte variavel (varios pesos num arquivo so) - extraimos uma instancia
# estatica em negrito (wght=700) pra funcionar bem com o drawtext do ffmpeg,
# que nao sabe ajustar eixos de fonte variavel sozinho.
RUN pip install --no-cache-dir --break-system-packages fonttools && \
    mkdir -p /usr/share/fonts/truetype/tiktoksans && \
    curl -sL "https://raw.githubusercontent.com/google/fonts/main/ofl/tiktoksans/TikTokSans%5Bopsz,slnt,wdth,wght%5D.ttf" \
      -o /tmp/TikTokSansVariable.ttf && \
    fonttools varLib.instancer -o /usr/share/fonts/truetype/tiktoksans/TikTokSans-Bold.ttf \
      /tmp/TikTokSansVariable.ttf opsz=24 slnt=0 wdth=100 wght=700 && \
    fonttools varLib.instancer -o /usr/share/fonts/truetype/tiktoksans/TikTokSans-Regular.ttf \
      /tmp/TikTokSansVariable.ttf opsz=24 slnt=0 wdth=100 wght=400 && \
    rm /tmp/TikTokSansVariable.ttf && \
    fc-cache -f

# Noto Color Emoji (Google, open-source) - a TikTok Sans nao tem desenhos de
# emoji coloridos, entao usamos essa fonte separada so pros caracteres de
# emoji na legenda (composta via PIL, nao via drawtext do ffmpeg)
RUN mkdir -p /usr/share/fonts/truetype/notoemoji && \
    curl -sL "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/fonts/NotoColorEmoji.ttf" \
      -o /usr/share/fonts/truetype/notoemoji/NotoColorEmoji.ttf && \
    fc-cache -f

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app.py .

EXPOSE 5000

# timeout alto porque processamento de video sem compressao pode demorar bastante
# (deteccao de batida + varios passos de ffmpeg em video de alta resolucao)
CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:5000", "--timeout", "1200", "app:app"]
