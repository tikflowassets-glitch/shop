import { useState, useEffect, useMemo } from "react";
import { Upload, Tag, Video, Users, Plus, Check, Trash2, Pencil, Search, Film, ChevronLeft, X } from "lucide-react";
import { supabase } from "./supabaseClient.js";

const PROCESSOR_URL = import.meta.env.VITE_PROCESSOR_URL;

const ALIGN_OPTIONS = [
  { v: "top", h: "center" },
  { v: "center", h: "center" },
  { v: "center", h: "right" },
  { v: "bottom", h: "center" },
];

function alignLabel(a) {
  const vMap = { top: "cima", center: "centro", bottom: "baixo" };
  const hMap = { left: "esquerda", center: "centro", right: "direita" };
  return `${vMap[a.v]} · ${hMap[a.h]}`;
}

const statusMap = {
  pending: { label: "Aguardando", color: "#8a8578", bg: "#efeee9" },
  ready: { label: "Pronto", color: "#6b8a6f", bg: "#eaf0e9" },
  posted: { label: "Postado", color: "#6b7f8a", bg: "#e9eef0" },
  failed: { label: "Falhou", color: "#a3766b", bg: "#f3e9e6" },
};

const C = {
  bg: "#faf9f6",
  card: "#ffffff",
  border: "#e7e4dd",
  text: "#2e2c27",
  sub: "#8a8578",
  accent: "#8b978a",
  accentSoft: "#eef1ec",
  accentText: "#5a6b5c",
};

