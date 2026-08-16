import os
import json
import shutil
import subprocess
import tempfile
import uuid

from flask import Flask, request, send_file, jsonify, after_this_request, abort
from flask_cors import CORS
from PIL import ImageFont

app = Flask(__name__)
CORS(app)  # permite chamadas do frontend (Vercel) para este servidor

FONT_BOLD = "/usr/share/fonts/truetype/tiktoksans/TikTokSans-Bold.ttf"

# volume persistente montado no EasyPanel (sobrevive a restart/redeploy)
DATA_DIR = "/data/shop-videos"
RAW_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
MUSIC_DIR = os.path.join(DATA_DIR, "music")
for d in (RAW_DIR, PROCESSED_DIR, MUSIC_DIR):
    os.makedirs(d, exist_ok=True)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Comando falhou: {' '.join(cmd)}\n{r.stderr}")
    return r


def get_duration(path):
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', path])
    return float(r.stdout.strip())


def analyze_music(music_path):
    """Roda a deteccao de batida uma unica vez e devolve dados serializaveis
    (bpm, timestamps, duracao) para guardar no banco (shop_music_bank)."""
    import librosa
    import numpy as np

    y, sr = librosa.load(music_path, sr=None)
    duration = float(librosa.get_duration(y=y, sr=sr))
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    if len(beat_times) < 2:
        beat_times = np.arange(0, duration, 0.5)

    tempo_val = float(tempo) if np.isscalar(tempo) else float(np.ravel(tempo)[0])
    return {
        "bpm": round(tempo_val, 1),
        "duration": round(duration, 2),
        "beat_timestamps": [round(float(t), 3) for t in beat_times],
    }


def extend_beats(beat_timestamps, video_duration):
    """Extrapola os timestamps ja calculados para cobrir a duracao do video,
    mantendo o espacamento medio (usado quando o video e mais longo que a musica)."""
    import numpy as np

    beat_times = np.array(beat_timestamps, dtype=float)
    if len(beat_times) < 2:
        return np.arange(0, video_duration, 0.5)

    diffs = np.diff(beat_times)
    avg_step = float(np.median(diffs)) if len(diffs) > 0 else 0.5
    extended = list(beat_times)
    next_beat = beat_times[-1] + avg_step
    while next_beat < video_duration:
        extended.append(next_beat)
        next_beat += avg_step
    return np.array(extended)


def make_segments(beat_times, video_duration, beats_per_cut):
    cut_points = beat_times[::beats_per_cut]
    cut_points = [float(t) for t in cut_points if t < video_duration]

    segments = []
    start = 0.0
    for cp in cut_points:
        if cp - start > 0.15:
            segments.append((start, cp))
            start = cp
    if video_duration - start > 0.15:
        segments.append((start, video_duration))
    if len(segments) > 1 and segments[-1][1] - segments[-1][0] < 0.3:
        last = segments.pop()
        prev = segments.pop()
        segments.append((prev[0], last[1]))
    return segments


def cut_segments(video_path, segments, workdir):
    paths = []
    for i, (s, e) in enumerate(segments):
        dur = e - s
        out = os.path.join(workdir, f'seg_{i:03d}.mp4')
        run(['ffmpeg', '-y', '-ss', str(s), '-i', video_path, '-t', str(dur),
             '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-an',
             '-avoid_negative_ts', 'make_zero', out])
        paths.append(out)
    return paths


def build_reorder(n, mode, num_blocks):
    if mode == 'sequential':
        return list(range(n))

    if mode == 'blocks':
        blocks_n = max(2, num_blocks)
        block_size = max(1, n // blocks_n)
        blocks = [list(range(i, min(i + block_size, n))) for i in range(0, n, block_size)]
        order = []
        max_len = max(len(b) for b in blocks)
        for i in range(max_len):
            for b in blocks:
                if i < len(b):
                    order.append(b[i])
        return order

    # default: 'half' - metade-com-metade (validado como o corte aprovado)
    half = n // 2
    order = []
    for i in range(half):
        order.append(i)
        order.append(i + half)
    if n % 2 == 1:
        order.append(n - 1)
    return order


def concat_segments(seg_paths, order, workdir):
    concat_path = os.path.join(workdir, 'concat.txt')
    with open(concat_path, 'w') as f:
        for i in order:
            f.write(f"file '{seg_paths[i]}'\n")
    out = os.path.join(workdir, 'video_no_audio.mp4')
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_path, '-c', 'copy', out])
    return out


