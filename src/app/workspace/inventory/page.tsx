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
type InventoryBlock = { id: string; roomTypeId: string; startDate: string; endDate: string; quantity: number; remainingQuantity: number; releasedQuantity: number; status: "active" | "partially_released" | "released"; reason: string; createdAt: string; createdBy: string; lastReleasedAt: string | null };
type Availability = { startDate: string; endDate: string; dates: string[]; roomTypes: { roomTypeId: string; name: string; currency: string; inventory: { date: string; totalRooms: number; availableRooms: number; reservedRooms: number; blockedRooms: number }[] }[] };
type ApiBody<T> = { data?: T; error?: { message?: string } };
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function shiftDateKey(value: string, days: number) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); }

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
  const [inventoryBlocks, setInventoryBlocks] = useState<InventoryBlock[]>([]);
  const [releaseQuantities, setReleaseQuantities] = useState<Record<string, string>>({});
  const [releaseReasons, setReleaseReasons] = useState<Record<string, string>>({});
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
  const [calendarStart, setCalendarStart] = useState(() => localDateKey(new Date()));
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [blockStartDate, setBlockStartDate] = useState(() => localDateKey(new Date()));
  const [blockEndDate, setBlockEndDate] = useState(() => localDateKey(new Date()));
  const [blockQuantity, setBlockQuantity] = useState("1");
  const [blockReason, setBlockReason] = useState("");

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
      setError("");
      try { await loadInventory(tenantSlug, propertySlug); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load inventory."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug, loadInventory]);

  const loadInventoryBlocks = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const base = `/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}`;
    const response = await fetch(`${base}/inventory/blocks`, { cache: "no-store" });
    const body = await response.json() as ApiBody<InventoryBlock[]>;
    if (!response.ok) throw new Error(body.error?.message || "Unable to load inventory block history.");
    setInventoryBlocks(Array.isArray(body.data) ? body.data : []);
  }, []);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) return;
    let active = true;
    void (async () => {
      try { await loadInventoryBlocks(tenantSlug, propertySlug); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load inventory block history."); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug, loadInventoryBlocks]);

  const releaseInventoryBlock = async (block: InventoryBlock) => {
    const quantity = Number(releaseQuantities[block.id] ?? "1");
    const reason = (releaseReasons[block.id] ?? "").trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > block.remainingQuantity || reason.length < 3) {
      setError("Enter a valid release quantity and a reason of at least 3 characters.");
      return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const base = `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}`;
      const response = await fetch(`${base}/inventory/blocks`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: block.id, quantity, reason }),
      });
      const result = await response.json() as ApiBody<unknown>;
      if (!response.ok) throw new Error(result.error?.message || "Unable to release this inventory block.");
      await Promise.all([loadInventoryBlocks(tenantSlug, propertySlug), loadInventory(tenantSlug, propertySlug)]);
      setReleaseReasons((current) => ({ ...current, [block.id]: "" }));
      setNotice(`Released ${quantity} room(s) from the selected inventory block.`);
      const endDate = shiftDateKey(calendarStart, 13);
      const availabilityResponse = await fetch(`${base}/inventory/availability?startDate=${calendarStart}&endDate=${endDate}`, { cache: "no-store" });
      const availabilityBody = await availabilityResponse.json() as ApiBody<Availability>;
      if (availabilityResponse.ok) setAvailability(availabilityBody.data ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to release this inventory block."); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    if (!tenantSlug || !propertySlug) return;
    let active = true;
    const endDate = shiftDateKey(calendarStart, 13);
    void (async () => {
      setCalendarLoading(true);
      try {
        const base = `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}`;
        const response = await fetch(`${base}/inventory/availability?startDate=${calendarStart}&endDate=${endDate}`, { cache: "no-store" });
        const body = await response.json() as ApiBody<Availability>;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load room availability.");
        if (active) setAvailability(body.data ?? null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load room availability.");
      } finally { if (active) setCalendarLoading(false); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug, calendarStart]);

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

  const adjustInventory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tenantSlug || !propertySlug) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const base = `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}`;
      const response = await fetch(`${base}/inventory/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "block", roomTypeId: selectedRoomType, startDate: blockStartDate, endDate: blockEndDate, quantity: Number(blockQuantity), reason: blockReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to adjust room inventory.");
      await loadInventoryBlocks(tenantSlug, propertySlug);
      const endDate = shiftDateKey(calendarStart, 13);
      const availabilityResponse = await fetch(`${base}/inventory/availability?startDate=${calendarStart}&endDate=${endDate}`, { cache: "no-store" });
      const availabilityBody = await availabilityResponse.json() as ApiBody<Availability>;
      if (availabilityResponse.ok) setAvailability(availabilityBody.data ?? null);
      setNotice("Rooms blocked for the selected dates.");
      setBlockReason("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to adjust room inventory.");
    } finally { setSaving(false); }
  };

  if (authStatus === "loading" || loading && memberships.length === 0) return <main className="px-4 py-16 text-slate-600"><Loader2 className="mr-2 inline animate-spin"/>Loading inventory workspace…</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property operations</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Room inventory & rates</h1><p className="mt-2 text-sm text-slate-600">Manage room categories, physical room numbers and property rate plans.</p></header>
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Tenant<select className={input} value={tenantSlug} onChange={(event) => { setLoading(true); setProperties([]); setPropertySlug(""); setTenantSlug(event.target.value); }}><option value="">Choose tenant</option>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Property<select className={input} value={propertySlug} onChange={(event) => { setLoading(true); setPropertySlug(event.target.value); }}><option value="">Choose property</option>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name} · {item.currency}</option>)}</select></label>
        </section>
        {!tenantSlug || !propertySlug ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600"><Building2 className="mx-auto mb-3" size={30}/>Select a tenant and property to view its inventory.</div> : <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><Boxes className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{roomTypes.length}</p><p className="text-sm text-slate-600">Active room types</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><Tag className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{ratePlans.length}</p><p className="text-sm text-slate-600">Active rate plans</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><DoorOpen className="mb-2 text-teal-700"/><p className="text-2xl font-bold">{physicalRooms.length}</p><p className="text-sm text-slate-600">Physical rooms</p></div>
          </div>
          <div className="flex justify-end"><button onClick={() => { setLoading(true); void loadInventory(tenantSlug, propertySlug).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed.")).finally(() => setLoading(false)); }} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={15}/>Refresh inventory</button></div>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-slate-950">Room availability calendar</h2><p className="text-sm text-slate-500">14-day room-type availability · reserved and blocked inventory</p></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setCalendarStart((value) => shiftDateKey(value,-14))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Previous</button>
                <input aria-label="Calendar start date" type="date" value={calendarStart} onChange={(event) => setCalendarStart(event.target.value)} className={input}/>
                <button type="button" onClick={() => setCalendarStart((value) => shiftDateKey(value,14))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Next</button>
              </div>
            </div>
            {calendarLoading && <p className="text-sm text-slate-500"><Loader2 className="mr-2 inline animate-spin" size={14}/>Loading availability…</p>}
            {!calendarLoading && availability && availability.roomTypes.length > 0 ? <div className="overflow-x-auto"><table className="min-w-full border-collapse text-left text-xs"><thead><tr><th className="sticky left-0 bg-white p-2 text-slate-600">Room type</th>{availability.dates.map((day) => <th key={day} className="min-w-16 border-b border-slate-100 p-2 text-center font-medium text-slate-500">{day.slice(5)}</th>)}</tr></thead><tbody>{availability.roomTypes.map((room) => <tr key={room.roomTypeId}><th className="sticky left-0 border-b border-slate-100 bg-white p-2 font-semibold text-slate-800">{room.name}</th>{room.inventory.map((day) => <td key={day.date} className="border-b border-slate-100 p-2 text-center"><span className={`inline-flex min-w-8 justify-center rounded-md px-2 py-1 font-semibold ${day.availableRooms === 0 ? "bg-rose-100 text-rose-800" : day.availableRooms <= 2 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{day.availableRooms}</span><span className="mt-1 block text-[10px] text-slate-400">{day.reservedRooms} res · {day.blockedRooms} blk</span></td>)}</tr>)}</tbody></table></div> : !calendarLoading && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Create an active room type to see its availability calendar.</p>}
            <p className="text-xs text-slate-500">Each cell shows available rooms. Red means sold out; amber means 1–2 rooms remain. The calendar uses server-side inventory records and property-scoped data.</p>
          </section>
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
          {canManage && <form onSubmit={(event) => void adjustInventory(event)} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 lg:grid-cols-6">
            <div className="lg:col-span-6"><h2 className="font-semibold text-slate-950">Block room inventory</h2><p className="mt-1 text-sm text-slate-500">Create an individually tracked inventory block. Release quantities later against this exact record, with an audit reason.</p></div>
            <label className="text-sm">Room type<select required className={input} value={selectedRoomType} onChange={(event) => setSelectedRoomType(event.target.value)}><option value="">Choose room type</option>{roomTypes.map((room) => <option key={room._id} value={room._id}>{room.name}</option>)}</select></label>
            <label className="text-sm">From<input required type="date" className={input} value={blockStartDate} onChange={(event) => { setBlockStartDate(event.target.value); if (event.target.value > blockEndDate) setBlockEndDate(event.target.value); }}/></label>
            <label className="text-sm">Through<input required type="date" min={blockStartDate} className={input} value={blockEndDate} onChange={(event) => setBlockEndDate(event.target.value)}/></label>
            <label className="text-sm">Rooms<input required type="number" min="1" max="10000" className={input} value={blockQuantity} onChange={(event) => setBlockQuantity(event.target.value)}/></label>
            <label className="text-sm lg:col-span-5">Reason<input required minLength={3} maxLength={300} className={input} value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Maintenance, owner use, renovation…"/></label>
            <div className="flex items-end"><button disabled={saving || !selectedRoomType || !roomTypes.length} className="w-full rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Block inventory"}</button></div>
          </form>}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <div><h2 className="text-lg font-semibold text-slate-950">Inventory block history</h2><p className="text-sm text-slate-500">Review each block and release quantities against its original record. Older quantity-only blocks remain visible in availability counters but are not listed here.</p></div>
            {inventoryBlocks.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No individually tracked inventory blocks for this property yet.</p> : <div className="space-y-3">
              {inventoryBlocks.map((block) => {
                const room = roomTypes.find((item) => item._id === block.roomTypeId);
                return <article key={block.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-semibold text-slate-900">{room?.name ?? "Room type"} · {block.startDate} to {block.endDate}</p><p className="mt-1 text-xs text-slate-500">Reason: {block.reason}</p><p className="mt-1 text-xs text-slate-500">Created {new Date(block.createdAt).toLocaleString()}</p></div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${block.status === "released" ? "bg-slate-100 text-slate-700" : block.status === "partially_released" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{block.status.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-slate-500">Original</p><p className="font-semibold">{block.quantity}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-slate-500">Remaining</p><p className="font-semibold">{block.remainingQuantity}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-xs text-slate-500">Released</p><p className="font-semibold">{block.releasedQuantity}</p></div></div>
                  {canManage && block.remainingQuantity > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
                    <label className="text-xs text-slate-600">Release quantity<input aria-label={`Release quantity for ${room?.name ?? "room type"} block`} className={input} type="number" min="1" max={block.remainingQuantity} value={releaseQuantities[block.id] ?? "1"} onChange={(event) => setReleaseQuantities((current) => ({ ...current, [block.id]: event.target.value }))}/></label>
                    <label className="text-xs text-slate-600">Release reason<input aria-label="Reason for releasing inventory" className={input} minLength={3} maxLength={300} value={releaseReasons[block.id] ?? ""} onChange={(event) => setReleaseReasons((current) => ({ ...current, [block.id]: event.target.value }))} placeholder="Reason for releasing rooms"/></label>
                    <button type="button" disabled={saving || !(releaseReasons[block.id] ?? "").trim() || (releaseReasons[block.id] ?? "").trim().length < 3} onClick={() => void releaseInventoryBlock(block)} className="self-end rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Release</button>
                  </div>}
                </article>;
              })}
            </div>}
          </section>
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
