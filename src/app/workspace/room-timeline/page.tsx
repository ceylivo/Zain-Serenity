"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, Loader2, RefreshCw, Wrench, BedDouble, SprayCan } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string };
type Room = { id: string; roomNumber: string; roomTypeId: string; floor: string; status: string };
type Event = { id: string; roomId: string; type: string; title: string; description?: string; startAt: string; endAt?: string; status: string; priority?: string; assignedTo?: string; assignedToName?: string; sourceId: string; activity?: boolean };
type Timeline = { range: { from: string; to: string }; rooms: Room[]; events: Event[]; truncated: boolean };
type Api<T> = { data?: T; error?: { message?: string } };
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const pretty = (value: string) => value.replaceAll("_", " ");
const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

export default function RoomTimelinePage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTimeline = useCallback(async (tenant: string, property: string, start: string, end: string) => {
    if (!tenant || !property) return;
    const base = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/operations/room-timeline`;
    const response = await fetch(`${base}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`, { cache: "no-store" });
    const body = await response.json() as Api<Timeline>;
    if (!response.ok) throw new Error(body.error?.message || "Unable to load room timeline.");
    setTimeline(body.data ?? null);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/room-timeline");
    if (status !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json() as Api<Membership[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load tenants.");
        if (active) setMemberships(Array.isArray(body.data) ? body.data : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load tenants."); }
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
      try { await loadTimeline(tenantSlug, propertySlug, from, to); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load room timeline."); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug, from, to, loadTimeline]);

  const refresh = async () => {
    setBusy(true); setError("");
    try { await loadTimeline(tenantSlug, propertySlug, from, to); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh room timeline."); }
    finally { setBusy(false); }
  };

  if (status === "loading" || loading && memberships.length === 0) return <main className="p-12 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading room timeline…</main>;
  const eventsByRoom = new Map<string, Event[]>();
  for (const event of timeline?.events ?? []) eventsByRoom.set(event.roomId, [...(eventsByRoom.get(event.roomId) ?? []), event]);
  return <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6"><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Room operations timeline</h1><p className="mt-2 text-sm text-slate-600">See stays, housekeeping and maintenance activity together for every physical room.</p></div><button type="button" onClick={() => void refresh()} disabled={!propertySlug || busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"><RefreshCw size={15}/>Refresh</button></header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Tenant<select className={input} value={tenantSlug} onChange={(event) => { setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name} · {pretty(item.role)}</option>)}</select></label>
      <label className="text-sm font-medium">Property<select className={input} value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
      <label className="text-sm font-medium">From<input type="date" className={input} value={from} max={to} onChange={(event) => setFrom(event.target.value)}/></label>
      <label className="text-sm font-medium">Through<input type="date" className={input} value={to} min={from} onChange={(event) => setTo(event.target.value)}/></label>
    </section>
    {!propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600"><CalendarDays className="mx-auto mb-3" size={32}/>Select a property to view its room timeline.</div> : <>
      {timeline?.truncated && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This result reached the activity record limit. Narrow the date range to see a complete view.</div>}
      <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold">{timeline?.rooms.length ?? 0}</p><p className="text-sm text-slate-500">Physical rooms</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold">{timeline?.events.filter((event) => event.type === "booking").length ?? 0}</p><p className="text-sm text-slate-500">Stay reservations</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold">{timeline?.events.filter((event) => event.type !== "booking").length ?? 0}</p><p className="text-sm text-slate-500">Operations activities</p></div></section>
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between"><h2 className="text-lg font-semibold text-slate-950">Rooms and activity</h2><span className="text-sm text-slate-500">{from} – {to}</span></div>
        {!timeline?.rooms.length ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No physical rooms are configured for this property.</div> : timeline.rooms.map((room) => {
          const events = eventsByRoom.get(room.id) ?? [];
          return <article key={room.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4"><div><h3 className="font-semibold text-slate-950">Room {room.roomNumber}</h3><p className="text-xs text-slate-500">{room.floor ? `Floor ${room.floor} · ` : ""}Current state: {pretty(room.status)}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{events.length} events</span></div>
            {!events.length ? <p className="px-5 py-6 text-sm text-slate-500">No recorded activity in this date range.</p> : <ol className="divide-y divide-slate-100">{events.map((event) => <li key={event.id} className="flex gap-3 px-5 py-4">
              <div className="mt-0.5 rounded-lg bg-slate-100 p-2">{event.type.startsWith("booking") ? <BedDouble size={17}/> : event.type.startsWith("housekeeping") ? <SprayCan size={17}/> : <Wrench size={17}/>}</div>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-slate-900">{event.title}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">{pretty(event.status)}</span>{event.priority && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs capitalize text-amber-800">{event.priority}</span>}</div>
                {event.description && <p className="mt-1 text-sm text-slate-600">{event.description}</p>}{event.assignedToName && <p className="mt-1 text-xs text-slate-500">Assigned to {event.assignedToName}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500"><Clock3 size={12}/>{dateTime(event.startAt)}{event.endAt ? ` → ${dateTime(event.endAt)}` : ""}{event.activity ? " · Status activity" : ""}</p>
              </div>
            </li>)}</ol>}
          </article>;
        })}
      </section>
    </>}
  </div></main>;
}