def mix_audio(video_no_audio, music_path, workdir, total_dur):
    fade_start = max(0, total_dur - 1)
    out = os.path.join(workdir, 'with_audio.mp4')
    run(['ffmpeg', '-y', '-i', video_no_audio, '-i', music_path,
         '-filter_complex', f"[1:a]atrim=0:{total_dur},afade=t=out:st={fade_start}:d=1[a]",
         '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
         '-shortest', out])
    return out


def apply_color_grade(input_path, workdir):
    out = os.path.join(workdir, 'graded.mp4')
    filt = (
        "[0:v]normalize[norm];"
        "[0:v][norm]blend=all_mode=normal:all_opacity=0.8[auto];"
        "[auto]eq=brightness=0.05:contrast=1.07:saturation=0.90[eq];"
        "[eq]curves=master='0/0 0.2/0.17 1/1'[shadow];"
        "[shadow]unsharp=5:5:0.5:5:5:0.0[final]"
    )
    run(['ffmpeg', '-y', '-i', input_path, '-filter_complex', filt,
         '-map', '[final]', '-map', '0:a', '-c:a', 'copy', out])
    return out


def apply_caption(input_path, workdir, caption_text, align):
    """
    Aplica uma legenda (texto + posicao) seguindo as 4 posicoes seguras
    definidas no seletor visual do app: top-center, center-center,
    center-right (com respiro da borda) e bottom-center.
    align = {"v": "top"|"center"|"bottom", "h": "center"|"right"}

    O tamanho da fonte e calculado dinamicamente com base no numero de
    linhas do texto, para textos longos (ex: tabela de tamanhos) nunca
    estourarem a altura do video.

    Nota: a fonte TikTok Sans, assim como a maioria das fontes de texto,
    nao tem desenhos de emoji coloridos - caracteres de emoji no texto
    podem aparecer como uma caixa vazia (tofu) no video.
    """
    if not caption_text:
        return input_path

    caption_text = caption_text.strip()
    if not caption_text:
        return input_path

    v = (align or {}).get('v', 'center')
    h = (align or {}).get('h', 'center')

    # dimensoes reais do video, para calcular o tamanho de fonte que cabe
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
             '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input_path])
    dims = r.stdout.strip().split(',')
    video_width = int(dims[0])
    video_height = int(dims[1])

    lines = caption_text.split('\n')
    content_lines = [ln for ln in lines if ln.strip() != '']
    blank_lines = len(lines) - len(content_lines)
    n_content = max(1, len(content_lines))
    # linhas em branco (separadores entre blocos) ocupam so metade da altura
    # de uma linha de texto normal - nao devem encolher a fonte a toa
    effective_lines = n_content + blank_lines * 0.5

    # orcamento de altura disponivel para o bloco de texto (evita as faixas
    # de UI do TikTok: ~10% topo, ~18% base, ~17% coluna direita)
    max_block_height = video_height * 0.72
    fontsize_by_height = int(max_block_height / effective_lines)

    # orcamento de LARGURA - mede o texto na fonte REAL (nao estimativa),
    # e considera a POSICAO horizontal de verdade: quando alinhado a
    # direita, o texto fica centrado em 76% da largura, entao so sobra
    # ~24% de espaco livre ate a borda - nao os ~68% que usavamos antes
    longest_line = max(content_lines, key=len, default='')
    if longest_line:
        trial_size = 60
        trial_font = ImageFont.truetype(FONT_BOLD, trial_size)
        bbox = trial_font.getbbox(longest_line)
        measured_width_at_trial = max(1, bbox[2] - bbox[0])

        if h == 'right':
            # x = (w*0.76) - (tw/2) -> borda direita = 0.76w + tw/2 <= w -> tw <= 0.48w
            available_width = video_width * 0.44  # com margem de seguranca
        else:
            available_width = video_width * 0.85

        fontsize_by_width = int(trial_size * (available_width / measured_width_at_trial))
    else:
        fontsize_by_width = fontsize_by_height

    # usa o menor dos dois (o que for mais restritivo), com piso/teto
    # proporcionais a altura do video para nunca ficar minusculo nem gigante
    min_fontsize = int(video_height * 0.020)
    max_fontsize = int(video_height * 0.045)
    fontsize = max(min_fontsize, min(max_fontsize, fontsize_by_height, fontsize_by_width))
    # reduz o tamanho final da fonte (pedido explicito - letra grande demais).
    # ajustar esse multiplicador pra mais/menos conforme feedback visual.
    FONT_SCALE = 0.80
    fontsize = max(1, int(fontsize * FONT_SCALE))
    line_spacing = max(4, fontsize // 5)
    # contorno proporcional ao tamanho da fonte - em 2px fixo fica quase
    # invisivel em fontes grandes
    border_width = max(2, fontsize // 10)

    x_map = {
        'center': '(w-tw)/2',
        'right': '(w*0.76)-(tw/2)',
    }
    y_map = {
        'top': 'h*0.12-th/2',
        'center': '(h-th)/2',
        'bottom': 'h*0.80-th/2',
    }
    x_expr = x_map.get(h, '(w-tw)/2')
    y_expr = y_map.get(v, '(h-th)/2')

    text_file = os.path.join(workdir, 'caption.txt')
    with open(text_file, 'w') as f:
        f.write(caption_text)

    filt = (
        f"drawtext=fontfile='{FONT_BOLD}':textfile='{text_file}':"
        f"fontcolor=white:fontsize={fontsize}:line_spacing={line_spacing}:bordercolor=black:borderw={border_width}:"
        f"x={x_expr}:y={y_expr}"
    )

    out = os.path.join(workdir, 'texted.mp4')
    run(['ffmpeg', '-y', '-i', input_path, '-vf', filt, '-c:a', 'copy', out])
    return out


@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})


