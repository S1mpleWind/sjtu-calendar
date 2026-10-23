import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

// Writes are announced by Rust after success, including imports and restores.
export function useCalendarUpdates(refresh: () => Promise<void>) {
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    const reload = () => { if (active) void refresh(); };
    void listen("calendar-data-changed", reload).then((unlisten) => {
      if (active) stop = unlisten; else unlisten();
    }).catch(() => { /* Focus reload remains available if the listener cannot start. */ });
    window.addEventListener("focus", reload);
    return () => { active = false; stop?.(); window.removeEventListener("focus", reload); };
  }, [refresh]);
}
