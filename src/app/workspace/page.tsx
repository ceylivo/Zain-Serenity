"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BedDouble, CalendarCheck, CreditCard, Loader2, RefreshCw, SprayCan, Wrench } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string; currency?: string };
type Dashboard = {
  date: string; timezone: string;
  bookings: { arrivals: number; departures: number; inHouse: number; newToday: number; pendingPayments: number };
  rooms: { total: number; ready: number; occupied: number; cleaning: number; maintenance: number; outOfService: number };
  operations: { openHousekeeping: number; overdueHousekeeping: number; openMaintenance: number; urgentMaintenance: number };
  upcoming: { id: string; kind: "arrival" | "departure"; date: string; guests: number; status: string; roomNumber: string | null }[];
};
type Api<T> = { data?: T; error?: { message?: string } };
const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800";
const today = () => { const now = new Date(); return [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"), String(now.getDate()).padStart(2,"0")].join("-"); };
const prettyDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
const number = (value: number) => new Intl.NumberFormat().format(value);

function Metric({ label, value, hint, icon: Icon, href, tone = "slate" }: { label: string; value: number; hint: string; icon: typeof BedDouble; href?: string; tone?: "slate" | "teal" | "amber" | "rose" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", teal: "bg-teal-50 text-teal-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700" };
  const card = <div className="h-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{number(value)}</p></div><span className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={19}/></span></div><p className="mt-3 text-xs text-slate-500">{hint}</p></div>;
  return href ? <Link href={href}>{card}</Link> : card;
}

export default function WorkspaceDashboardPage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const selectedTenant = useMemo(() => memberships.find((item) => item.tenant.slug === tenantSlug), [memberships, tenantSlug]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace");
    if (status !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json() as Api<Membership[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        if (active) {
          const items = Array.isArray(body.data) ? body.data : [];
          setMemberships(items);
          if (items.length) setTenantSlug(items[0].tenant.slug);
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [status, router]);

  useEffect(() => {
    if (!tenantSlug) { setProperties([]); setPropertySlug(""); return; }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties`, { cache: "no-store" });
        const body = await response.json() as Api<Property[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        if (active) {
          const items = Array.isArray(body.data) ? body.data : [];
          setProperties(items);
          setPropertySlug((current) => items.some((item) => item.slug === current) ? current : items[0]?.slug ?? "");
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties."); }
    })();
    return () => { active = false; };
  }, [tenantSlug]);

  const load = useCallback(async () => {
    if (!tenantSlug || !propertySlug || !date) { setData(null); return; }
    setRefreshing(true); setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/operations/dashboard?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const body = await response.json() as Api<Dashboard>;
      if (!response.ok) throw new Error(body.error?.message || "Unable to load property dashboard.");
      setData(body.data ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load property dashboard."); }
    finally { setRefreshing(false); }
  }, [tenantSlug, propertySlug, date]);

  useEffect(() => { void load(); }, [load]);

  if (status === "loading" || loading) return <div className="flex min-h-[50vh] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin"/>Loading workspace…</div>;

  return <div className="mx-auto max-w-7xl space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal-700">Property overview</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Good day{selectedTenant ? `, ${selectedTenant.tenant.name}` : ""}</h1><p className="mt-2 text-sm text-slate-500">A live operational snapshot of your hospitality business.</p></div>
      <button type="button" onClick={() => void load()} disabled={refreshing || !propertySlug} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={15} className={refreshing ? "animate-spin" : ""}/>Refresh</button>
    </header>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workspace<select className={field} value={tenantSlug} onChange={(event) => { setData(null); setTenantSlug(event.target.value); }}><option value="">Select workspace</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property<select className={field} value={propertySlug} onChange={(event) => { setData(null); setPropertySlug(event.target.value); }}><option value="">Select property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dashboard date<input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)}/></label>
    </section>

    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {!tenantSlug || !propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">Select a workspace and property to view operations.</div> : data && <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-slate-950">Daily operations</h2><span className="text-xs text-slate-500">Date: {prettyDate(data.date)} · Metrics use UTC date boundaries</span></div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Arrivals today" value={data.bookings.arrivals} hint="Confirmed and pending check-ins" icon={ArrowDownRight} href="/workspace/bookings" tone="teal"/>
        <Metric label="Departures today" value={data.bookings.departures} hint="Guests scheduled to check out" icon={ArrowUpRight} href="/workspace/bookings"/>
        <Metric label="Guests in-house" value={data.bookings.inHouse} hint="Currently checked-in stays" icon={BedDouble} href="/workspace/bookings"/>
        <Metric label="New bookings" value={data.bookings.newToday} hint="Bookings created on selected date" icon={CalendarCheck} href="/workspace/bookings"/>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">Room readiness</h2><p className="mt-1 text-xs text-slate-500">{data.rooms.total} physical rooms in this property</p></div><Link href="/workspace/housekeeping" className="text-xs font-semibold text-teal-700 hover:underline">Open housekeeping</Link></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {([{label:"Ready",value:data.rooms.ready,tone:"bg-emerald-500"},{label:"Occupied",value:data.rooms.occupied,tone:"bg-sky-500"},{label:"Cleaning",value:data.rooms.cleaning,tone:"bg-amber-500"},{label:"Maintenance",value:data.rooms.maintenance,tone:"bg-orange-500"},{label:"Out of service",value:data.rooms.outOfService,tone:"bg-rose-500"}]).map((item) => <div key={item.label} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.tone}`}/><span className="text-xs text-slate-500">{item.label}</span></div><p className="mt-2 text-2xl font-bold text-slate-950">{number(item.value)}</p></div>)}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="flex h-full">{data.rooms.total > 0 && <><span className="bg-emerald-500" style={{width:`${data.rooms.ready/data.rooms.total*100}%`}}/><span className="bg-sky-500" style={{width:`${data.rooms.occupied/data.rooms.total*100}%`}}/><span className="bg-amber-500" style={{width:`${data.rooms.cleaning/data.rooms.total*100}%`}}/><span className="bg-orange-500" style={{width:`${data.rooms.maintenance/data.rooms.total*100}%`}}/><span className="bg-rose-500" style={{width:`${data.rooms.outOfService/data.rooms.total*100}%`}}/></>}</div></div>
        </div>
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div><h2 className="font-semibold text-slate-950">Needs attention</h2><p className="mt-1 text-xs text-slate-500">Operational work requiring follow-up</p></div>
          <div className="space-y-3">
            <Link href="/workspace/housekeeping" className="flex items-center justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100"><span className="flex items-center gap-3"><SprayCan className="text-teal-700" size={19}/><span><span className="block text-sm font-medium text-slate-800">Open housekeeping</span><span className="text-xs text-slate-500">{data.operations.overdueHousekeeping} overdue</span></span></span><strong className="text-xl">{number(data.operations.openHousekeeping)}</strong></Link>
            <Link href="/workspace/maintenance" className="flex items-center justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100"><span className="flex items-center gap-3"><Wrench className="text-orange-700" size={19}/><span><span className="block text-sm font-medium text-slate-800">Open maintenance</span><span className="text-xs text-slate-500">{data.operations.urgentMaintenance} urgent</span></span></span><strong className="text-xl">{number(data.operations.openMaintenance)}</strong></Link>
            <Link href="/workspace/payments" className="flex items-center justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100"><span className="flex items-center gap-3"><CreditCard className="text-amber-700" size={19}/><span><span className="block text-sm font-medium text-slate-800">Pending payment bookings</span><span className="text-xs text-slate-500">Unpaid, pending or failed</span></span></span><strong className="text-xl">{number(data.bookings.pendingPayments)}</strong></Link>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-950">Upcoming arrivals & departures</h2><p className="mt-1 text-xs text-slate-500">Next seven days · up to twelve records</p></div><Link href="/workspace/bookings" className="text-xs font-semibold text-teal-700 hover:underline">Manage bookings</Link></div>
        {data.upcoming.length === 0 ? <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No upcoming arrivals or departures for this period.</p> : <div className="divide-y divide-slate-100">{data.upcoming.map((item) => <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="flex items-center gap-3"><span className={`rounded-xl p-2 ${item.kind === "arrival" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"}`}>{item.kind === "arrival" ? <ArrowDownRight size={18}/> : <ArrowUpRight size={18}/>}</span><div><p className="text-sm font-semibold capitalize text-slate-900">{item.kind} · {item.roomNumber ? `Room ${item.roomNumber}` : "Room unassigned"}</p><p className="mt-0.5 text-xs text-slate-500">{item.guests} guests · {item.status.replaceAll("_"," ")}</p></div></div><span className="text-sm text-slate-600">{prettyDate(item.date)}</span></div>)}</div>}
      </section>
      <p className="text-xs text-slate-400">Payment totals are not presented as revenue: this overview tracks booking/payment follow-up counts, not settled financial transactions.</p>
    </>}
  </div>;
}