@app.route('/process', methods=['POST'])
def process():
    """
    Espera multipart/form-data com:
      - video: arquivo de video bruto
      - music: arquivo de audio (banco de musicas)
      - params: JSON string opcional com:
          beats_per_cut (int, default 2)
          reorder_mode ('half' | 'blocks' | 'sequential', default 'half')
          num_blocks (int, default 3, usado só se reorder_mode='blocks')
          color_grade (bool, default true)
          caption_text (string, opcional - texto da legenda)
          caption_align (obj {"v":"top|center|bottom","h":"center|right"}, opcional)
    Retorna o video processado (mp4) como resposta binaria.
    """
    if 'video' not in request.files or 'music' not in request.files:
        return jsonify({"error": "envie os arquivos 'video' e 'music' como multipart/form-data"}), 400

    params = {}
    if 'params' in request.form:
        try:
            params = json.loads(request.form['params'])
        except json.JSONDecodeError:
            return jsonify({"error": "params precisa ser um JSON valido"}), 400

    beats_per_cut = int(params.get('beats_per_cut', 2))
    reorder_mode = params.get('reorder_mode', 'half')
    num_blocks = int(params.get('num_blocks', 3))
    color_grade = bool(params.get('color_grade', True))
    caption_text = params.get('caption_text')
    caption_align = params.get('caption_align')

    workdir = tempfile.mkdtemp(prefix=f"job_{uuid.uuid4().hex[:8]}_")
    try:
        video_path = os.path.join(workdir, 'input_video.mp4')
        music_path = os.path.join(workdir, 'input_music.mp3')
        request.files['video'].save(video_path)
        request.files['music'].save(music_path)

        video_duration = get_duration(video_path)

        music_info = analyze_music(music_path)
        beat_times = extend_beats(music_info["beat_timestamps"], video_duration)
        segments = make_segments(beat_times, video_duration, beats_per_cut)
        n = len(segments)
        if n < 2:
            return jsonify({"error": "poucos segmentos detectados, verifique o audio/video enviados"}), 422

        seg_paths = cut_segments(video_path, segments, workdir)
        order = build_reorder(n, reorder_mode, num_blocks)
        video_no_audio = concat_segments(seg_paths, order, workdir)

        total_dur = sum(e - s for s, e in segments)
        current = mix_audio(video_no_audio, music_path, workdir, total_dur)

        if color_grade:
            current = apply_color_grade(current, workdir)

        if caption_text:
            current = apply_caption(current, workdir, caption_text, caption_align)

        final_out = os.path.join(workdir, 'final.mp4')
        shutil.copy(current, final_out)

        @after_this_request
        def cleanup(response):
            shutil.rmtree(workdir, ignore_errors=True)
            return response

        return send_file(final_out, mimetype='video/mp4', as_attachment=True,
                          download_name='output.mp4')
    except Exception as e:
        shutil.rmtree(workdir, ignore_errors=True)
        return jsonify({"error": str(e)}), 500


