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
  // Prefer "best" by like_count if it exists; fallback to recent-ish.
  const withLikes = rows.filter((r) => typeof r.like_count === "number");
  if (withLikes.length >= 10) {
    return [...rows]
      .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
      .slice(0, 80);
  }

  // Otherwise just take a decent chunk (still looks good)
  return rows.slice(0, 80);
}

function BirdSVG() {
  // Simple bird silhouette (works great for “flying” effect)
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

  const supabase = createClient();

  // UI controls (optional but makes it feel like a real product)
  const [showCount, setShowCount] = useState(10);
  const [speed, setSpeed] = useState(1); // 1 = normal, <1 slower, >1 faster

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      // Pull from captions table
      const { data, error } = await supabase
        .from("captions")
        .select("id, content, like_count, created_datetime_utc, is_public")
        .order("created_datetime_utc", { ascending: false })
        .limit(500);

      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        // Keep only non-empty caption content
        const cleaned = (data ?? []).filter(
          (r: any) => typeof r.content === "string" && r.content.trim().length > 0
        );
        setRows(cleaned as CaptionRow[]);
      }

      setLoading(false);
    };

    load();
  }, []);

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
          // Each bird advances at slightly different cadence
          const step = 1 + (idx % 3); // 1..3
          return {
            ...b,
            captionIndex: (b.captionIndex + step) % selectedCaptions.length,
          };
        })
      );
    }, 3200);

    return () => clearInterval(interval);
  }, [selectedCaptions.length]);

  return (
    <main className={styles.sky}>
      {/* Background layers */}
      <div className={styles.sun} />
      <div className={styles.cloudLayer}>
        <div className={`${styles.cloud} ${styles.cloud1}`} />
        <div className={`${styles.cloud} ${styles.cloud2}`} />
        <div className={`${styles.cloud} ${styles.cloud3}`} />
        <div className={`${styles.cloud} ${styles.cloud4}`} />
      </div>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.badge}>☁️</div>
          <div>
            <h1 className={styles.title}>The Humor Project — Caption Sky</h1>
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

      {/* Birds */}
      <section className={styles.flightZone} aria-label="Flying captions">
        {birdCaptions.map((b) => {
          const cap = selectedCaptions[b.captionIndex];
          const content = cap?.content ?? "…";

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
            <div key={b.id} className={styles.bird} style={styleVars}>
              <div className={styles.birdWrap}>
                <BirdSVG />
                <div className={styles.bubble}>
                  <div className={styles.bubbleInner}>{content}</div>
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