function PositionPicker({ value, onChange }) {
  const PW = 108;
  const PH = 192;
  const posStyle = {
    "top-center": { top: "22%", left: "50%", transform: "translate(-50%, -50%)" },
    "center-center": { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
    "center-right": { top: "50%", left: "76%", transform: "translate(-50%, -50%)" },
    "bottom-center": { top: "76%", left: "50%", transform: "translate(-50%, -50%)" },
  };

  return (
    <div>
      <div style={{ position: "relative", width: PW, height: PH, borderRadius: 10, background: "#1c1c1a", overflow: "hidden", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "10%", background: "rgba(255,255,255,0.12)" }} />
        <div style={{ position: "absolute", top: "32%", bottom: "8%", right: 0, width: "17%", background: "rgba(255,255,255,0.12)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "18%", background: "rgba(255,255,255,0.16)" }} />

        {ALIGN_OPTIONS.map((opt, i) => {
          const active = value.v === opt.v && value.h === opt.h;
          const key = `${opt.v}-${opt.h}`;
          return (
            <button key={i} onClick={() => onChange(opt)} style={{ position: "absolute", ...posStyle[key] }}>
              <div style={{
                width: 16, height: 16, borderRadius: 5,
                border: active ? "1.5px solid #d9d6cc" : "1.5px solid rgba(255,255,255,0.35)",
                background: active ? "#d9d6cc" : "rgba(255,255,255,0.15)",
                cursor: "pointer",
              }} />
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: C.sub, marginTop: 8, lineHeight: 1.4, maxWidth: PW + 20 }}>
        Áreas mais claras são onde o TikTok já coloca ícones e legenda. As posições disponíveis nunca encostam nelas.
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("upload");
  const [captions, setCaptions] = useState([]);
  const [videos, setVideos] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [music, setMusic] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const [selectedCaptions, setSelectedCaptions] = useState([]);
  const [videoFile, setVideoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [finalizing, setFinalizing] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  // (geracao das variacoes agora roda via workflow do n8n, nao mais no navegador)

  const [captionSearch, setCaptionSearch] = useState("");
  const [editingCaption, setEditingCaption] = useState(null);
  const [capDraft, setCapDraft] = useState("");
  const [capAlign, setCapAlign] = useState({ v: "center", h: "center" });
  const [savingCaption, setSavingCaption] = useState(false);

  const [editingAccount, setEditingAccount] = useState(null);
  const [accDraft, setAccDraft] = useState({ tiktok_username: "", profile_url: "", description: "", status: "active", session_json: "", post_times: [] });
  const [newTimeInput, setNewTimeInput] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  async function loadData() {
    setLoading(true);
    setErrorMsg(null);
    const [capRes, vidRes, accRes, musRes] = await Promise.all([
      supabase.from("shop_captions").select("*").order("created_at", { ascending: false }),
      supabase.from("shop_videos").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("shop_accounts").select("*").order("created_at", { ascending: false }),
      supabase.from("shop_music_bank").select("*").eq("active", true),
    ]);
    if (capRes.error) setErrorMsg(capRes.error.message);
    if (vidRes.error) setErrorMsg(vidRes.error.message);
    if (accRes.error) setErrorMsg(accRes.error.message);
    if (musRes.error) setErrorMsg(musRes.error.message);
    setCaptions(capRes.data || []);
    setVideos(vidRes.data || []);
    setAccounts(accRes.data || []);
    setMusic(musRes.data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredCaptions = useMemo(() => {
    if (!captionSearch.trim()) return captions;
    return captions.filter((c) => c.caption_text.toLowerCase().includes(captionSearch.toLowerCase()));
  }, [captions, captionSearch]);

  function toggleCaption(id) {
    setSelectedCaptions((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  async function handleSend() {
    if (!videoFile || selectedCaptions.length === 0 || !PROCESSOR_URL) return;
    setUploading(true);
    setUploadPercent(0);
    setFinalizing(false);
    setErrorMsg(null);
    try {
      const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB por pedaço
      const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
      const uploadId = crypto.randomUUID().replace(/-/g, "");

      async function uploadChunkWithRetry(chunkBlob, index, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            const chunkForm = new FormData();
            chunkForm.append("upload_id", uploadId);
            chunkForm.append("chunk_index", String(index));
            chunkForm.append("chunk", chunkBlob);
            const res = await fetch(`${PROCESSOR_URL}/upload-chunk`, { method: "POST", body: chunkForm });
            if (!res.ok) throw new Error(`Falha no pedaço ${index} (${res.status})`);
            return;
          } catch (e) {
            if (attempt === retries) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }

      let bytesSent = 0;
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoFile.size);
        const chunkBlob = videoFile.slice(start, end);
        await uploadChunkWithRetry(chunkBlob, i);
        bytesSent += chunkBlob.size;
        setUploadPercent(Math.round((bytesSent / videoFile.size) * 100));
      }

      setFinalizing(true);
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 4 * 60 * 1000); // 4 min
      let completeRes;
      try {
        completeRes = await fetch(`${PROCESSOR_URL}/upload-complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ upload_id: uploadId, total_chunks: totalChunks }),
          signal: timeoutController.signal,
        });
      } catch (e) {
        if (e.name === "AbortError") {
          throw new Error("O servidor demorou demais para responder (mais de 4 min). O vídeo pode ainda ter sido processado com sucesso do lado do servidor — confira na aba Vídeos antes de tentar de novo.");
        }
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
      if (!completeRes.ok) throw new Error(`Falha ao finalizar envio (${completeRes.status})`);
      const uploadData = await completeRes.json();

      const { error: insertError } = await supabase.from("shop_videos").insert({
        kind: "raw",
        storage_path: uploadData.storage_path,
        duration: uploadData.duration,
        caption_ids: selectedCaptions,
        status: "pending",
        uploaded_by: "sergio",
        max_uses: 4,
      });
      if (insertError) throw insertError;

      setUploadDone(true);
      setSuccessMsg(`Vídeo "${videoFile.name}" enviado. As 4 variações serão geradas em breve.`);
      setVideoFile(null);
      setSelectedCaptions([]);
      loadData();
      setTimeout(() => setUploadDone(false), 1800);
    } catch (e) {
      setErrorMsg(e.message);
      setProcessingProgress(null);
    } finally {
      setUploading(false);
      setFinalizing(false);
    }
  }

  function openNewCaption() {
    setEditingCaption("new");
    setCapDraft("");
    setCapAlign({ v: "center", h: "center" });
  }

  function openEditCaption(c) {
    setEditingCaption(c.id);
    setCapDraft(c.caption_text);
    setCapAlign(c.align || { v: "center", h: "center" });
  }

  async function saveCaption() {
    if (!capDraft.trim()) return;
    setSavingCaption(true);
    setErrorMsg(null);
    try {
      if (editingCaption === "new") {
        const { error } = await supabase.from("shop_captions").insert({ caption_text: capDraft.trim(), align: capAlign });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shop_captions").update({ caption_text: capDraft.trim(), align: capAlign }).eq("id", editingCaption);
        if (error) throw error;
      }
      setEditingCaption(null);
      loadData();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSavingCaption(false);
    }
  }

  async function deleteCaption(id) {
    const { error } = await supabase.from("shop_captions").delete().eq("id", id);
    if (error) setErrorMsg(error.message);
    else loadData();
  }

  function openNewAccount() {
    setEditingAccount("new");
    setAccDraft({ tiktok_username: "", profile_url: "", description: "", status: "active", session_json: "", post_times: [] });
    setNewTimeInput("");
  }

  async function openEditAccount(a) {
    setEditingAccount(a.id);
    setNewTimeInput("");
    // busca a versao mais recente direto do banco, nunca confia no estado local
    // (evita reenviar uma credencial desatualizada por engano)
    const { data, error } = await supabase.from("shop_accounts").select("*").eq("id", a.id).single();
    const fresh = error ? a : data;
    setAccDraft({
      tiktok_username: fresh.tiktok_username || "",
      profile_url: fresh.profile_url || "",
      description: fresh.description || "",
      status: fresh.status || "active",
      session_json: fresh.session_json
        ? (typeof fresh.session_json === "string" ? fresh.session_json : JSON.stringify(fresh.session_json, null, 2))
        : "",
      post_times: fresh.post_times || [],
    });
  }

  async function addPostTime() {
    if (!newTimeInput || editingAccount === "new") {
      // conta nova ainda nao existe no banco - so mexe no estado local, salva junto no "Salvar conta"
      if (newTimeInput && !accDraft.post_times.includes(newTimeInput)) {
        setAccDraft((d) => ({ ...d, post_times: [...d.post_times, newTimeInput].sort() }));
      }
      setNewTimeInput("");
      return;
    }
    if (accDraft.post_times.includes(newTimeInput)) return;
    const updated = [...accDraft.post_times, newTimeInput].sort();
    setAccDraft((d) => ({ ...d, post_times: updated }));
    setNewTimeInput("");
    const { error } = await supabase.from("shop_accounts").update({ post_times: updated }).eq("id", editingAccount);
    if (error) setErrorMsg(error.message);
  }

  async function removePostTime(time) {
    const updated = accDraft.post_times.filter((t) => t !== time);
    setAccDraft((d) => ({ ...d, post_times: updated }));
    if (editingAccount === "new") return;
    const { error } = await supabase.from("shop_accounts").update({ post_times: updated }).eq("id", editingAccount);
    if (error) setErrorMsg(error.message);
  }

  async function saveAccount() {
    if (!accDraft.tiktok_username.trim()) return;
    setSavingAccount(true);
    setErrorMsg(null);
    try {
      // IMPORTANTE: nao faz JSON.parse aqui. O node do TikTok espera uma STRING
      // cujo conteudo e o texto JSON (nao o objeto ja interpretado). Salva exatamente
      // o texto que esta na caixa, sem converter - preserva o formato entre edicoes.
      const payload = {
        tiktok_username: accDraft.tiktok_username.trim(),
        profile_url: accDraft.profile_url.trim(),
        description: accDraft.description.trim(),
        status: accDraft.status,
        session_json: accDraft.session_json,
        post_times: accDraft.post_times,
      };
      if (editingAccount === "new") {
        const { error } = await supabase.from("shop_accounts").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shop_accounts").update(payload).eq("id", editingAccount);
        if (error) throw error;
      }
      setEditingAccount(null);
      loadData();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount(id) {
    const { error } = await supabase.from("shop_accounts").delete().eq("id", id);
    if (error) setErrorMsg(error.message);
    else loadData();
  }

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", fontFamily: "system-ui, sans-serif", background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column", color: C.text }}>
      <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Film size={14} color={C.accentText} strokeWidth={2} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>TikFlow Shop</span>
        </div>
      </div>

      {successMsg && (
        <div style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 8, background: "#eaf0e9", color: "#6b8a6f", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>✓ {successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2, flexShrink: 0 }}>
            <X size={14} color="#6b8a6f" />
          </button>
        </div>
      )}
      {errorMsg && (
        <div style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 8, background: "#f3e9e6", color: "#a3766b", fontSize: 12 }}>
          {errorMsg}
        </div>
      )}
      {!PROCESSOR_URL && (
        <div style={{ margin: "12px 20px 0", padding: "10px 12px", borderRadius: 8, background: "#faeeda", color: "#854f0b", fontSize: 12 }}>
          VITE_PROCESSOR_URL não configurada — envio de vídeo desativado até configurar.
        </div>
      )}

      <div style={{ flex: 1, padding: 20 }}>
        {loading ? (
          <p style={{ fontSize: 13, color: C.sub }}>Carregando...</p>
        ) : (
          <>
            {tab === "upload" && (
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 3px" }}>Enviar vídeo</h2>
                <p style={{ fontSize: 12.5, color: C.sub, margin: "0 0 18px" }}>Cada vídeo bruto gera 4 variações automaticamente.</p>

                <input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} style={{ display: "none" }} id="fileInput" />
                <label
                  htmlFor="fileInput"
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 6, padding: "24px 16px", borderRadius: 12,
                    border: videoFile ? `1.5px solid ${C.accent}` : `1.5px dashed ${C.border}`,
                    background: videoFile ? C.accentSoft : "transparent", cursor: "pointer", marginBottom: 18,
                  }}
                >
                  <Upload size={19} color={videoFile ? C.accentText : "#b5b1a6"} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: videoFile ? C.accentText : C.sub, textAlign: "center", wordBreak: "break-all" }}>
                    {videoFile ? videoFile.name : "Toque para escolher o vídeo"}
                  </span>
                </label>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Legendas ({selectedCaptions.length}/4)</span>
                </div>
                <div style={{ position: "relative", marginBottom: 10 }}>
                  <Search size={13} color={C.sub} style={{ position: "absolute", left: 10, top: 10 }} />
                  <input
                    value={captionSearch}
                    onChange={(e) => setCaptionSearch(e.target.value)}
                    placeholder="Buscar legenda..."
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 30px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, fontSize: 12.5, outline: "none", color: C.text }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22, maxHeight: 220, overflowY: "auto" }}>
                  {filteredCaptions.length === 0 && <p style={{ fontSize: 12, color: C.sub }}>Nenhuma legenda cadastrada ainda.</p>}
                  {filteredCaptions.map((c) => {
                    const active = selectedCaptions.includes(c.id);
                    const disabled = !active && selectedCaptions.length >= 4;
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleCaption(c.id)}
                        disabled={disabled}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                          padding: "10px 12px", borderRadius: 10,
                          border: active ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                          background: active ? C.accentSoft : C.card,
                          opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <div style={{ width: 16, height: 16, borderRadius: 5, flexShrink: 0, border: active ? "none" : `1.5px solid ${C.border}`, background: active ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {active && <Check size={10} color="#fff" strokeWidth={3} />}
                        </div>
                        <div style={{ fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.caption_text.split("\n")[0]}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {uploading && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.accentText }}>
                        {finalizing ? "Finalizando no servidor (juntando e comprimindo)..." : `Enviando vídeo... ${uploadPercent}%`}
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 6, borderRadius: 10, background: C.border, overflow: "hidden" }}>
                      <div style={{
                        width: `${uploadPercent}%`,
                        height: "100%", background: C.accent, borderRadius: 10, transition: "width 0.2s ease",
                      }} />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSend}
                  disabled={!videoFile || selectedCaptions.length === 0 || uploading || !PROCESSOR_URL}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 10, border: "none",
                    background: !videoFile || selectedCaptions.length === 0 || uploading || !PROCESSOR_URL ? "#e7e4dd" : C.accent,
                    color: !videoFile || selectedCaptions.length === 0 || uploading || !PROCESSOR_URL ? "#a8a498" : "#fff",
                    fontSize: 13, fontWeight: 600, cursor: !videoFile || selectedCaptions.length === 0 || uploading ? "not-allowed" : "pointer",
                  }}
                >
                  {finalizing ? "Finalizando..." : uploading ? `Enviando... ${uploadPercent}%` : uploadDone ? "Enviado!" : "Enviar vídeo"}
                </button>
              </div>
            )}

            {tab === "captions" && !editingCaption && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Legendas</h2>
                  <button onClick={openNewCaption} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.accentText, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    <Plus size={14} /> Nova
                  </button>
                </div>
                <p style={{ fontSize: 12.5, color: C.sub, margin: "0 0 14px" }}>{captions.length} cadastradas</p>

                <div style={{ position: "relative", marginBottom: 14 }}>
                  <Search size={13} color={C.sub} style={{ position: "absolute", left: 10, top: 10 }} />
                  <input
                    value={captionSearch}
                    onChange={(e) => setCaptionSearch(e.target.value)}
                    placeholder="Buscar legenda..."
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 30px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, fontSize: 12.5, outline: "none", color: C.text }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredCaptions.map((c) => (
                    <div key={c.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, padding: 12, display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: C.text, whiteSpace: "pre-line", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{c.caption_text}</div>
                        <div style={{ fontSize: 10.5, color: C.sub, marginTop: 4 }}>{c.align ? alignLabel(c.align) : "centro · centro"}</div>
                      </div>
                      <button onClick={() => openEditCaption(c)} style={{ background: C.accentSoft, border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <Pencil size={12} color={C.accentText} />
                      </button>
                      <button onClick={() => deleteCaption(c.id)} style={{ background: "#f3e9e6", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <Trash2 size={12} color="#a3766b" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "captions" && editingCaption && (
              <div>
                <button onClick={() => setEditingCaption(null)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.sub, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 14, padding: 0 }}>
                  <ChevronLeft size={15} /> Voltar
                </button>
                <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 16px" }}>{editingCaption === "new" ? "Nova legenda" : "Editar legenda"}</h2>

                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Texto</div>
                <textarea
                  value={capDraft}
                  onChange={(e) => setCapDraft(e.target.value)}
                  rows={5}
                  placeholder="Texto que aparece sobreposto no vídeo"
                  style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 12.5, outline: "none", resize: "vertical", fontFamily: "inherit", marginBottom: 18 }}
                />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Posição na tela</span>
                  <span style={{ fontSize: 11, color: C.accentText, fontWeight: 600 }}>{alignLabel(capAlign)}</span>
                </div>
                <div style={{ marginBottom: 22 }}>
                  <PositionPicker value={capAlign} onChange={setCapAlign} />
                </div>

                <button
                  onClick={saveCaption}
                  disabled={!capDraft.trim() || savingCaption}
                  style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: !capDraft.trim() || savingCaption ? "#e7e4dd" : C.accent, color: !capDraft.trim() || savingCaption ? "#a8a498" : "#fff", fontSize: 13, fontWeight: 600, cursor: !capDraft.trim() || savingCaption ? "not-allowed" : "pointer" }}
                >
                  {savingCaption ? "Salvando..." : "Salvar legenda"}
                </button>
              </div>
            )}

            {tab === "accounts" && !editingAccount && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Contas</h2>
                  <button onClick={openNewAccount} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.accentText, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    <Plus size={14} /> Nova
                  </button>
                </div>
                <p style={{ fontSize: 12.5, color: C.sub, margin: "0 0 14px" }}>{accounts.length} cadastradas</p>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {accounts.length === 0 && <p style={{ fontSize: 12, color: C.sub }}>Nenhuma conta cadastrada ainda.</p>}
                  {accounts.map((a) => (
                    <div key={a.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, padding: 12, display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.tiktok_username}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 10, background: a.status === "active" ? "#eaf0e9" : "#efeee9", color: a.status === "active" ? "#6b8a6f" : C.sub }}>
                            {a.status === "active" ? "ativa" : "pausada"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{a.description ? `"${a.description}"` : "sem descrição definida"}</div>
                        <div style={{ fontSize: 10.5, color: C.sub, marginTop: 3 }}>{(a.post_times || []).length} horários · última programada: {a.last_scheduled_at ? new Date(a.last_scheduled_at).toLocaleDateString("pt-BR") : "-"}</div>
                      </div>
                      <button onClick={() => openEditAccount(a)} style={{ background: C.accentSoft, border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <Pencil size={12} color={C.accentText} />
                      </button>
                      <button onClick={() => deleteAccount(a.id)} style={{ background: "#f3e9e6", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                        <Trash2 size={12} color="#a3766b" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "accounts" && editingAccount && (
              <div>
                <button onClick={() => setEditingAccount(null)} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: C.sub, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 14, padding: 0 }}>
                  <ChevronLeft size={15} /> Voltar
                </button>
                <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 16px" }}>{editingAccount === "new" ? "Nova conta" : "Editar conta"}</h2>

                {[
                  { key: "tiktok_username", label: "Usuário TikTok", placeholder: "@usuario" },
                  { key: "profile_url", label: "Link do perfil", placeholder: "https://tiktok.com/@usuario" },
                ].map((f) => (
                  <div key={f.key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{f.label}</div>
                    <input
                      value={accDraft[f.key]}
                      onChange={(e) => setAccDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 12.5, outline: "none" }}
                    />
                  </div>
                ))}

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Descrição do vídeo</div>
                  <input
                    value={accDraft.description}
                    onChange={(e) => setAccDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="texto que vai na descrição de cada post"
                    style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 12.5, outline: "none" }}
                  />
                  <div style={{ fontSize: 10.5, color: C.sub, marginTop: 5 }}>Usada em todo post feito por essa conta. Mudou aqui, muda em todos os próximos.</div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Credencial (JSON)</div>
                  <textarea
                    value={accDraft.session_json}
                    onChange={(e) => setAccDraft((d) => ({ ...d, session_json: e.target.value }))}
                    placeholder='{"cookies": [...], "token": "..."}'
                    rows={8}
                    style={{ width: "100%", boxSizing: "border-box", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 11.5, outline: "none", resize: "vertical", fontFamily: "ui-monospace, monospace", lineHeight: 1.5 }}
                  />
                  <div style={{ fontSize: 10.5, color: C.sub, marginTop: 5 }}>Cookies, tokens ou dados de sessão usados para postar sem login manual.</div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Horários de postagem ({accDraft.post_times.length})</div>
                  <div style={{ fontSize: 10.5, color: C.sub, marginBottom: 10 }}>Um horário por postagem do dia. Se são 20 posts, adicione 20 horários.</div>

                  {accDraft.post_times.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {accDraft.post_times.map((t) => (
                        <div key={t} style={{ display: "flex", alignItems: "center", gap: 5, background: C.accentSoft, borderRadius: 8, padding: "5px 6px 5px 10px" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.accentText }}>{t}</span>
                          <button onClick={() => removePostTime(t)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}>
                            <X size={11} color={C.accentText} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="time"
                      value={newTimeInput}
                      onChange={(e) => setNewTimeInput(e.target.value)}
                      style={{ flex: 1, boxSizing: "border-box", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", color: C.text, fontSize: 12.5, outline: "none" }}
                    />
                    <button
                      onClick={addPostTime}
                      disabled={!newTimeInput}
                      style={{ padding: "0 14px", borderRadius: 10, border: "none", background: !newTimeInput ? "#e7e4dd" : C.accent, color: !newTimeInput ? "#a8a498" : "#fff", fontSize: 12.5, fontWeight: 600, cursor: !newTimeInput ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Plus size={13} /> Add
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Status</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
                  {["active", "paused"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setAccDraft((d) => ({ ...d, status: s }))}
                      style={{
                        flex: 1, padding: "9px", borderRadius: 8, cursor: "pointer",
                        border: accDraft.status === s ? `1.5px solid ${C.accent}` : `1px solid ${C.border}`,
                        background: accDraft.status === s ? C.accentSoft : C.card,
                        color: accDraft.status === s ? C.accentText : C.sub, fontSize: 12, fontWeight: 600,
                      }}
                    >
                      {s === "active" ? "Ativa" : "Pausada"}
                    </button>
                  ))}
                </div>

                <button
                  onClick={saveAccount}
                  disabled={!accDraft.tiktok_username.trim() || savingAccount}
                  style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: !accDraft.tiktok_username.trim() || savingAccount ? "#e7e4dd" : C.accent, color: !accDraft.tiktok_username.trim() || savingAccount ? "#a8a498" : "#fff", fontSize: 13, fontWeight: 600, cursor: !accDraft.tiktok_username.trim() || savingAccount ? "not-allowed" : "pointer" }}
                >
                  {savingAccount ? "Salvando..." : "Salvar conta"}
                </button>
              </div>
            )}

            {tab === "videos" && (
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 3px" }}>Meus vídeos</h2>
                <p style={{ fontSize: 12.5, color: C.sub, margin: "0 0 16px" }}>Resumo de tudo que já foi processado.</p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
                  {[
                    { label: "Prontos p/ postar", count: videos.filter((v) => v.kind === "processed" && v.status === "ready").length, color: "#6b8a6f", bg: "#eaf0e9" },
                    { label: "Postados", count: videos.filter((v) => v.status === "posted").length, color: "#6b7f8a", bg: "#e9eef0" },
                    { label: "Falharam", count: videos.filter((v) => v.status === "failed").length, color: "#a3766b", bg: "#f3e9e6" },
                  ].map((s) => (
                    <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "10px 10px" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 10, color: s.color, marginTop: 2, lineHeight: 1.3 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {videos.length === 0 && <p style={{ fontSize: 12, color: C.sub }}>Nenhum vídeo enviado ainda.</p>}
                  {videos.map((v) => {
                    const s = statusMap[v.status] || statusMap.pending;
                    return (
                      <div key={v.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Video size={14} color={C.accentText} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.storage_path?.split("/").pop() || v.id}</div>
                          <div style={{ fontSize: 10.5, color: C.sub }}>{v.times_used || 0}/{v.max_uses || 4} variações · {new Date(v.created_at).toLocaleDateString("pt-BR")}</div>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: s.bg, color: s.color, flexShrink: 0 }}>
                          {s.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, background: C.card, position: "sticky", bottom: 0 }}>
        {[
          { id: "upload", label: "Enviar", icon: Upload },
          { id: "captions", label: "Legendas", icon: Tag },
          { id: "accounts", label: "Contas", icon: Users },
          { id: "videos", label: "Vídeos", icon: Video },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setEditingCaption(null); setEditingAccount(null); }}
              style={{ flex: 1, padding: "11px 0", background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", color: active ? C.accentText : "#b5b1a6" }}
            >
              <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ fontSize: 9.5, fontWeight: active ? 700 : 500 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
