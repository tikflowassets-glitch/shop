import os
import json
import shutil
import subprocess
import tempfile
import uuid

from flask import Flask, request, send_file, jsonify, after_this_request

app = Flask(__name__)

FONT_BOLD = "/usr/share/fonts/truetype/poppins/Poppins-Bold.ttf"


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Comando falhou: {' '.join(cmd)}\n{r.stderr}")
    return r


def get_duration(path):
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', path])
    return float(r.stdout.strip())


def detect_beats(music_path, video_duration):
    import librosa
    import numpy as np

    y, sr = librosa.load(music_path, sr=None)
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)

    if len(beat_times) < 2:
        # fallback: batida sintetica a 120bpm se a deteccao falhar
        beat_times = np.arange(0, video_duration, 0.5)

    # extrapola mantendo o tempo constante, caso a deteccao pare antes do fim
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


def apply_text_overlays(input_path, workdir, table_text, center_text):
    filters = []
    text_file = None

    if table_text:
        text_file = os.path.join(workdir, 'overlay_table.txt')
        with open(text_file, 'w') as f:
            f.write(table_text)
        filters.append(
            f"drawtext=fontfile='{FONT_BOLD}':textfile='{text_file}':"
            f"fontcolor=white:fontsize=14:line_spacing=3:bordercolor=black:borderw=2:"
            f"x=w-tw-15:y=h-th-15"
        )

    if center_text:
        safe_text = center_text.replace("'", "\\'").replace(':', '\\:')
        filters.append(
            f"drawtext=fontfile='{FONT_BOLD}':text='{safe_text}':"
            f"fontcolor=white:fontsize=40:bordercolor=black:borderw=3:"
            f"x=(w-tw)/2:y=(h-th)/2"
        )

    if not filters:
        return input_path

    out = os.path.join(workdir, 'texted.mp4')
    run(['ffmpeg', '-y', '-i', input_path, '-vf', ",".join(filters), '-c:a', 'copy', out])
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
          table_text (string multilinha, opcional - tabela tipo tamanhos)
          center_text (string, opcional - texto tipo "COMPRE AGORA")
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
    table_text = params.get('table_text')
    center_text = params.get('center_text')

    workdir = tempfile.mkdtemp(prefix=f"job_{uuid.uuid4().hex[:8]}_")
    try:
        video_path = os.path.join(workdir, 'input_video.mp4')
        music_path = os.path.join(workdir, 'input_music.mp3')
        request.files['video'].save(video_path)
        request.files['music'].save(music_path)

        video_duration = get_duration(video_path)

        beat_times = detect_beats(music_path, video_duration)
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

        if table_text or center_text:
            current = apply_text_overlays(current, workdir, table_text, center_text)

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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
