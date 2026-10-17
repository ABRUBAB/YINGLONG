"use client";

import { useEffect, useState } from "react";

function webgl2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/** The same gate every WebGL piece uses: motion on, no Save-Data, at least 4 GB, and WebGL2. */
export function canRender3D(motionOff: boolean): boolean {
  if (motionOff) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  return webgl2();
}

/** False on the server and on the first client render, then true where 3D and shaders may run. */
export function useCan3D(motionOff: boolean): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canRender3D(motionOff)), [motionOff]);
  return ok;
}
