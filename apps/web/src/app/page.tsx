"use client";

import { useEffect } from "react";
import { getAccess } from "@/lib/auth";

export default function Home() {
  useEffect(() => {
    window.location.href = getAccess() ? "/dashboard" : "/login";
  }, []);
  return <div className="muted">Loading…</div>;
}