def _safe_join(base, *parts):
    """Junta caminhos garantindo que o resultado nao escape do diretorio base
    (protecao contra path traversal em /videos/<path>)."""
    full = os.path.realpath(os.path.join(base, *parts))
    if not full.startswith(os.path.realpath(base) + os.sep) and full != os.path.realpath(base):
        abort(400, "caminho invalido")
    return full


def compress_if_needed(dest, video_id):
    """Comprime o video se passar de ~80MB - video de celular normalmente
    nao precisa de mais que isso para um clipe curto de produto.

    Configuracao pensada para consumir pouca memoria (VPS com RAM limitada
    compartilhada entre varios servicos) - resolucao mais baixa, preset
    ultrafast (usa menos RAM/CPU que 'fast') e threads limitadas."""
    COMPRESS_THRESHOLD_BYTES = 80 * 1024 * 1024
    try:
        original_size = os.path.getsize(dest)
        if original_size > COMPRESS_THRESHOLD_BYTES:
            compressed = os.path.join(RAW_DIR, f"{video_id}_compressed.mp4")
            run(['ffmpeg', '-y', '-i', dest,
                 '-vf', "scale='min(720,iw)':-2",
                 '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
                 '-threads', '2',
                 '-c:a', 'aac', '-b:a', '96k',
                 compressed])
            os.replace(compressed, dest)
    except Exception:
        # se a compressao falhar por qualquer motivo, segue com o arquivo original
        pass


@app.route('/upload-raw', methods=['POST'])
def upload_raw():
    """
    Recebe o video bruto do Sergio (multipart/form-data, campo 'video') e
    guarda no volume persistente. Devolve o path relativo para salvar na
    tabela shop_videos (kind='raw').

    Mantido para arquivos pequenos/compatibilidade - para arquivos grandes
    use /upload-chunk + /upload-complete, que evita o limite de tamanho
    de requisicao unica do proxy.
    """
    if 'video' not in request.files:
        return jsonify({"error": "envie o arquivo 'video' como multipart/form-data"}), 400

    video_id = uuid.uuid4().hex
    filename = f"{video_id}.mp4"
    dest = os.path.join(RAW_DIR, filename)
    request.files['video'].save(dest)

    try:
        duration = get_duration(dest)
    except Exception:
        duration = None

    return jsonify({
        "id": video_id,
        "storage_path": f"raw/{filename}",
        "duration": duration,
    })


CHUNK_TMP_DIR = os.path.join(DATA_DIR, "tmp_uploads")
os.makedirs(CHUNK_TMP_DIR, exist_ok=True)


def _safe_upload_id(upload_id):
    """Garante que upload_id e um hex simples (sem path traversal)."""
    if not upload_id or not all(c in '0123456789abcdefABCDEF' for c in upload_id):
        abort(400, "upload_id invalido")
    return upload_id


@app.route('/upload-chunk', methods=['POST'])
def upload_chunk():
    """
    Recebe um pedaco (chunk) de um upload grande, dividido no navegador.
    Campos esperados (multipart/form-data):
      upload_id (string hex, identifica o upload em andamento)
      chunk_index (int, posicao desse pedaco)
      chunk (arquivo binario, o pedaco em si)
    """
    upload_id = _safe_upload_id(request.form.get('upload_id', ''))
    chunk_index = request.form.get('chunk_index')
    if chunk_index is None or 'chunk' not in request.files:
        return jsonify({"error": "envie upload_id, chunk_index e o arquivo 'chunk'"}), 400

    upload_dir = os.path.join(CHUNK_TMP_DIR, upload_id)
    os.makedirs(upload_dir, exist_ok=True)

    chunk_path = os.path.join(upload_dir, f"chunk_{int(chunk_index):06d}.part")
    request.files['chunk'].save(chunk_path)

    return jsonify({"status": "ok", "chunk_index": int(chunk_index)})


