"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Loader2, RefreshCw, Wallet } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string; currency: string };
type Totals = Record<string, {
  grossCollected: number; completedRefunds: number; netCollected: number;
  pendingRefunds: number; paymentCount: number; completedRefundCount: number; pendingRefundCount: number;
}>;
type Balances = Record<string, { amount: number; bookings: number }>;
type Report = { period: { from: string | null; to: string | null }; totals: Totals; outstandingBalances: Balances; generatedAt: string; limitations: string[] };

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

export default function ReconciliationPage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenant, setTenant] = useState("");
  const [property, setProperty] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => memberships.find((item) => item.tenant.slug === tenant), [memberships, tenant]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/reconciliation");
    if (status !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load workspaces.");
        if (!active) return;
        const rows = Array.isArray(body.data) ? body.data as Membership[] : [];
        setMemberships(rows);
        setTenant(rows[0]?.tenant.slug ?? "");
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load workspaces."); }
    })();
    return () => { active = false; };
  }, [status, router]);

  useEffect(() => {
    if (!tenant) { setProperties([]); setProperty(""); return; }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        if (!active) return;
        const rows = Array.isArray(body.data) ? body.data as Property[] : [];
        setProperties(rows);
        setProperty(rows[0]?.slug ?? "");
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties."); }
    })();
    return () => { active = false; };
  }, [tenant]);

  const load = useCallback(async () => {
    if (!tenant || !property) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/payments/reconciliation`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to load reconciliation.");
      setReport(body.data as Report);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load reconciliation."); }
    finally { setLoading(false); }
  }, [tenant, property]);

  useEffect(() => { setReport(null); void load(); }, [load]);
  const canView = selected?.role && ["tenant_owner", "property_manager", "payment_verifier", "analyst"].includes(selected.role);
  const currencies = report ? [...new Set([...Object.keys(report.totals), ...Object.keys(report.outstandingBalances)])].sort() : [];

  if (status === "loading" || (status === "authenticated" && memberships.length === 0 && !error)) {
    return <div className="flex items-center gap-3 py-16 text-slate-600"><Loader2 className="animate-spin" />Loading reconciliation…</div>;
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Finance</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Payment reconciliation</h1><p className="mt-2 text-sm text-slate-600">A ledger-based view of settled payments, refunds and current booking balances.</p></div>
      <button onClick={() => void load()} disabled={!property || loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Refresh report</button>
    </header>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Tenant<select value={tenant} onChange={(event) => setTenant(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3">{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Property<select value={property} onChange={(event) => setProperty(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-3">{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
    </section>

    {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18}/>{error}</div>}
    {!canView && selected && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Your current workspace role does not include financial reporting access.</div>}

    {report && canView && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {currencies.map((currency) => {
          const row = report.totals[currency];
          const due = report.outstandingBalances[currency];
          return <article key={currency} className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
            <div className="flex items-center justify-between"><p className="font-semibold text-slate-900">{currency} ledger</p><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{currency}</span></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs text-slate-500">Gross collected</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-950">{money(row?.grossCollected ?? 0, currency)}</p></div>
              <div><p className="text-xs text-slate-500">Net collected</p><p className="mt-1 text-xl font-bold tabular-nums text-teal-800">{money(row?.netCollected ?? 0, currency)}</p></div>
              <div><p className="text-xs text-slate-500">Completed refunds</p><p className="mt-1 flex items-center gap-1 font-semibold text-slate-800"><ArrowDownRight size={15}/>{money(row?.completedRefunds ?? 0, currency)}</p></div>
              <div><p className="text-xs text-slate-500">Pending refunds</p><p className="mt-1 font-semibold text-amber-700">{money(row?.pendingRefunds ?? 0, currency)}</p></div>
              <div><p className="text-xs text-slate-500">Outstanding balances</p><p className="mt-1 flex items-center gap-1 font-semibold text-slate-800"><ArrowUpRight size={15}/>{money(due?.amount ?? 0, currency)}</p><p className="text-xs text-slate-500">{due?.bookings ?? 0} bookings</p></div>
              <div><p className="text-xs text-slate-500">Settled payment attempts</p><p className="mt-1 font-semibold text-slate-800">{row?.paymentCount ?? 0}</p><p className="text-xs text-slate-500">{row?.completedRefundCount ?? 0} completed · {row?.pendingRefundCount ?? 0} pending refunds</p></div>
            </div>
          </article>;
        })}
      </section>
      {currencies.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Wallet className="mx-auto mb-3 text-slate-400"/><p className="font-semibold text-slate-900">No settled payment activity yet</p><p className="mt-1 text-sm text-slate-500">Financial totals will appear after payments are collected or settled.</p></div>}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Reporting notes</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="mt-4 text-xs text-slate-400">Generated {new Date(report.generatedAt).toLocaleString()}</p>
      </section>
    </>}
  </div>;
}
