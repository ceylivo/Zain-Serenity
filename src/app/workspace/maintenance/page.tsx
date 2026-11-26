"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, RefreshCw, Wrench } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string };
type Room = { _id: string; roomNumber: string };
type Assignee = { id: string; name: string; email: string; role: string };
type WorkOrder = { id: string; physicalRoomId: string | null; title: string; description: string; priority: "low" | "normal" | "high" | "urgent"; status: "open" | "in_progress" | "blocked" | "completed" | "cancelled"; dueAt: string | null; assignedTo: string | null; statusHistory: { status: string; changedBy: string; changedAt: string; note?: string }[] };
type Api<T> = { data?: T; error?: { message?: string } };
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const priorities = ["low", "normal", "high", "urgent"] as const;
const statuses = ["open", "in_progress", "blocked", "completed", "cancelled"] as const;
const pretty = (value: string) => value.replaceAll("_", " ");

export default function MaintenanceWorkspacePage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [roomId, setRoomId] = useState("");
  const [priority, setPriority] = useState<WorkOrder["priority"]>("normal");
  const [dueAt, setDueAt] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const base = tenantSlug && propertySlug ? `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}` : "";
  const refresh = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const root = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}`;
    const [roomResponse, orderResponse] = await Promise.all([
      fetch(`${root}/physical-rooms`, { cache: "no-store" }),
      fetch(`${root}/maintenance/work-orders`, { cache: "no-store" }),
    ]);
    const [roomBody, orderBody] = await Promise.all([roomResponse.json() as Promise<Api<Room[]>>, orderResponse.json() as Promise<Api<WorkOrder[]>>]);
    if (!roomResponse.ok) throw new Error(roomBody.error?.message || "Unable to load rooms.");
    if (!orderResponse.ok) throw new Error(orderBody.error?.message || "Unable to load work orders.");
    setRooms(Array.isArray(roomBody.data) ? roomBody.data : []);
    setOrders(Array.isArray(orderBody.data) ? orderBody.data : []);
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/login?callbackUrl=/workspace/maintenance");
    if (authStatus !== "authenticated") return;
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
  }, [authStatus, router]);

  useEffect(() => {
    if (!tenantSlug) { setProperties([]); return; }
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
    if (!tenantSlug || !propertySlug) { setRooms([]); setOrders([]); return; }
    let active = true;
    void refresh(tenantSlug, propertySlug).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load maintenance data."); });
    return () => { active = false; };
  }, [tenantSlug, propertySlug, refresh]);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) { setAssignees([]); return; }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/operations/assignees`, { cache: "no-store" });
        const body = await response.json() as Api<Assignee[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load staff directory.");
        if (active) setAssignees(Array.isArray(body.data) ? body.data : []);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load staff directory."); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug]);

  const createOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${base}/maintenance/work-orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, physicalRoomId: roomId || undefined, priority, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, assignedTo: assignee.trim() || undefined }),
      });
      const body = await response.json() as Api<WorkOrder>;
      if (!response.ok) throw new Error(body.error?.message || "Unable to create work order.");
      await refresh(tenantSlug, propertySlug);
      setTitle(""); setDescription(""); setRoomId(""); setDueAt(""); setAssignee(""); setPriority("normal");
      setNotice("Maintenance work order created.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create work order."); }
    finally { setBusy(false); }
  };

  const updateOrder = async (order: WorkOrder, patch: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${base}/maintenance/work-orders/${order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const body = await response.json() as Api<WorkOrder>;
      if (!response.ok) throw new Error(body.error?.message || "Unable to update work order.");
      await refresh(tenantSlug, propertySlug);
      setNotice("Maintenance work order updated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update work order."); }
    finally { setBusy(false); }
  };

  if (authStatus === "loading" || loading && memberships.length === 0) return <main className="p-12 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading maintenance workspace…</main>;
  return <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Maintenance work orders</h1><p className="mt-2 text-sm text-slate-600">Track room repairs, priorities, deadlines, assignments and work-order history.</p></div><button type="button" onClick={() => void refresh(tenantSlug, propertySlug).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed."))} disabled={!base || busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold"><RefreshCw size={15}/>Refresh</button></header>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Tenant<select className={input} value={tenantSlug} onChange={(event) => { setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name} · {pretty(item.role)}</option>)}</select></label>
      <label className="text-sm font-medium">Property<select className={input} value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
    </section>
    {!base ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600"><Building2 className="mx-auto mb-3" size={32}/>Select a property to manage maintenance work orders.</div> : <>
      <form onSubmit={(event) => void createOrder(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3"><h2 className="font-semibold text-slate-950">Create work order</h2><p className="text-sm text-slate-500">Room association is optional for property-wide maintenance.</p></div>
        <label className="text-sm">Title<input required minLength={3} maxLength={120} className={input} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
        <label className="text-sm">Room<select className={input} value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Property-wide / no room</option>{rooms.map((room) => <option key={room._id} value={room._id}>{room.roomNumber}</option>)}</select></label>
        <label className="text-sm">Priority<select className={input} value={priority} onChange={(event) => setPriority(event.target.value as WorkOrder["priority"])}>{priorities.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label>
        <label className="text-sm">Deadline<input type="datetime-local" className={input} value={dueAt} onChange={(event) => setDueAt(event.target.value)}/></label>
        <label className="text-sm">Assign to<select className={input} value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">Unassigned</option>{assignees.map((member) => <option key={member.id} value={member.id}>{member.name} · {pretty(member.role)}</option>)}</select></label>
        <label className="text-sm">Description<input maxLength={2000} className={input} value={description} onChange={(event) => setDescription(event.target.value)}/></label>
        <div className="sm:col-span-2 lg:col-span-3"><button disabled={busy || !title.trim()} className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Create work order"}</button></div>
      </form>
      <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-slate-950">Work orders</h2><span className="text-sm text-slate-500">{orders.length} records</span></div>
        {orders.length === 0 ? <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500"><Wrench className="mx-auto mb-2" size={24}/>No maintenance work orders yet.</div> : orders.map((order) => {
          const room = rooms.find((item) => item._id === order.physicalRoomId);
          return <article key={order.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-950">{order.title}</h3><p className="mt-1 text-sm text-slate-500">{room ? `Room ${room.roomNumber}` : "Property-wide"} · {order.description || "No description"}</p><p className="mt-1 text-xs text-slate-500">Assignee: {assignees.find((member) => member.id === order.assignedTo)?.name ?? "Unassigned"} · Due: {order.dueAt ? new Date(order.dueAt).toLocaleString() : "No deadline"}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase">{order.priority}</span></div>
            <div className="flex flex-wrap items-center gap-2"><label className="text-xs">Status<select className={input} value={order.status} onChange={(event) => void updateOrder(order,{ status: event.target.value })}>{statuses.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label><label className="text-xs">Priority<select className={input} value={order.priority} onChange={(event) => void updateOrder(order,{ priority: event.target.value })}>{priorities.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></label></div>
            <div className="border-t border-slate-100 pt-3"><p className="text-xs font-semibold text-slate-600">Status history</p><p className="mt-1 text-xs text-slate-500">{order.statusHistory.map((entry) => `${pretty(entry.status)} · ${new Date(entry.changedAt).toLocaleString()}${entry.note ? ` · ${entry.note}` : ""}`).join(" → ") || "No status changes recorded"}</p></div>
          </article>;
        })}
      </section>
    </>}
  </div></main>;
}