@app.route('/upload-complete', methods=['POST'])
def upload_complete():
    """
    Remonta os pedacos enviados via /upload-chunk num unico arquivo final,
    aplica a mesma compressao/analise do /upload-raw, e devolve a mesma
    resposta (id, storage_path, duration).
    Espera JSON: { "upload_id": "...", "total_chunks": N }
    """
    data = request.get_json(silent=True) or {}
    upload_id = _safe_upload_id(data.get('upload_id', ''))
    total_chunks = data.get('total_chunks')
    if not total_chunks:
        return jsonify({"error": "informe total_chunks"}), 400

    upload_dir = os.path.join(CHUNK_TMP_DIR, upload_id)
    if not os.path.isdir(upload_dir):
        return jsonify({"error": "upload_id nao encontrado"}), 404

    video_id = uuid.uuid4().hex
    filename = f"{video_id}.mp4"
    dest = os.path.join(RAW_DIR, filename)

    try:
        with open(dest, 'wb') as out:
            for i in range(int(total_chunks)):
                chunk_path = os.path.join(upload_dir, f"chunk_{i:06d}.part")
                if not os.path.isfile(chunk_path):
                    raise FileNotFoundError(f"chunk {i} faltando")
                with open(chunk_path, 'rb') as cf:
                    out.write(cf.read())
    except Exception as e:
        return jsonify({"error": f"falha ao remontar arquivo: {e}"}), 500
    finally:
        shutil.rmtree(upload_dir, ignore_errors=True)

    try:
        duration = get_duration(dest)
    except Exception:
        duration = None

    return jsonify({
        "id": video_id,
        "storage_path": f"raw/{filename}",
        "duration": duration,
    })


@app.route('/upload-music', methods=['POST'])
def upload_music():
    """
    Recebe uma musica nova (multipart/form-data, campo 'music'), roda a
    deteccao de batida uma unica vez, guarda o arquivo no volume e devolve
    bpm/timestamps/duracao para salvar na tabela shop_music_bank.
    """
    if 'music' not in request.files:
        return jsonify({"error": "envie o arquivo 'music' como multipart/form-data"}), 400

    music_id = uuid.uuid4().hex
    filename = f"{music_id}.mp3"
    dest = os.path.join(MUSIC_DIR, filename)
    request.files['music'].save(dest)

    try:
        info = analyze_music(dest)
    except Exception as e:
        os.remove(dest)
        return jsonify({"error": f"falha ao analisar audio: {e}"}), 422

    return jsonify({
        "id": music_id,
        "storage_path": f"music/{filename}",
        **info,
    })


def trim_video(video_path, workdir, start_offset, max_duration):
    """Corta o video bruto para o trecho [start_offset, start_offset+max_duration]
    antes de rodar o pipeline de batida - usado para limitar a duracao final
    e permitir que variacoes diferentes comecem em pontos diferentes do video."""
    out = os.path.join(workdir, 'trimmed_input.mp4')
    run(['ffmpeg', '-y', '-ss', str(start_offset), '-i', video_path, '-t', str(max_duration),
         '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
         '-avoid_negative_ts', 'make_zero', out])
    return out


