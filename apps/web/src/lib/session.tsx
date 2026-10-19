"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, Me } from "../lib-api";

const SessionContext = createContext<Me | null>(null);

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useSession must be used inside SessionGate");
  return me;
}

/** Loads the logged-in user; sends to /login when there is no valid session. Children only render once logged in. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api("/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!me) return <p className="p-6 text-slate-500">Cargando...</p>;
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}
