"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardList, Loader2, LogIn, LogOut, RefreshCw } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string; currency: string };
type Booking = { _id: string; userId: string; checkIn: string; checkOut: string; guests: number; children?: number; totalPrice: number; currency?: string; status: string; paymentStatus?: string; physicalRoomId?: string | null; roomTypeId?: string; specialRequests?: string };
type Room = { _id: string; roomNumber: string; roomTypeId: string; status: string };
type Api<T> = { data?: T; error?: { message?: string }; pagination?: { total: number; pages: number } };
const roles = ["tenant_owner", "property_manager", "booking_manager", "receptionist"];
const input = "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800";
const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
const label = (value?: string) => (value || "unknown").replaceAll("_", " ");

export default function BookingOperationsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const membership = useMemo(() => memberships.find((item) => item.tenant.slug === tenantSlug), [memberships, tenantSlug]);
  const canOperate = roles.includes(membership?.role ?? "");

  const loadOperationalData = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const base = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}`;
    const [bookingResponse, roomResponse] = await Promise.all([
      fetch(`${base}/bookings?page=1&limit=100`, { cache: "no-store" }),
      fetch(`${base}/physical-rooms`, { cache: "no-store" }),
    ]);
    const [bookingBody, roomBody] = await Promise.all([
      bookingResponse.json() as Promise<Api<Booking[]>>,
      roomResponse.json() as Promise<Api<Room[]>>,
    ]);
    if (!bookingResponse.ok) throw new Error(bookingBody.error?.message || "Unable to load bookings. Check your booking:read permission.");
    if (!roomResponse.ok) throw new Error(roomBody.error?.message || "Unable to load physical rooms. Check your inventory:read permission.");
    setBookings(Array.isArray(bookingBody.data) ? bookingBody.data : []);
    setRooms(Array.isArray(roomBody.data) ? roomBody.data : []);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/bookings");
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
        const [bookingResponse, roomResponse] = await Promise.all([
          fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/bookings?page=1&limit=100`, { cache: "no-store" }),
          fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/physical-rooms`, { cache: "no-store" }),
        ]);
        const [bookingBody, roomBody] = await Promise.all([bookingResponse.json() as Promise<Api<Booking[]>>, roomResponse.json() as Promise<Api<Room[]>>]);
        if (!bookingResponse.ok) throw new Error(bookingBody.error?.message || "Unable to load bookings.");
        if (!roomResponse.ok) throw new Error(roomBody.error?.message || "Unable to load physical rooms.");
        if (active) { setBookings(Array.isArray(bookingBody.data) ? bookingBody.data : []); setRooms(Array.isArray(roomBody.data) ? roomBody.data : []); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load operations."); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug]);

  const act = async (booking: Booking, action: "assign" | "unassign" | "confirm" | "check_in" | "check_out") => {
    setBusy(booking._id); setError(""); setNotice("");
    const base = `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/bookings/${booking._id}`;
    try {
      let response: Response;
      if (action === "assign" || action === "unassign") {
        const physicalRoomId = assignments[booking._id];
        if (action === "assign" && !physicalRoomId) throw new Error("Select an available physical room first.");
        response = await fetch(`${base}/assign-room`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "unassign" ? { action } : { action, physicalRoomId }) });
      } else {
        response = await fetch(`${base}/stay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Booking operation failed.");
      await loadOperationalData(tenantSlug, propertySlug);
      setNotice(action === "assign" ? "Physical room assigned or reassigned." : action === "unassign" ? "Physical room unassigned." : action === "confirm" ? "Booking confirmed." : action === "check_in" ? "Guest checked in." : "Guest checked out. Room moved to cleaning.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to complete booking operation."); }
    finally { setBusy(""); }
  };

  const stats = useMemo(() => ({
    arrivals: bookings.filter((item) => item.status === "confirmed").length,
    inHouse: bookings.filter((item) => item.status === "checked_in").length,
    departures: bookings.filter((item) => item.status === "checked_in").length,
    unassigned: bookings.filter((item) => ["pending", "confirmed"].includes(item.status) && !item.physicalRoomId).length,
  }), [bookings]);

  if (status === "loading" || loading && memberships.length === 0) return <main className="p-12 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading booking operations…</main>;

  return <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6"><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Booking operations</h1><p className="mt-2 text-sm text-slate-600">Assign rooms and manage guest arrivals and departures.</p></div><button onClick={() => { setBusy("refresh"); void loadOperationalData(tenantSlug, propertySlug).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed.")).finally(() => setBusy("")); }} disabled={!propertySlug || Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"><RefreshCw size={15}/>Refresh</button></header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Tenant<select className={input+" mt-1 block w-full"} value={tenantSlug} onChange={(event) => { setProperties([]); setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name} · {item.role.replaceAll("_"," ")}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Property<select className={input+" mt-1 block w-full"} value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
    </section>
    {!tenantSlug || !propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600"><ClipboardList className="mx-auto mb-3" size={32}/>Select a tenant and property to manage bookings.</div> : <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries({ "Confirmed / arrivals": stats.arrivals, "Guests in house": stats.inHouse, "Departures": stats.departures, "Rooms to assign": stats.unassigned }).map(([name,value]) => <div key={name} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold text-slate-950">{value}</p><p className="mt-1 text-sm text-slate-600">{name}</p></div>)}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold text-slate-900">Reservations</h2><p className="text-xs text-slate-500">{bookings.length} latest bookings · first 100 records</p></div><CalendarDays className="text-teal-700"/></div>
        {!bookings.length ? <p className="p-10 text-center text-sm text-slate-500">No bookings found for this property.</p> : <div className="divide-y divide-slate-100">{bookings.map((booking) => {
          const matchingRooms = rooms.filter((room) => room.roomTypeId === booking.roomTypeId && room.status === "ready" && room._id !== booking.physicalRoomId);
          const assigned = rooms.find((room) => room._id === booking.physicalRoomId);
          const allowedAssign = canOperate && ["pending","confirmed"].includes(booking.status);
          return <article key={booking._id} className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-slate-950">Booking · {booking._id.slice(-8).toUpperCase()}</p><p className="mt-1 text-xs text-slate-500">Guest ref {booking.userId.slice(-8)} · {booking.guests} adults · {booking.children ?? 0} children</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize">{label(booking.status)}</span><span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs capitalize text-sky-800">Payment: {label(booking.paymentStatus)}</span></div></div>
            <div className="grid gap-2 text-sm sm:grid-cols-3"><p className="text-slate-600">Check-in <strong className="block text-slate-900">{date(booking.checkIn)}</strong></p><p className="text-slate-600">Check-out <strong className="block text-slate-900">{date(booking.checkOut)}</strong></p><p className="text-slate-600">Total <strong className="block text-slate-900">{booking.currency ?? "PKR"} {booking.totalPrice.toLocaleString()}</strong></p></div>
            <p className="text-sm text-slate-600">Physical room: <strong className="text-slate-900">{assigned ? assigned.roomNumber : booking.physicalRoomId ? "Assigned room not in current list" : "Not assigned"}</strong></p>
            {booking.specialRequests && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Guest requests: {booking.specialRequests}</p>}
            {canOperate && <div className="flex flex-wrap items-center gap-2">
              {canOperate && booking.status === "pending" && <button onClick={() => void act(booking,"confirm")} disabled={Boolean(busy)} className="rounded-xl border border-teal-200 px-3 py-2 text-sm font-semibold text-teal-800 disabled:opacity-50">Confirm booking</button>}
              {allowedAssign && <><select aria-label="Select physical room" className={input} value={assignments[booking._id] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [booking._id]: event.target.value }))}><option value="">Choose ready room</option>{matchingRooms.map((room) => <option key={room._id} value={room._id}>{room.roomNumber}</option>)}</select><button onClick={() => void act(booking,"assign")} disabled={Boolean(busy) || !assignments[booking._id]} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{booking.physicalRoomId ? "Reassign room" : "Assign room"}</button>{booking.physicalRoomId && <button onClick={() => void act(booking,"unassign")} disabled={Boolean(busy)} className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50">Unassign room</button>}</>}
              {booking.status === "confirmed" && booking.physicalRoomId && <button onClick={() => void act(booking,"check_in")} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><LogIn size={15}/>Check in</button>}
              {booking.status === "checked_in" && <button onClick={() => void act(booking,"check_out")} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><LogOut size={15}/>Check out</button>}
            </div>}
          </article>;
        })}</div>}
      </section>
    </>}
  </div></main>;
}
