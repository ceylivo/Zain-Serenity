"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string };
type Payment = { _id: string; bookingId: string; amount: number; currency: string; method: string; status: string; createdAt: string };
type Refund = { _id: string; amount: number; currency: string; reason: string; status: string; requestedBy: string; reviewNote?: string; externalReference?: string; createdAt: string; completedAt?: string };

const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
};

export default function RefundsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenant, setTenant] = useState("");
  const [property, setProperty] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<Record<string, Refund[]>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const role = useMemo(() => memberships.find((item) => item.tenant.slug === tenant)?.role, [memberships, tenant]);
  const canRefund = role === "tenant_owner";

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/refunds");
    if (status !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        if (!active) return;
        const rows = Array.isArray(body.data) ? body.data as Membership[] : [];
        setMemberships(rows); setTenant(rows[0]?.tenant.slug ?? "");
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces."); }
    })();
    return () => { active = false; };
  }, [status, router]);

  useEffect(() => {
    if (!tenant) return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        if (!active) return;
        const rows = Array.isArray(body.data) ? body.data as Property[] : [];
        setProperties(rows); setProperty(rows[0]?.slug ?? "");
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties."); }
    })();
    return () => { active = false; };
  }, [tenant]);

  const load = useCallback(async () => {
    if (!tenant || !property) return;
    setBusy("load"); setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to load payments.");
      const rows = Array.isArray(body.data) ? body.data as Payment[] : [];
      setPayments(rows.filter((payment) => ["succeeded", "refunded"].includes(payment.status)));
      const next: Record<string, Refund[]> = {};
      await Promise.all(rows.filter((payment) => ["succeeded", "refunded"].includes(payment.status)).map(async (payment) => {
        const result = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments/${payment._id}/refunds`, { cache: "no-store" });
        const data = await result.json();
        if (result.ok) next[payment._id] = Array.isArray(data.data) ? data.data as Refund[] : [];
      }));
      setRefunds(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load refunds."); }
    finally { setBusy(""); }
  }, [tenant, property]);

  useEffect(() => { if (tenant && property) void Promise.resolve().then(load); }, [load, tenant, property]);

  const createRefund = async (payment: Payment) => {
    const amount = Number(amounts[payment._id]);
    const reason = reasons[payment._id]?.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !reason || reason.length < 3) {
      setError("Enter a valid refund amount and a reason of at least 3 characters."); return;
    }
    setBusy(payment._id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments/${payment._id}/refunds`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amount, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Refund request failed.");
      setNotice("Refund request recorded for independent review.");
      setAmounts((value) => ({ ...value, [payment._id]: "" }));
      setReasons((value) => ({ ...value, [payment._id]: "" }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Refund request failed."); }
    finally { setBusy(""); }
  };

  const transition = async (payment: Payment, refund: Refund, action: "approve" | "reject" | "processing" | "complete" | "fail") => {
    const note = notes[refund._id]?.trim();
    const externalReference = references[refund._id]?.trim();
    if ((action === "reject" || action === "fail") && !note) { setError("A reason is required for rejection or failure."); return; }
    if (action === "complete" && !externalReference) { setError("Enter the external settlement reference before completion."); return; }
    setBusy(refund._id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments/${payment._id}/refunds`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId: refund._id, action, ...(note ? { note } : {}), ...(externalReference ? { externalReference } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Refund update failed.");
      setNotice(`Refund marked ${action === "complete" ? "completed (settlement recorded)" : action === "processing" ? "processing" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "failed"}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Refund update failed."); }
    finally { setBusy(""); }
  };

  if (status === "loading") return <div className="flex items-center gap-3 py-16 text-slate-600"><Loader2 className="animate-spin"/>Loading refunds…</div>;

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Finance</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Refund management</h1><p className="mt-2 text-sm text-slate-600">Request, review and record refunds with an auditable settlement reference. No money is transferred by this screen.</p></div><button onClick={() => void load()} disabled={busy === "load" || !property} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={16} className={busy === "load" ? "animate-spin" : ""}/>Refresh</button></header>
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Tenant<select value={tenant} onChange={(event) => setTenant(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3">{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
      <label className="text-sm font-medium">Property<select value={property} onChange={(event) => setProperty(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3">{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
    </section>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle className="mr-2 inline" size={17}/>{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline" size={17}/>{notice}</div>}
    {!canRefund && role && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Refund requests and approvals are restricted to tenant owners by the current role policy. You can still inspect payment refund history.</div>}
    <div className="space-y-4">
      {payments.map((payment) => <article key={payment._id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-950">{money(payment.amount, payment.currency)} · {payment.method.replaceAll("_", " ")}</h2><p className="mt-1 text-xs text-slate-500">Booking {payment.bookingId} · {payment.status.replaceAll("_", " ")}</p></div><span className="text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString()}</span></div>
        {canRefund && <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><label className="text-xs font-medium text-slate-600">Amount<input type="number" min="0.01" max={payment.amount} step="0.01" value={amounts[payment._id] ?? ""} onChange={(event) => setAmounts((value) => ({ ...value, [payment._id]: event.target.value }))} placeholder="0.00" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-medium text-slate-600">Reason<input value={reasons[payment._id] ?? ""} onChange={(event) => setReasons((value) => ({ ...value, [payment._id]: event.target.value }))} maxLength={500} placeholder="Reason for refund" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><button onClick={() => void createRefund(payment)} disabled={busy === payment._id} className="self-end rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Request refund</button></div>}
        {(refunds[payment._id] ?? []).length > 0 ? <div className="space-y-3 border-t border-slate-100 pt-4">{refunds[payment._id].map((refund) => <div key={refund._id} className="rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-slate-900">{money(refund.amount, refund.currency)} · <span className="capitalize">{refund.status}</span></p><p className="mt-1 text-sm text-slate-600">{refund.reason}</p></div><span className="text-xs text-slate-500">{new Date(refund.createdAt).toLocaleString()}</span></div>
          {refund.externalReference && <p className="mt-2 text-xs text-slate-600">Settlement reference: {refund.externalReference}</p>}
          {canRefund && ["requested", "approved", "processing"].includes(refund.status) && <div className="mt-3 space-y-2">
            {refund.status === "requested" && <div className="flex flex-wrap gap-2"><button onClick={() => void transition(payment, refund, "approve")} disabled={busy === refund._id} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Approve</button><button onClick={() => void transition(payment, refund, "reject")} disabled={busy === refund._id} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Reject with reason below</button></div>}
            {refund.status === "approved" && <button onClick={() => void transition(payment, refund, "processing")} disabled={busy === refund._id} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Mark processing</button>}
            <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-slate-600">Review / failure reason<input value={notes[refund._id] ?? ""} onChange={(event) => setNotes((value) => ({ ...value, [refund._id]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-xs text-slate-600">External settlement reference<input value={references[refund._id] ?? ""} onChange={(event) => setReferences((value) => ({ ...value, [refund._id]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2"/></label></div>
            <div className="flex flex-wrap gap-2">{refund.status !== "requested" && <><button onClick={() => void transition(payment, refund, "complete")} disabled={busy === refund._id} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white">Record settlement complete</button><button onClick={() => void transition(payment, refund, "fail")} disabled={busy === refund._id} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Mark failed</button></>}</div>
          </div>}
        </div>)}</div> : <p className="border-t border-slate-100 pt-3 text-sm text-slate-500">No refund requests for this payment.</p>}
      </article>)}
      {payments.length === 0 && !busy && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><RotateCcw className="mx-auto mb-3 text-slate-400"/><p className="font-semibold text-slate-900">No settled payments available</p><p className="mt-1 text-sm text-slate-500">Only settled payments can have refund requests.</p></div>}
    </div>
  </div>;
}
