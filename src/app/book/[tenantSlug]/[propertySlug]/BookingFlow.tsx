"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, CreditCard, Loader2, UploadCloud } from "lucide-react";

type RoomType = {
  _id: string;
  name: string;
  description?: string;
  maxAdults: number;
  maxChildren: number;
  amenities?: string[];
  images?: string[];
};
type RatePlan = {
  _id: string;
  roomTypeId: string;
  name: string;
  description?: string;
  currency: string;
  nightlyRate: number;
  taxRatePercent: number;
  minimumNights: number;
  maximumNights?: number;
  isRefundable: boolean;
};
type PaymentMethod = "bank_transfer" | "easypaisa" | "jazzcash" | "cash_on_arrival";
type PaymentSettings = {
  enabledMethods: PaymentMethod[];
  bankTransfer?: { bankName?: string; accountTitle?: string; accountNumber?: string; iban?: string; instructions?: string };
  easypaisa?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  jazzcash?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  cashInstructions?: string;
};
type CreatedBooking = { _id: string; totalPrice: number; currency: string; status: string; paymentStatus: string };
type CreatedPayment = { _id: string; method: PaymentMethod; status: string; amount: number; currency: string };

const methodLabels: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  easypaisa: "Easypaisa",
  jazzcash: "JazzCash",
  cash_on_arrival: "Cash on arrival",
};

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

