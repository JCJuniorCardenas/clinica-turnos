"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { LogoMark, Spinner } from "../components/ui";
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

  if (!me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-muted" role="status" aria-live="polite">
        <span className="animate-float">
          <LogoMark size={52} />
        </span>
        <span className="flex items-center gap-2 text-sm">
          <Spinner size={16} />
          Cargando tu agenda...
        </span>
      </div>
    );
  }
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}
