"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Brush, Building2, Check, Loader2, RefreshCw, Wrench } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string };
type Room = { _id: string; roomNumber: string; floor?: string; status: string };
type Api<T> = { data?: T; error?: { message?: string } };
const roles = ["tenant_owner", "housekeeping"];
const input = "mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const next: Record<string, string[]> = {
  ready: ["cleaning", "maintenance", "out_of_service"],
  occupied: ["cleaning"],
  cleaning: ["ready", "maintenance", "out_of_service"],
  maintenance: ["ready", "out_of_service"],
  out_of_service: ["maintenance", "ready"],
};
const pretty = (value: string) => value.replaceAll("_", " ");

export default function HousekeepingWorkspacePage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const membership = useMemo(() => memberships.find((item) => item.tenant.slug === tenantSlug), [memberships, tenantSlug]);
  const canUpdate = roles.includes(membership?.role ?? "");

  const refresh = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/physical-rooms`, { cache: "no-store" });
    const body = await response.json() as Api<Room[]>;
    if (!response.ok) throw new Error(body.error?.message || "Unable to load room status.");
    setRooms(Array.isArray(body.data) ? body.data : []);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/housekeeping");
    if (status !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json() as Api<Membership[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        if (active) setMemberships(Array.isArray(body.data) ? body.data : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [status, router]);

  useEffect(() => {
    if (!tenantSlug) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties`, { cache: "no-store" });
        const body = await response.json() as Api<Property[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        if (active) setProperties(Array.isArray(body.data) ? body.data : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties."); }
    })();
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/physical-rooms`, { cache: "no-store" });
        const body = await response.json() as Api<Room[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load housekeeping rooms.");
        if (active) setRooms(Array.isArray(body.data) ? body.data : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load rooms."); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug]);

  const changeStatus = async (room: Room, status: string) => {
    setBusy(room._id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/physical-rooms/${room._id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to update room status.");
      await refresh(tenantSlug, propertySlug);
      setNotice(`Room ${room.roomNumber} updated to ${pretty(status)}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update room status."); }
    finally { setBusy(""); }
  };

  const counts = useMemo(() => rooms.reduce<Record<string, number>>((all, room) => { all[room.status] = (all[room.status] ?? 0) + 1; return all; }, {}), [rooms]);
  if (status === "loading" || loading && memberships.length === 0) return <main className="p-12 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading housekeeping…</main>;

  return <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Housekeeping</h1><p className="mt-2 text-sm text-slate-600">Track room readiness, cleaning and maintenance status.</p></div><button onClick={() => { void refresh(tenantSlug,propertySlug).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed.")); }} disabled={!propertySlug || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"><RefreshCw size={15}/>Refresh</button></header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Tenant<select className={input} value={tenantSlug} onChange={(event) => { setProperties([]); setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name} · {item.role.replaceAll("_"," ")}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Property<select className={input} value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
    </section>
    {!tenantSlug || !propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600"><Building2 className="mx-auto mb-3" size={32}/>Select a property to view room readiness.</div> : <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{["ready","occupied","cleaning","maintenance","out_of_service"].map((status) => <div key={status} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold text-slate-950">{counts[status] ?? 0}</p><p className="mt-1 text-sm capitalize text-slate-600">{pretty(status)}</p></div>)}</section>
      {!canUpdate && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Your role can view room status. A housekeeping team member or tenant owner can update it.</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rooms.map((room) => <article key={room._id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><div><p className="text-lg font-bold text-slate-950">Room {room.roomNumber}</p><p className="text-xs text-slate-500">{room.floor || "Floor not specified"}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize">{pretty(room.status)}</span></div>{canUpdate && <div className="flex flex-wrap gap-2">{(next[room.status] ?? []).map((target) => <button key={target} onClick={() => void changeStatus(room,target)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold capitalize text-slate-700 hover:bg-slate-50 disabled:opacity-50">{target === "ready" ? <Check size={13}/> : target === "maintenance" || target === "out_of_service" ? <Wrench size={13}/> : <Brush size={13}/>} {pretty(target)}</button>)}</div>}</article>)}</section>
      {!rooms.length && <p className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">No physical rooms have been registered for this property yet.</p>}
    </>}
  </div></main>;
}
