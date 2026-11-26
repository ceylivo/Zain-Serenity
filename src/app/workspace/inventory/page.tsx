"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Boxes, Building2, DoorOpen, Loader2, Plus, RefreshCw, Tag } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string; currency: string };
type RoomType = { _id: string; name: string; slug: string; currency: string; baseNightlyRate: number; inventoryCount: number; maxAdults: number; maxChildren: number; status: string };
type RatePlan = { _id: string; roomTypeId: string; name: string; code: string; currency: string; nightlyRate: number; taxRatePercent: number; minimumNights: number; isActive: boolean };
type PhysicalRoom = { _id: string; roomTypeId: string; roomNumber: string; floor?: string; status: string };
type ApiBody<T> = { data?: T; error?: { message?: string } };

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900";
const canManageRoles = ["tenant_owner", "property_manager"];

export default function InventoryWorkspacePage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [physicalRooms, setPhysicalRooms] = useState<PhysicalRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomSlug, setRoomSlug] = useState("");
  const [roomPrice, setRoomPrice] = useState("10000");
  const [roomInventory, setRoomInventory] = useState("1");
  const [roomAdults, setRoomAdults] = useState("2");
  const [roomChildren, setRoomChildren] = useState("0");
  const [selectedRoomType, setSelectedRoomType] = useState("");
  const [rateName, setRateName] = useState("Standard Rate");
  const [rateCode, setRateCode] = useState("STANDARD");
  const [ratePrice, setRatePrice] = useState("10000");
  const [rateTax, setRateTax] = useState("0");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomFloor, setRoomFloor] = useState("");

  const membership = useMemo(() => memberships.find((item) => item.tenant.slug === tenantSlug), [memberships, tenantSlug]);
  const canManage = canManageRoles.includes(membership?.role ?? "");

  const loadInventory = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const base = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}`;
    const [roomsResponse, ratesResponse, physicalResponse] = await Promise.all([
      fetch(`${base}/room-types`, { cache: "no-store" }),
      fetch(`${base}/rate-plans`, { cache: "no-store" }),
      fetch(`${base}/physical-rooms`, { cache: "no-store" }),
    ]);
    const [rooms, rates, physical] = await Promise.all([
      roomsResponse.json() as Promise<ApiBody<RoomType[]>>,
      ratesResponse.json() as Promise<ApiBody<RatePlan[]>>,
      physicalResponse.json() as Promise<ApiBody<PhysicalRoom[]>>,
    ]);
    if (!roomsResponse.ok) throw new Error(rooms.error?.message || "Unable to load room types.");
    if (!ratesResponse.ok) throw new Error(rates.error?.message || "Unable to load rate plans.");
    if (!physicalResponse.ok) throw new Error(physical.error?.message || "Unable to load physical rooms. Your membership may not include inventory access.");
    setRoomTypes(Array.isArray(rooms.data) ? rooms.data : []);
    setRatePlans(Array.isArray(rates.data) ? rates.data : []);
    setPhysicalRooms(Array.isArray(physical.data) ? physical.data : []);
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/login?callbackUrl=/workspace/inventory");
    if (authStatus !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json() as ApiBody<Membership[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        if (active) setMemberships(Array.isArray(body.data) ? body.data : []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [authStatus, router]);

  useEffect(() => {
    if (!tenantSlug) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties`, { cache: "no-store" });
        const body = await response.json() as ApiBody<Property[]>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        if (active) setProperties(Array.isArray(body.data) ? body.data : []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties.");
      }
    })();
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setError("");
      try { await loadInventory(tenantSlug, propertySlug); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load inventory."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug, loadInventory]);

  const submit = async (event: React.FormEvent, endpoint: "room-types" | "rate-plans" | "physical-rooms", body: Record<string, unknown>) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const base = `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}`;
      const response = await fetch(`${base}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to save inventory item.");
      await loadInventory(tenantSlug, propertySlug);
      setNotice(endpoint === "room-types" ? "Room type created." : endpoint === "rate-plans" ? "Rate plan created." : "Physical room created.");
      if (endpoint === "room-types") { setRoomName(""); setRoomSlug(""); }
      if (endpoint === "physical-rooms") { setRoomNumber(""); setRoomFloor(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save inventory item."); }
    finally { setSaving(false); }
  };

  if (authStatus === "loading" || loading && memberships.length === 0) return <main className="px-4 py-16 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading inventory workspace…</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Room inventory & rates</h1><p className="mt-2 text-sm text-slate-600">Manage room categories, physical room numbers and property rate plans.</p></header>
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Tenant<select className={input} value={tenantSlug} onChange={(event) => { setProperties([]); setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Property<select className={input} value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name} · {item.currency}</option>)}</select></label>
        </section>
        {!tenantSlug || !propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600"><Building2 className="mx-auto mb-3" size={30}/>Select a tenant and property to view its inventory.</div> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><Boxes className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{roomTypes.length}</p><p className="text-sm text-slate-600">Active room types</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><Tag className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{ratePlans.length}</p><p className="text-sm text-slate-600">Active rate plans</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><DoorOpen className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{physicalRooms.length}</p><p className="text-sm text-slate-600">Physical rooms</p></div>
          </div>
          <div className="flex justify-end"><button onClick={() => { setLoading(true); void loadInventory(tenantSlug, propertySlug).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed.")).finally(() => setLoading(false)); }} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={15}/>Refresh inventory</button></div>
          {canManage ? <div className="grid gap-5 lg:grid-cols-3">
            <form onSubmit={(event) => void submit(event, "room-types", { name: roomName, slug: roomSlug, currency: properties.find((p) => p.slug === propertySlug)?.currency ?? "PKR", baseNightlyRate: Number(roomPrice), inventoryCount: Number(roomInventory), maxAdults: Number(roomAdults), maxChildren: Number(roomChildren) })} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-900">Add room type</h2>
              <label className="block text-sm">Name<input required minLength={2} maxLength={120} value={roomName} onChange={(e) => { setRoomName(e.target.value); setRoomSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")); }} className={input}/></label>
              <label className="block text-sm">URL slug<input required value={roomSlug} onChange={(e) => setRoomSlug(e.target.value)} className={input}/></label>
              <label className="block text-sm">Base nightly rate<input required type="number" min="0" step="0.01" value={roomPrice} onChange={(e) => setRoomPrice(e.target.value)} className={input}/></label>
              <label className="block text-sm">Inventory capacity<input required type="number" min="0" max="10000" value={roomInventory} onChange={(e) => setRoomInventory(e.target.value)} className={input}/></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-sm">Adults<input type="number" min="1" max="30" value={roomAdults} onChange={(e) => setRoomAdults(e.target.value)} className={input}/></label><label className="text-sm">Children<input type="number" min="0" max="30" value={roomChildren} onChange={(e) => setRoomChildren(e.target.value)} className={input}/></label></div>
              <button disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15}/>Create room type</button>
            </form>
            <form onSubmit={(event) => void submit(event, "rate-plans", { roomTypeId: selectedRoomType, name: rateName, code: rateCode, currency: properties.find((p) => p.slug === propertySlug)?.currency ?? "PKR", nightlyRate: Number(ratePrice), taxRatePercent: Number(rateTax), minimumNights: 1, isRefundable: true })} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-900">Add rate plan</h2>
              <label className="block text-sm">Room type<select required value={selectedRoomType} onChange={(e) => setSelectedRoomType(e.target.value)} className={input}><option value="">Choose room type</option>{roomTypes.map((room) => <option key={room._id} value={room._id}>{room.name}</option>)}</select></label>
              <label className="block text-sm">Plan name<input required value={rateName} onChange={(e) => setRateName(e.target.value)} className={input}/></label>
              <label className="block text-sm">Unique code<input required value={rateCode} onChange={(e) => setRateCode(e.target.value.toUpperCase())} className={input}/></label>
              <label className="block text-sm">Nightly rate<input required type="number" min="0" step="0.01" value={ratePrice} onChange={(e) => setRatePrice(e.target.value)} className={input}/></label>
              <label className="block text-sm">Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={rateTax} onChange={(e) => setRateTax(e.target.value)} className={input}/></label>
              <button disabled={saving || !roomTypes.length || !selectedRoomType} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15}/>Create rate plan</button>
            </form>
            <form onSubmit={(event) => void submit(event, "physical-rooms", { roomTypeId: selectedRoomType, roomNumber, floor: roomFloor })} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-900">Add physical room</h2>
              <label className="block text-sm">Room type<select required value={selectedRoomType} onChange={(e) => setSelectedRoomType(e.target.value)} className={input}><option value="">Choose room type</option>{roomTypes.map((room) => <option key={room._id} value={room._id}>{room.name}</option>)}</select></label>
              <label className="block text-sm">Room number<input required maxLength={24} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} className={input}/></label>
              <label className="block text-sm">Floor / wing<input maxLength={24} value={roomFloor} onChange={(e) => setRoomFloor(e.target.value)} className={input}/></label>
              <button disabled={saving || !selectedRoomType} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15}/>Create physical room</button>
            </form>
          </div> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Your role can view inventory, but only a tenant owner or property manager can create inventory items.</div>}
          <section className="grid gap-5 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-semibold">Room types</h2>{roomTypes.length ? roomTypes.map((room) => <div key={room._id} className="border-t border-slate-100 py-3"><p className="font-medium">{room.name}</p><p className="text-xs text-slate-500">{room.inventoryCount} inventory · {room.maxAdults} adults · {room.currency} {room.baseNightlyRate}/night</p></div>) : <p className="text-sm text-slate-500">No active room types yet.</p>}</div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-semibold">Rate plans</h2>{ratePlans.length ? ratePlans.map((rate) => <div key={rate._id} className="border-t border-slate-100 py-3"><p className="font-medium">{rate.name} <span className="text-xs text-slate-500">({rate.code})</span></p><p className="text-xs text-slate-500">{rate.currency} {rate.nightlyRate}/night · {rate.taxRatePercent}% tax</p></div>) : <p className="text-sm text-slate-500">No active rate plans yet.</p>}</div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-semibold">Physical rooms</h2>{physicalRooms.length ? physicalRooms.map((room) => <div key={room._id} className="flex justify-between gap-2 border-t border-slate-100 py-3"><span className="font-medium">{room.roomNumber}</span><span className="text-xs capitalize text-slate-500">{room.status.replaceAll("_"," ")}</span></div>) : <p className="text-sm text-slate-500">No physical rooms registered yet.</p>}</div>
          </section>
        </>}
      </div>
    </main>
  );
}
