"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib-api";

export type LiveEvent = {
  type: "ready" | "turno.creado" | "turno.cancelado" | "turno.reprogramado" | "turno.estado";
  turnoId?: string;
  doctorId?: string;
  inicio?: string;
  actor?: string;
};

/**
 * Subscribes to the server's live stream (Server-Sent Events). The browser reconnects by itself if the
 * connection drops; "ready" fires on every (re)connection so the caller can refetch what it missed.
 */
export function useTurnoStream(onEvent: (e: LiveEvent) => void): "online" | "offline" {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState<"online" | "offline">("offline");

  useEffect(() => {
    const es = new EventSource(`${API_URL}/turnos/stream`, { withCredentials: true });
    es.onopen = () => setStatus("online");
    es.onerror = () => setStatus("offline");
    es.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data) as { type: string };
        if (data.type !== "ping") handler.current(data as LiveEvent);
      } catch {
        // ignore malformed messages
      }
    };
    return () => es.close();
  }, []);

  return status;
}

const MUTE_KEY = "agenda-sonido-silenciado";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // storage may be blocked; the preference just won't persist
  }
}

/** Two short beeps. Browsers may block audio until the user has clicked somewhere on the page. */
export function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.22].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.15);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // audio unavailable
  }
}
