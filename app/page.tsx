"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./sky.module.css";
import { createClient } from "@/app/lib/browser";

type CaptionRow = {
  id: string;
  content: string;
  like_count?: number | null;
  created_datetime_utc?: string | null;
  is_public?: boolean | null;

  image_id?: string | null;
  images?: { url: string | null }[] | null;
};

type BirdState = {
  id: string;
  lane: number; // vertical lane index
  size: number; // scale
  duration: number; // seconds
  delay: number; // seconds
  captionIndex: number; // index into selectedCaptions
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pickTopCaptions(rows: CaptionRow[]) {
  const withImg = rows.filter((r: any) => {
    const rel = (r as any).images;
    const url = Array.isArray(rel) ? rel?.[0]?.url : rel?.url;
    return typeof url === "string" && url.length > 0;
  });

  const withoutImg = rows.filter((r) => !withImg.includes(r));

  // Keep your "best" sorting but prefer ones with images first
  const sortedWithImg = [...withImg].sort(
    (a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)
  );

  const sortedWithoutImg = [...withoutImg].sort(
    (a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)
  );

  return [...sortedWithImg, ...sortedWithoutImg].slice(0, 80);
}

function BirdSVG() {
  return (
    <svg
      viewBox="0 0 64 32"
      aria-hidden="true"
      className={styles.birdSvg}
    >
      <path d="M2 18c8-10 18-10 30 0 6-8 14-14 30-10-10 0-18 6-24 14-8-10-14-14-36-4z" />
    </svg>
  );
}

function seededUnit(str: string) {
    // deterministic 0..1 based on string (stable on server + client)
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // convert to 0..1
    return ((h >>> 0) % 10000) / 10000;
  }  

export default function ListPage() {
  const [rows, setRows] = useState<CaptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [supabase] = useState(() => createClient());

  // Auth + voting UI state
  const [userId, setUserId] = useState<string | null>(null);
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState("/");
  const [hoveredBirdId, setHoveredBirdId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [generatedCaptions, setGeneratedCaptions] = useState<any[]>([]);
  const [pipelineBusy, setPipelineBusy] = useState(false);

  useEffect(() => {
    setRedirectTo(window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    let ignore = false;
  
    // 1) initial user
    supabase.auth.getUser().then(({ data }) => {
      if (ignore) return;
      setUserId(data?.user?.id ?? null);
    });
  
    // 2) keep userId updated after login/logout
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
  
    return () => {
      ignore = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function submitVote(captionId: string, voteValue: number) {
    if (!userId) {
      setToast("Log in to vote.");
      return;
    }

    // prevent spam clicks
    setVoting((m) => ({ ...m, [captionId]: true }));
    setToast(null);

    const { error } = await supabase.from("caption_votes").insert({
      caption_id: captionId,
      profile_id: userId,
      vote_value: voteValue,
      created_datetime_utc: new Date().toISOString(),
    });

    if (error) {
      // unique constraint => already voted
      if (String(error.code) === "23505") {
        setToast("You already voted on this caption.");
      } else {
        setToast(`Vote failed: ${error.message}`);
      }
      setVoting((m) => ({ ...m, [captionId]: false }));
      return;
    }

    setVoted((m) => ({ ...m, [captionId]: true }));
    setToast(voteValue === 1 ? "Upvoted ✅" : "Downvoted ✅");
    setVoting((m) => ({ ...m, [captionId]: false }));
  }

  function onPickFile(f: File | null) {
    setFile(f);
    setGeneratedCaptions([]);
    setPipelineStatus(null);
  
    if (!f) {
      setPreviewUrl(null);
      return;
    }
  
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
  }

  async function runCaptionPipeline() {
    if (!userId) {
      setToast("Log in to upload & generate captions.");
      return;
    }
    if (!file) {
      setToast("Pick an image first.");
      return;
    }
  
    const allowed = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
    ]);
  
    if (!allowed.has(file.type)) {
      setToast(`Unsupported file type: ${file.type}`);
      return;
    }
  
    setPipelineBusy(true);
    setToast(null);
    setGeneratedCaptions([]);
    setPipelineStatus("1/4 Requesting upload URL…");
  
    try {
      // 0) Get JWT from Supabase session
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;
  
      const token = sessionData.session?.access_token;
      if (!token) {
        setToast("No access token. Please log in again.");
        return;
      }
  
      const base = "https://api.almostcrackd.ai";
  
      // 1) Presigned URL
      const presignedRes = await fetch(`${base}/pipeline/generate-presigned-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contentType: file.type }),
      });
  
      if (!presignedRes.ok) {
        const text = await presignedRes.text();
        throw new Error(`Presigned URL failed: ${presignedRes.status} ${text}`);
      }
  
      const { presignedUrl, cdnUrl } = await presignedRes.json();
  
      if (!presignedUrl || !cdnUrl) {
        throw new Error("Missing presignedUrl/cdnUrl from API.");
      }
  
      // 2) Upload bytes to S3 (PUT to presignedUrl)
      setPipelineStatus("2/4 Uploading image bytes…");
  
      const uploadRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });
  
      if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new Error(`Upload failed: ${uploadRes.status} ${text}`);
      }
  
      // 3) Register image URL
      setPipelineStatus("3/4 Registering image…");
  
      const registerRes = await fetch(`${base}/pipeline/upload-image-from-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageUrl: cdnUrl, isCommonUse: false }),
      });
  
      if (!registerRes.ok) {
        const text = await registerRes.text();
        throw new Error(`Register failed: ${registerRes.status} ${text}`);
      }
  
      const { imageId } = await registerRes.json();
      if (!imageId) throw new Error("Missing imageId from register step.");
  
      // 4) Generate captions
      setPipelineStatus("4/4 Generating captions…");
  
      const captionsRes = await fetch(`${base}/pipeline/generate-captions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      });
  
      if (!captionsRes.ok) {
        const text = await captionsRes.text();
        throw new Error(`Caption generation failed: ${captionsRes.status} ${text}`);
      }
  
      const captions = await captionsRes.json();
      setGeneratedCaptions(Array.isArray(captions) ? captions : []);
      setPipelineStatus("Done ✅");
      setToast("Captions generated ✅");
    } catch (e: any) {
      setPipelineStatus(null);
      setToast(e?.message ? `Pipeline error: ${e.message}` : "Pipeline error");
    } finally {
      setPipelineBusy(false);
    }
  }

  // UI controls (optional but makes it feel like a real product)
  const [showCount, setShowCount] = useState(10);
  const [speed, setSpeed] = useState(1); // 1 = normal, <1 slower, >1 faster

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
  
      // Pull captions + joined image url
      const { data, error } = await supabase
        .from("captions")
        .select(`
          id,
          content,
          like_count,
          created_datetime_utc,
          is_public,
          image_id,
          images ( url )
        `)
        .order("created_datetime_utc", { ascending: false })
        .limit(500);
  
      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        const cleaned = (data ?? []).filter(
          (r: any) =>
            typeof r.content === "string" &&
            r.content.trim().length > 0
        );
  
        setRows(cleaned as CaptionRow[]);
      }
  
      setLoading(false);
    };
  
    load();
  }, [supabase]);

  const selectedCaptions = useMemo(() => {
    const tops = pickTopCaptions(rows);
    // Safety: ensure we always have something
    return tops.length ? tops : rows;
  }, [rows]);

  const birds = useMemo<BirdState[]>(() => {
    // Generate stable set of birds (re-generated if showCount changes)
    const count = clamp(showCount, 3, 20);
    const lanes = 11; // vertical lanes across the sky
    const out: BirdState[] = [];

    for (let i = 0; i < count; i++) {
      const lane = i % lanes;
      const size = 0.75 + (i % 5) * 0.12; // 0.75..1.23
      const base = 14 + (i % 6) * 2.2; // seconds
      const duration = base / speed;
      const delay = (i % 7) * 1.1; // stagger entry
      out.push({
        id: `bird-${i}`,
        lane,
        size,
        duration,
        delay,
        captionIndex: i % Math.max(selectedCaptions.length, 1),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCount, speed, selectedCaptions.length]);

  // Rotate captions so birds “pick up” a new caption every few seconds
  const [birdCaptions, setBirdCaptions] = useState<BirdState[]>(birds);

  useEffect(() => {
    setBirdCaptions(birds);
  }, [birds]);

  useEffect(() => {
    if (!selectedCaptions.length) return;
  
    const interval = setInterval(() => {
      setBirdCaptions((prev) =>
        prev.map((b, idx) => {
          // ✅ Don't rotate caption if user is hovering this bird
          if (hoveredBirdId && b.id === hoveredBirdId) return b;
  
          const step = 1 + (idx % 3); // 1..3
          return {
            ...b,
            captionIndex: (b.captionIndex + step) % selectedCaptions.length,
          };
        })
      );
    }, 9000);
  
    return () => clearInterval(interval);
  }, [selectedCaptions.length, hoveredBirdId]);

  return (
    <main className={styles.sky}>
      {toast && <div className={styles.toast}>{toast}</div>}
      {/* Background layers */}
      <div className={styles.sun} />
      <div className={styles.cloudLayer}>
        <div className={`${styles.cloud} ${styles.cloud1}`} />
        <div className={`${styles.cloud} ${styles.cloud2}`} />
        <div className={`${styles.cloud} ${styles.cloud3}`} />
      </div>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.badge}>☁️</div>
          <div>
            <h1 className={styles.title}>The Humor Project. Caption Sky</h1>
            <p className={styles.subtitle}>
            Watch real Humor Project captions drift across the sky like passing thoughts.
            </p>
          </div>
        </div>

        <div className={styles.controls}>
          <label className={styles.control}>
            Birds
            <input
              type="range"
              min={3}
              max={20}
              value={showCount}
              onChange={(e) => setShowCount(Number(e.target.value))}
            />
            <span className={styles.controlValue}>{showCount}</span>
          </label>

          <label className={styles.control}>
            Speed
            <input
              type="range"
              min={0.6}
              max={1.8}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className={styles.controlValue}>{speed.toFixed(1)}x</span>
          </label>
        </div>
        <div style={{ marginLeft: "12px" }}>
          {!userId ? (
            <a className={styles.authBtn} href="/login">
              Log in
            </a>
          ) : (
            <button
              className={styles.logoutBtn}
              onClick={async () => {
                await supabase.auth.signOut();
                setToast("Logged out");
              }}
            >
              Log out
            </button>
          )}
        </div>
      </header>

      {/* Status */}
      <section className={styles.status}>
        {loading && <p className={styles.pill}>Loading captions…</p>}
        {error && <p className={`${styles.pill} ${styles.pillError}`}>Error: {error}</p>}
        {!loading && !error && (
          <p className={styles.pill}>
            Connected ✅ Showing {selectedCaptions.length} “best” captions
          </p>
        )}
      </section>

      {/* Upload / Pipeline Panel (Assignment 5) */}
      <section className={styles.uploaderPanel} aria-label="Upload image and generate captions">
        <div className={styles.uploaderHeader}>
          <h2 className={styles.uploaderTitle}>Upload an image</h2>

          {pipelineStatus && <span className={styles.statusChip}>{pipelineStatus}</span>}
          {!userId && <span className={styles.statusChip}>Log in to upload & generate</span>}
        </div>

        <div className={styles.uploaderControls}>
          <label className={styles.fileLabel}>
            <input
              className={styles.fileInput}
              type="file"
              accept="image/*"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <span className={styles.fileButton}>Choose file</span>
            <span className={styles.fileName}>{file ? file.name : "No file chosen"}</span>
          </label>

          <button
            className={styles.primaryBtn}
            onClick={runCaptionPipeline}
            disabled={!userId || !file || pipelineBusy}
            title={!userId ? "Log in to use the API" : !file ? "Pick an image" : "Generate captions"}
          >
            {pipelineBusy ? "Working…" : "Generate captions"}
          </button>
        </div>

        {previewUrl && (
          <div className={styles.previewWrap}>
            <img src={previewUrl} alt="preview" className={styles.previewImg} />
          </div>
        )}

        {generatedCaptions.length > 0 && (
          <div className={styles.generatedPanel}>
            <h3 className={styles.generatedTitle}>Generated captions</h3>
            <ul className={styles.generatedList}>
              {generatedCaptions.slice(0, 12).map((c: any, idx: number) => (
                <li key={c?.id ?? idx} className={styles.generatedItem}>
                  {c?.content ?? c?.caption ?? JSON.stringify(c)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Birds */}
      <section className={styles.flightZone} aria-label="Flying captions">
        {birdCaptions.map((b) => {
          const cap = selectedCaptions[b.captionIndex];
          const content = cap?.content ?? "…";
          const imagesAny = (cap as any)?.images;
          const imageUrl =
            (Array.isArray(imagesAny) ? imagesAny?.[0]?.url : imagesAny?.url) ?? null;

          // Lanes are spaced vertically; add slight randomness with offset
          const topPct = 12 + b.lane * 8.5; // 14%, 24%, 34%...
          const r = seededUnit(`${b.id}-${b.lane}`); // 0..1 stable
          const jitter = r * 10 - 5; // -5..+5
          const laneBase = b.lane % 2 === 0 ? -8 : 8;
          const xShift = laneBase + jitter;          
          const styleVars = {
            ["--laneTop" as any]: `${topPct}%`,
            ["--dur" as any]: `${b.duration}s`,
            ["--delay" as any]: `${b.delay}s`,
            ["--scale" as any]: `${b.size}`,
            ["--xShift" as any]: `${xShift}vw`,
          };          

          return (
            <div
              key={b.id}
              className={styles.bird}
              style={styleVars}
              onMouseEnter={() => setHoveredBirdId(b.id)}
              onMouseLeave={() => setHoveredBirdId((cur) => (cur === b.id ? null : cur))}
              onFocus={() => setHoveredBirdId(b.id)}
              onBlur={() => setHoveredBirdId((cur) => (cur === b.id ? null : cur))}
            >
              <div className={styles.birdWrap}>
                <BirdSVG />
                <div className={styles.bubble}>
                  <div className={styles.bubbleInner}>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt="caption image"
                        className={styles.captionImg}
                      />
                    )}

                    <div className={styles.captionText}>{content}</div>
                  </div>

                  <div className={styles.voteRow}>
                    <button
                      className={styles.voteBtn}
                      disabled={!userId || voting[cap?.id ?? ""] || voted[cap?.id ?? ""] || !cap?.id}
                      onClick={() => cap?.id && submitVote(cap.id, 1)}
                      title={!userId ? "Log in to vote" : "Upvote"}
                    >
                      👍
                    </button>

                    <button
                      className={styles.voteBtn}
                      disabled={!userId || voting[cap?.id ?? ""] || voted[cap?.id ?? ""] || !cap?.id}
                      onClick={() => cap?.id && submitVote(cap.id, -1)}
                      title={!userId ? "Log in to vote" : "Downvote"}
                    >
                      👎
                    </button>

                    {!userId && <span className={styles.voteHint}>Log in to vote</span>}
                    {cap?.id && voted[cap.id] && <span className={styles.votedTag}>Voted</span>}
                  </div>

                  <div className={styles.bubbleTail} />
                </div>
              </div>
            </div>
          );
        })}
      </section>

    </main>
  );
}
