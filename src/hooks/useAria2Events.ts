import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTaskStore } from "@/stores/taskStore";

export function useAria2Events() {
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const fns: UnlistenFn[] = [];

      fns.push(
        await listen("aria2://ready", (event) => {
          if (cancelled) return;
          const payload = event.payload as { port: number };
          useTaskStore.getState().setAria2Ready(true);
          useTaskStore.getState().addLog("info", `aria2 ready on port ${payload.port}`);
        })
      );

      fns.push(
        await listen("aria2://download-complete", (event) => {
          if (cancelled) return;
          const payload = event.payload as { gid: string };
          useTaskStore.getState().handleGidComplete(payload.gid);
        })
      );

      fns.push(
        await listen("aria2://download-error", (event) => {
          if (cancelled) return;
          const payload = event.payload as { gid: string };
          useTaskStore.getState().handleGidError(payload.gid);
        })
      );

      fns.push(
        await listen("aria2://download-paused", (event) => {
          if (cancelled) return;
          const payload = event.payload as { gid: string };
          useTaskStore.getState().handleGidPause(payload.gid);
        })
      );

      fns.push(
        await listen("aria2://download-started", (event) => {
          if (cancelled) return;
          const payload = event.payload as { gid: string };
          useTaskStore.getState().addLog("info", `Download started: ${payload.gid}`);
        })
      );

      fns.push(
        await listen("aria2://error", (event) => {
          if (cancelled) return;
          const payload = event.payload as { error: string };
          useTaskStore.getState().addLog("error", `aria2 error: ${payload.error}`);
        })
      );

      if (cancelled) {
        fns.forEach((fn) => fn());
      } else {
        unlistenRef.current = fns;
      }
    })();

    let polling = false;
    pollRef.current = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        await useTaskStore.getState().pollActiveDownloads();
      } finally {
        polling = false;
      }
    }, 1500);

    return () => {
      cancelled = true;
      unlistenRef.current.forEach((fn) => fn());
      unlistenRef.current = [];
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);
}