@app.route('/process-stored', methods=['POST'])
def process_stored():
    """
    Gera uma variacao processada a partir de arquivos JA salvos no volume
    (nao envia binario, so referencias) - usado pela automacao em lote.

    Espera JSON:
      raw_video_path (ex: 'raw/abc123.mp4')
      music_path (ex: 'music/def456.mp3')
      beat_timestamps (lista, opcional - se enviado pula a deteccao de novo)
      beats_per_cut, reorder_mode, num_blocks, color_grade,
      caption_text, caption_align  (mesmos parametros de /process)

    Retorna JSON com o storage_path do video processado (nao o binario) -
    o arquivo fica salvo em processed/ e pode ser baixado via GET /videos/<path>.
    """
    data = request.get_json(silent=True) or {}
    raw_video_path = data.get('raw_video_path')
    music_path_rel = data.get('music_path')
    if not raw_video_path or not music_path_rel:
        return jsonify({"error": "informe raw_video_path e music_path"}), 400

    video_path = _safe_join(DATA_DIR, raw_video_path)
    music_path = _safe_join(DATA_DIR, music_path_rel)
    missing = []
    if not os.path.isfile(video_path):
        missing.append({"campo": "raw_video_path", "caminho": raw_video_path})
    if not os.path.isfile(music_path):
        missing.append({"campo": "music_path", "caminho": music_path_rel})
    if missing:
        return jsonify({"error": "arquivo(s) nao encontrado(s) no volume", "faltando": missing}), 404

    beats_per_cut = int(data.get('beats_per_cut', 2))
    reorder_mode = data.get('reorder_mode', 'half')
    num_blocks = int(data.get('num_blocks', 3))
    color_grade = bool(data.get('color_grade', True))
    caption_text = data.get('caption_text')
    caption_align = data.get('caption_align')
    beat_timestamps = data.get('beat_timestamps')
    start_offset = float(data.get('start_offset', 0))
    max_duration = data.get('max_duration')
    max_duration = float(max_duration) if max_duration else None

    workdir = tempfile.mkdtemp(prefix=f"job_{uuid.uuid4().hex[:8]}_")
    try:
        if start_offset > 0 or max_duration:
            effective_duration = max_duration if max_duration else get_duration(video_path) - start_offset
            video_path = trim_video(video_path, workdir, start_offset, effective_duration)

        video_duration = get_duration(video_path)

        if beat_timestamps:
            beat_times = extend_beats(beat_timestamps, video_duration)
        else:
            music_info = analyze_music(music_path)
            beat_times = extend_beats(music_info["beat_timestamps"], video_duration)

        segments = make_segments(beat_times, video_duration, beats_per_cut)
        n = len(segments)
        if n < 2:
            return jsonify({"error": "poucos segmentos detectados"}), 422

        seg_paths = cut_segments(video_path, segments, workdir)
        order = build_reorder(n, reorder_mode, num_blocks)
        video_no_audio = concat_segments(seg_paths, order, workdir)

        total_dur = sum(e - s for s, e in segments)
        current = mix_audio(video_no_audio, music_path, workdir, total_dur)

        if color_grade:
            current = apply_color_grade(current, workdir)
        if caption_text:
            current = apply_caption(current, workdir, caption_text, caption_align)

        out_id = uuid.uuid4().hex
        out_filename = f"{out_id}.mp4"
        out_dest = os.path.join(PROCESSED_DIR, out_filename)
        shutil.copy(current, out_dest)

        # dimensoes reais do video final - pra sempre sabermos o numero
        # verdadeiro, sem precisar adivinhar
        try:
            dim_r = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out_dest])
            dim_parts = dim_r.stdout.strip().split(',')
            out_width, out_height = int(dim_parts[0]), int(dim_parts[1])
        except Exception:
            out_width, out_height = None, None

        return jsonify({
            "id": out_id,
            "storage_path": f"processed/{out_filename}",
            "segments": n,
            "duration": total_dur,
            "width": out_width,
            "height": out_height,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.route('/videos/<path:relpath>', methods=['GET'])
def get_video(relpath):
    """Serve um arquivo do volume (raw/, processed/ ou music/) para
    download, preview, ou upload posterior pro TikTok."""
    full_path = _safe_join(DATA_DIR, relpath)
    if not os.path.isfile(full_path):
        abort(404)
    return send_file(full_path)


@app.route('/videos/<path:relpath>', methods=['DELETE'])
def delete_video(relpath):
    """Remove um arquivo do volume (usado pela automacao de postagem depois
    que um video processado ja foi postado com sucesso - o registro no
    Supabase continua existindo, so o arquivo fisico e apagado)."""
    full_path = _safe_join(DATA_DIR, relpath)
    if not os.path.isfile(full_path):
        return jsonify({"error": "arquivo nao encontrado"}), 404
    os.remove(full_path)
    return jsonify({"status": "deleted", "path": relpath})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)