export default function BookingFlow({ tenantSlug, propertySlug }: { tenantSlug: string; propertySlug: string }) {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const base = useMemo(() => `/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}`, [tenantSlug, propertySlug]);
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [rates, setRates] = useState<RatePlan[]>([]);
  const [settings, setSettings] = useState<PaymentSettings>({ enabledMethods: [] });
  const [roomTypeId, setRoomTypeId] = useState("");
  const [ratePlanId, setRatePlanId] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(1);
  const [children, setChildren] = useState(0);
  const [specialRequests, setSpecialRequests] = useState("");
  const [booking, setBooking] = useState<CreatedBooking | null>(null);
  const [payment, setPayment] = useState<CreatedPayment | null>(null);
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRoom = rooms.find((item) => item._id === roomTypeId);
  const availableRates = rates.filter((item) => item.roomTypeId === roomTypeId);
  const selectedRate = availableRates.find((item) => item._id === ratePlanId);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [roomResponse, rateResponse, settingsResponse] = await Promise.all([
          fetch(`${base}/room-types`, { cache: "no-store" }),
          fetch(`${base}/rate-plans`, { cache: "no-store" }),
          fetch(`${base}/payment-settings`, { cache: "no-store" }),
        ]);
        const [roomBody, rateBody, settingsBody] = await Promise.all([
          roomResponse.json(), rateResponse.json(), settingsResponse.json(),
        ]);
        if (!roomResponse.ok) throw new Error(roomBody.error?.message || "Unable to load room types.");
        if (!rateResponse.ok) throw new Error(rateBody.error?.message || "Unable to load rate plans.");
        if (!settingsResponse.ok) throw new Error(settingsBody.error?.message || "Unable to load payment methods.");
        if (!active) return;
        const roomItems = Array.isArray(roomBody.data) ? roomBody.data as RoomType[] : [];
        const rateItems = Array.isArray(rateBody.data) ? rateBody.data as RatePlan[] : [];
        setRooms(roomItems);
        setRates(rateItems);
        setSettings(settingsBody.data as PaymentSettings);
        setRoomTypeId(roomItems[0]?._id ?? "");
        const firstRate = rateItems.find((item) => item.roomTypeId === roomItems[0]?._id);
        setRatePlanId(firstRate?._id ?? "");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load booking options.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [base]);

  const createBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authStatus !== "authenticated") {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/book/${tenantSlug}/${propertySlug}`)}`);
      return;
    }
    if (!roomTypeId || !ratePlanId || !checkIn || !checkOut || checkOut <= checkIn) {
      setError("Select a room, rate plan and valid check-in/check-out dates.");
      return;
    }
    if (selectedRate) {
      const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
      if (nights < selectedRate.minimumNights || (selectedRate.maximumNights && nights > selectedRate.maximumNights)) {
        setError(`This rate plan requires a stay of ${selectedRate.minimumNights} to ${selectedRate.maximumNights ?? "unlimited"} nights.`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${base}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomTypeId, ratePlanId, checkIn, checkOut, guests, children, specialRequests }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.error || "Booking could not be created.");
      setBooking(body.data as CreatedBooking);
      setNotice("Your booking has been reserved. Choose a payment method to continue.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Booking could not be created.");
    } finally { setSubmitting(false); }
  };

  const createPayment = async () => {
    if (!booking || !method) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${base}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ bookingId: booking._id, method }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to start payment.");
      setPayment(body.data as CreatedPayment);
      setNotice(method === "cash_on_arrival" ? "Payment is pending. Property staff will record cash when received." : "Payment attempt created. Follow the instructions and submit your receipt.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start payment.");
    } finally { setSubmitting(false); }
  };

  const submitReceipt = async () => {
    if (!payment || !receipt) return;
    setSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", receipt);
      if (reference.trim()) form.set("reference", reference.trim());
      const response = await fetch(`${base}/payments/${payment._id}/receipt`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Receipt upload failed.");
      setPayment(body.data.payment as CreatedPayment);
      setNotice("Receipt submitted successfully. Payment is awaiting property verification.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt upload failed.");
    } finally { setSubmitting(false); }
  };

  if (loading) return <main className="mx-auto max-w-3xl px-4 py-20 text-slate-600"><Loader2 className="mr-2 inline animate-spin" /> Loading booking options…</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Property reservation</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Book your stay</h1><p className="mt-2 text-sm text-slate-600">Availability and final pricing are confirmed securely by the property booking service.</p></header>
        {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18} />{error}</div>}
        {notice && <div role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} />{notice}</div>}
        {!rooms.length && <div className="rounded-2xl bg-white p-8 text-center text-slate-600">This property has no active room types available for online booking.</div>}
        {!booking && rooms.length > 0 && <form onSubmit={createBooking} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <label className="block text-sm font-semibold text-slate-700">Room type<select value={roomTypeId} onChange={(event) => { const nextRoomTypeId = event.target.value; setRoomTypeId(nextRoomTypeId); setRatePlanId(rates.find((item) => item.roomTypeId === nextRoomTypeId)?._id ?? ""); }} required className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3">{rooms.map((room) => <option key={room._id} value={room._id}>{room.name} · up to {room.maxAdults} adults{room.maxChildren ? ` + ${room.maxChildren} children` : ""}</option>)}</select></label>
          {selectedRoom?.description && <p className="text-sm text-slate-600">{selectedRoom.description}</p>}
          <label className="block text-sm font-semibold text-slate-700">Rate plan<select value={ratePlanId} onChange={(event) => setRatePlanId(event.target.value)} required className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3">{availableRates.map((rate) => <option key={rate._id} value={rate._id}>{rate.name} · {money(rate.nightlyRate, rate.currency)} / night · tax {rate.taxRatePercent}%</option>)}</select></label>
          {selectedRate && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Rate: {money(selectedRate.nightlyRate, selectedRate.currency)} per night. Final total and taxes are calculated by the server when you reserve.</p>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Check-in<input type="date" min={new Date().toISOString().slice(0,10)} value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label><label className="text-sm font-semibold text-slate-700">Check-out<input type="date" min={checkIn || new Date().toISOString().slice(0,10)} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} required className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700">Adults<input type="number" min={1} max={selectedRoom?.maxAdults ?? 30} value={guests} onChange={(event) => setGuests(Number(event.target.value))} required className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label><label className="text-sm font-semibold text-slate-700">Children<input type="number" min={0} max={selectedRoom?.maxChildren ?? 30} value={children} onChange={(event) => setChildren(Number(event.target.value))} className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label></div>
          <label className="block text-sm font-semibold text-slate-700">Special requests (optional)<textarea value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value)} maxLength={2000} rows={3} className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label>
          <button disabled={submitting || !ratePlanId || authStatus === "loading"} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{submitting ? <Loader2 className="animate-spin" size={18} /> : null}Reserve room</button>
        </form>}
        {booking && <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div><p className="text-sm text-slate-500">Booking reference</p><p className="break-all text-lg font-bold text-slate-950">{booking._id}</p><p className="mt-2 text-2xl font-bold text-teal-800">{money(booking.totalPrice, booking.currency)}</p><p className="text-sm text-slate-500">Server-calculated booking total · {booking.paymentStatus.replaceAll("_", " ")}</p></div>
          {!payment && <><h2 className="text-xl font-bold text-slate-900">Choose payment method</h2>{settings.enabledMethods.length === 0 ? <p className="text-sm text-slate-600">Online payment methods are not configured for this property. Your reservation is created; please contact the property to arrange payment.</p> : <><div className="grid gap-2 sm:grid-cols-2">{settings.enabledMethods.map((item) => <label key={item} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${method === item ? "border-teal-600 bg-teal-50" : "border-slate-200"}`}><input type="radio" name="paymentMethod" value={item} checked={method === item} onChange={() => setMethod(item)} /><span className="font-medium text-slate-800">{methodLabels[item]}</span></label>)}</div><button onClick={createPayment} disabled={!method || submitting} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50"><CreditCard size={18} />Continue to payment</button></>}</>}
          {payment && <div className="space-y-4"><p className="font-semibold text-slate-900">{methodLabels[payment.method]} · {payment.status.replaceAll("_", " ")}</p>{payment.method === "bank_transfer" && settings.bankTransfer && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">{settings.bankTransfer.bankName}</p><p>{settings.bankTransfer.accountTitle}</p><p>{settings.bankTransfer.accountNumber || settings.bankTransfer.iban}</p><p>{settings.bankTransfer.instructions}</p></div>}{payment.method === "easypaisa" && settings.easypaisa && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">Easypaisa · {settings.easypaisa.accountTitle}</p><p>{settings.easypaisa.accountNumber}</p><p>{settings.easypaisa.instructions}</p></div>}{payment.method === "jazzcash" && settings.jazzcash && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-semibold">JazzCash · {settings.jazzcash.accountTitle}</p><p>{settings.jazzcash.accountNumber}</p><p>{settings.jazzcash.instructions}</p></div>}{payment.method === "cash_on_arrival" && <p className="rounded-xl bg-slate-50 p-4 text-sm">{settings.cashInstructions || "Pay at the property. Staff will record the cash collection when received."}</p>}{payment.method !== "cash_on_arrival" && payment.status === "pending" && <div className="space-y-3"><label className="block text-sm font-semibold">Transaction reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} className="mt-2 block w-full rounded-xl border border-slate-300 p-3" /></label><label className="block text-sm font-semibold">Receipt image (JPEG, PNG or WebP · max 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] ?? null)} className="mt-2 block w-full text-sm" /></label><button onClick={submitReceipt} disabled={!receipt || submitting} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50"><UploadCloud size={18} />Submit receipt</button></div>}</div>}
        </section>}
      </div>
    </main>
  );
}
