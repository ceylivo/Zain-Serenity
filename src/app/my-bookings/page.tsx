"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { CalendarDays, Clock3, CreditCard, MapPin, RefreshCw, XCircle } from "lucide-react";

type Payment = {
  _id: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  reference?: string;
  createdAt: string;
};
type Booking = {
  _id: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  children?: number;
  totalPrice: number;
  currency: string;
  status: string;
  paymentStatus: string;
  specialRequests?: string;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
  property: { name: string; slug: string; currency: string } | null;
  roomName: string;
  payments: Payment[];
};
type ApiResponse = { data?: Booking[]; error?: { message?: string }; pagination?: { page: number; pages: number; total: number } };

const statusTone: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800",
  pending: "bg-amber-100 text-amber-800",
  unpaid: "bg-amber-100 text-amber-800",
  pending_verification: "bg-amber-100 text-amber-800",
};

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}
function pretty(value: string) { return value.replaceAll("_", " "); }

export default function MyBookingsPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filter, setFilter] = useState("all");

  const loadBookings = useCallback(async (nextPage: number) => {
    try {
      const response = await fetch(`/api/my-bookings?page=${nextPage}&limit=20`, { cache: "no-store" });
      const body = await response.json() as ApiResponse;
      if (!response.ok) throw new Error(body.error?.message || "Unable to load your bookings.");
      setBookings(Array.isArray(body.data) ? body.data : []);
      setPages(Math.max(1, body.pagination?.pages ?? 1));
      setPage(nextPage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load your bookings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.replace("/login?callbackUrl=/my-bookings");
      return;
    }
    if (authStatus !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/my-bookings?page=1&limit=20", { cache: "no-store" });
        const body = await response.json() as ApiResponse;
        if (!response.ok) throw new Error(body.error?.message || "Unable to load your bookings.");
        if (active) {
          setBookings(Array.isArray(body.data) ? body.data : []);
          setPages(Math.max(1, body.pagination?.pages ?? 1));
          setPage(1);
          setError("");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load your bookings.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [authStatus, router]);

  const cancelBooking = async (booking: Booking) => {
    if (!booking.tenant || !booking.property) return;
    if (!window.confirm("Cancel this booking? Any submitted or settled payment may require property staff review.")) return;
    setBusyId(booking._id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/tenants/${encodeURIComponent(booking.tenant.slug)}/properties/${encodeURIComponent(booking.property.slug)}/bookings/${booking._id}/cancel`,
        { method: "POST" }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "This booking cannot be cancelled online.");
      setNotice("Booking cancellation recorded.");
      await loadBookings(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to cancel booking.");
    } finally {
      setBusyId("");
    }
  };

  const visible = bookings.filter((booking) => filter === "all" || (filter === "payment" ? ["unpaid", "pending", "partially_paid", "failed", "partially_refunded"].includes(booking.paymentStatus) : booking.status === filter));

  if (authStatus === "loading" || loading) {
    return <main className="min-h-screen bg-slate-50 px-4 py-20 text-center text-slate-600">Loading your bookings…</main>;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-teal-50/30 px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Your account</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-950 sm:text-4xl">My bookings</h1>
            <p className="mt-2 text-sm text-slate-600">Reservations across your properties, with separate booking and payment status.</p>
          </div>
          <button onClick={() => { setRefreshing(true); void loadBookings(page).finally(() => setRefreshing(false)); }} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </header>

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

        <div className="flex flex-wrap items-center gap-2">
          {[["all", "All bookings"], ["pending", "Pending"], ["confirmed", "Confirmed"], ["cancelled", "Cancelled"], ["payment", "Payment attention"]].map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-4 py-2 text-sm font-medium capitalize ${filter === value ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>{label}</button>
          ))}
        </div>

        {visible.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
            <CalendarDays className="mx-auto mb-3 text-teal-600" size={36} />
            <h2 className="text-lg font-semibold text-slate-900">{bookings.length ? "No bookings match this filter" : "No bookings yet"}</h2>
            <p className="mt-2 text-sm text-slate-600">{bookings.length ? "Try another status filter." : "Your reservations will appear here after you book a stay."}</p>
          </section>
        ) : (
          <div className="space-y-4">
            {visible.map((booking) => {
              const canCancel = Boolean(booking.tenant && booking.property && ["pending", "confirmed"].includes(booking.status));
              return (
                <article key={booking._id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-slate-950">{booking.roomName}</h2>
                      <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><MapPin size={15} />{booking.property?.name ?? "Legacy property"} · {booking.tenant?.name ?? "Legacy account"}</p>
                      <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><CalendarDays size={16} />{new Date(booking.checkIn).toLocaleDateString()} – {new Date(booking.checkOut).toLocaleDateString()}</p>
                      <p className="mt-1 text-sm text-slate-600">{booking.guests} adult guest{booking.guests === 1 ? "" : "s"}{booking.children ? ` · ${booking.children} children` : ""}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-2xl font-bold text-teal-800">{money(booking.totalPrice, booking.currency)}</p>
                      <p className="mt-1 text-xs text-slate-500">Booking total · {booking.currency}</p>
                    </div>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${statusTone[booking.status] ?? "bg-slate-100 text-slate-700"}`}>Booking: {pretty(booking.status)}</span>
                    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${statusTone[booking.paymentStatus] ?? "bg-slate-100 text-slate-700"}`}>Payment: {pretty(booking.paymentStatus)}</span>
                  </div>
                  {booking.payments.length > 0 && <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                    <p className="text-sm font-semibold text-slate-800">Payment attempts</p>
                    {booking.payments.map((payment) => <div key={payment._id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600"><span className="inline-flex items-center gap-2"><CreditCard size={15} />{pretty(payment.method)} · {money(payment.amount, payment.currency)}</span><span className="capitalize">{pretty(payment.status)}</span></div>)}
                  </div>}
                  {booking.specialRequests && <p className="mt-3 text-sm text-slate-600">Special requests: {booking.specialRequests}</p>}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock3 size={14} />Booked {new Date(booking.createdAt).toLocaleDateString()}</span>
                    {canCancel && <button onClick={() => void cancelBooking(booking)} disabled={busyId === booking._id} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"><XCircle size={15} />{busyId === booking._id ? "Cancelling…" : "Request cancellation"}</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {pages > 1 && <nav aria-label="Booking pages" className="flex items-center justify-center gap-3 pt-2"><button disabled={page <= 1 || refreshing} onClick={() => { setRefreshing(true); void loadBookings(page - 1).finally(() => setRefreshing(false)); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-slate-600">Page {page} of {pages}</span><button disabled={page >= pages || refreshing} onClick={() => { setRefreshing(true); void loadBookings(page + 1).finally(() => setRefreshing(false)); }} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">Next</button></nav>}
      </div>
    </main>
  );
}
