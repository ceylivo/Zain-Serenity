"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type TenantMembership = {
  id: string;
  role: string;
  tenant: { id?: string; name: string; slug: string };
};
type Property = { _id: string; name: string; slug: string; currency: string };
type Payment = {
  _id: string;
  bookingId: string;
  method: string;
  status: string;
  amount: number;
  currency: string;
  reference?: string;
  submittedAt?: string;
  verifiedAt?: string;
  createdAt: string;
};

const methodLabels: Record<string, string> = {
  bank_transfer: "Bank transfer",
  easypaisa: "Easypaisa",
  jazzcash: "JazzCash",
  cash_on_arrival: "Cash on arrival",
  stripe: "Stripe",
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export default function WorkspacePaymentsPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTenant = useMemo(
    () => memberships.find((item) => item.tenant.slug === tenantSlug),
    [memberships, tenantSlug]
  );

  const loadPayments = useCallback(async (tenant: string, property: string) => {
    if (!tenant || !property) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Unable to load payments.");
    setPayments(Array.isArray(body.data) ? body.data : []);
  }, []);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/login?callbackUrl=/workspace/payments");
    if (authStatus !== "authenticated") return;
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        const items = Array.isArray(body.data) ? body.data as TenantMembership[] : [];
        if (!active) return;
        setMemberships(items);
        if (items[0]) setTenantSlug(items[0].tenant.slug);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [authStatus, router]);

  useEffect(() => {
    if (!tenantSlug) { setProperties([]); setPropertySlug(""); return; }
    let active = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        const items = Array.isArray(body.data) ? body.data as Property[] : [];
        if (!active) return;
        setProperties(items);
        setPropertySlug(items[0]?.slug ?? "");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) { setPayments([]); return; }
    let active = true;
    setLoading(true);
    loadPayments(tenantSlug, propertySlug)
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load payments."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantSlug, propertySlug, loadPayments]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try { await loadPayments(tenantSlug, propertySlug); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh payments."); }
    finally { setLoading(false); }
  };

  const actOnPayment = async (payment: Payment, action: "verify" | "reject" | "cash") => {
    setBusyId(payment._id);
    setError("");
    setNotice("");
    try {
      const endpoint = action === "cash" ? "collect-cash" : "verify";
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/payments/${payment._id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(action === "cash" ? {} : { body: JSON.stringify({ outcome: action === "verify" ? "succeeded" : "failed" }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Payment action failed.");
      setNotice(action === "verify" ? "Payment verified." : action === "reject" ? "Payment rejected." : "Cash collection recorded.");
      await loadPayments(tenantSlug, propertySlug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment action failed.");
    } finally { setBusyId(""); }
  };

  const openReceipt = async (payment: Payment) => {
    setBusyId(payment._id);
    setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/payments/${payment._id}/receipt`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || typeof body.data?.url !== "string") throw new Error(body.error?.message || "Receipt is not available.");
      window.open(body.data.url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open receipt.");
    } finally { setBusyId(""); }
  };

  const canVerify = selectedTenant?.role === "tenant_owner" || selectedTenant?.role === "payment_verifier";
  const pendingPayments = payments.filter((payment) => payment.status === "pending_verification" || (payment.method === "cash_on_arrival" && payment.status === "pending"));
  const settledPayments = payments.filter((payment) => !pendingPayments.includes(payment));

  if (authStatus === "loading" || loading && memberships.length === 0) {
    return <main className="min-h-screen bg-slate-50 px-4 py-16"><div className="mx-auto flex max-w-5xl items-center gap-3 text-slate-600"><Loader2 className="animate-spin" /> Loading payment workspace…</div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Operations</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Payment verification</h1>
            <p className="mt-2 text-sm text-slate-600">Review transfer receipts and record cash collected by your property team.</p>
          </div>
          <button onClick={refresh} disabled={!propertySlug || loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </header>

        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Tenant
            <select value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
              {memberships.map((membership) => <option key={membership.id} value={membership.tenant.slug}>{membership.tenant.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">Property
            <select value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
              {properties.map((property) => <option key={property._id} value={property.slug}>{property.name}</option>)}
            </select>
          </label>
        </section>

        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
        {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} />{notice}</div>}

        {!memberships.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">No active tenant workspace is linked to this account yet.</div>}
        {memberships.length > 0 && properties.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">No accessible properties found in this workspace.</div>}

        {propertySlug && <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-800">Awaiting action</p><p className="mt-1 text-3xl font-bold text-amber-950">{pendingPayments.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Other payment attempts</p><p className="mt-1 text-3xl font-bold text-slate-900">{settledPayments.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Access level</p><p className="mt-1 flex items-center gap-2 text-lg font-bold text-slate-900"><ShieldCheck size={19} />{selectedTenant?.role?.replaceAll("_", " ") ?? "Member"}</p></div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900">Needs review</h2><span className="text-sm text-slate-500">{pendingPayments.length} items</span></div>
            {pendingPayments.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500"><CheckCircle2 className="mx-auto mb-2 text-emerald-600" />No payments are waiting for review.</div> : pendingPayments.map((payment) => (
              <article key={payment._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{methodLabels[payment.method] ?? payment.method}</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{payment.status.replaceAll("_", " ")}</span></div>
                    <p className="mt-1 text-lg font-bold text-teal-800">{money(payment.amount, payment.currency)}</p>
                    <p className="mt-1 break-all text-xs text-slate-500">Booking {payment.bookingId} · {payment.reference ? `Reference ${payment.reference} · ` : ""}{new Date(payment.submittedAt ?? payment.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {payment.method !== "cash_on_arrival" && <button onClick={() => openReceipt(payment)} disabled={busyId === payment._id} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><ExternalLink size={15} /> View receipt</button>}
                    {canVerify && payment.method !== "cash_on_arrival" && <><button onClick={() => actOnPayment(payment, "verify")} disabled={busyId === payment._id} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busyId === payment._id ? "Working…" : "Verify"}</button><button onClick={() => actOnPayment(payment, "reject")} disabled={busyId === payment._id} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"><XCircle size={15} /> Reject</button></>}
                    {canVerify && payment.method === "cash_on_arrival" && <button onClick={() => actOnPayment(payment, "cash")} disabled={busyId === payment._id} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busyId === payment._id ? "Working…" : "Record cash collected"}</button>}
                    {!canVerify && <span className="text-xs text-slate-500">Read-only access</span>}
                  </div>
                </div>
              </article>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-slate-900">Payment history</h2>
            {settledPayments.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No other payment attempts yet.</div> : settledPayments.map((payment) => (
              <div key={payment._id} className="flex flex-col justify-between gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
                <div><p className="font-semibold text-slate-900">{methodLabels[payment.method] ?? payment.method} · {money(payment.amount, payment.currency)}</p><p className="mt-1 text-xs text-slate-500">Booking {payment.bookingId} · {new Date(payment.createdAt).toLocaleString()}</p></div>
                <span className="inline-flex items-center gap-1 text-sm font-semibold capitalize text-slate-600"><Clock3 size={15} />{payment.status.replaceAll("_", " ")}</span>
              </div>
            ))}
          </section>
        </>}
      </div>
    </main>
  );
}
