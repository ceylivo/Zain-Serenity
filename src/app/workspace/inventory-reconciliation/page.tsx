"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, ClipboardCheck, Loader2, Search, ShieldAlert } from "lucide-react";

type Membership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string };
type Discrepancy = {
  roomTypeId: string; roomTypeName: string; date: string;
  inventoryBlocked: number; trackedBlocked: number; legacyUntracked: number;
  overtracked: number; inventoryDayMissing: boolean;
};
type ReviewCase = { id: string; roomTypeId: string; date: string; legacyUntracked: number; overtracked: number; reason: string; status: "open" | "resolved" | "dismissed"; createdAt: string; resolutionNote?: string | null };
type Report = {
  period: { from: string; to: string };
  summary: { datesChecked: number; discrepancies: number; legacyUntrackedUnits: number; overtrackedUnits: number; missingInventoryDays: number };
  discrepancies: Discrepancy[]; safeToAutoMigrate: false; message: string;
};

const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const daysAgo = (days: number) => {
  const date = new Date(); date.setDate(date.getDate() - days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

export default function InventoryReconciliationPage() {
  const { status } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenant, setTenant] = useState("");
  const [property, setProperty] = useState("");
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewCases, setReviewCases] = useState<ReviewCase[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState("");
  const canRead = memberships.some((item) => item.tenant.slug === tenant && ["tenant_owner", "property_manager", "booking_manager", "receptionist", "housekeeping"].includes(item.role));

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/workspace/inventory-reconciliation");
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

  const loadReviewCases = async () => {
    if (!tenant || !property) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/inventory/blocks/reconciliation/cases`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Unable to load review cases.");
    setReviewCases(Array.isArray(body.data) ? body.data as ReviewCase[] : []);
  };

  const openReviewCase = async (item: Discrepancy) => {
    const key = item.roomTypeId + ":" + item.date;
    const reason = reviewReasons[key]?.trim();
    if (!reason || reason.length < 3) { setError("Please provide a review reason of at least 3 characters."); return; }
    setReviewBusy(key); setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/inventory/blocks/reconciliation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomTypeId: item.roomTypeId, date: item.date, reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to open review case.");
      await loadReviewCases();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open review case."); }
    finally { setReviewBusy(""); }
  };

  const closeReviewCase = async (item: ReviewCase, status: "resolved" | "dismissed") => {
    const note = resolutionNotes[item.id]?.trim();
    if (!note || note.length < 3) { setError("Please enter a resolution note of at least 3 characters."); return; }
    setReviewBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/inventory/blocks/reconciliation/cases`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: item.id, status, resolutionNote: note }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to update review case.");
      await loadReviewCases();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update review case."); }
    finally { setReviewBusy(""); }
  };

  const runAudit = async () => {
    if (!tenant || !property) return;
    setLoading(true); setError(""); setReport(null);
    try {
      const query = new URLSearchParams({ from, to });
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenant)}/properties/${encodeURIComponent(property)}/inventory/blocks/reconciliation?${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Inventory reconciliation failed.");
      setReport(body.data as Report);
      await loadReviewCases();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inventory reconciliation failed."); }
    finally { setLoading(false); }
  };

  if (status === "loading") return <div className="flex items-center gap-3 py-16 text-slate-600"><Loader2 className="animate-spin"/>Loading inventory audit…</div>;

  return <div className="mx-auto max-w-6xl space-y-6">
    <header><p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Inventory integrity</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Legacy block reconciliation</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Compare daily blocked-room counters with individually tracked inventory blocks. This audit is read-only and never releases rooms or rewrites historical data.</p></header>
    <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><ShieldAlert size={20} className="shrink-0"/><p><strong>No automatic migration.</strong> Legacy counters do not preserve their original reason, actor or exact block boundaries. Differences must be reviewed before any corrective action.</p></div>
    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-slate-700">Tenant<select value={tenant} onChange={(event) => setTenant(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3">{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Property<select value={property} onChange={(event) => setProperty(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3">{properties.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3"/></label>
      <label className="text-sm font-medium text-slate-700">To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-3"/></label>
      <div className="sm:col-span-2"><button onClick={() => void runAudit()} disabled={!canRead || !property || !from || !to || loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"><Search size={16}/>{loading ? "Checking inventory…" : "Run read-only audit"}</button></div>
    </section>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18}/>{error}</div>}
    {!canRead && tenant && <p className="text-sm text-amber-800">Your workspace role does not allow inventory auditing.</p>}
    {report && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Dates checked", report.summary.datesChecked],
          ["Discrepancies", report.summary.discrepancies],
          ["Untracked blocked units", report.summary.legacyUntrackedUnits],
          ["Overtracked units", report.summary.overtrackedUnits],
        ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{value}</p></article>)}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4"><ClipboardCheck size={18}/><h2 className="font-semibold text-slate-900">Daily discrepancies</h2></div>
        {report.discrepancies.length === 0 ? <p className="p-6 text-sm text-emerald-800">No counter differences were found for this date range.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Room type","Date","Counter blocked","Tracked blocks","Legacy untracked","Overtracked","Review"].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{report.discrepancies.map((item) => <tr key={item.roomTypeId + item.date} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-900">{item.roomTypeName}</td><td className="px-4 py-3 tabular-nums">{item.date}</td><td className="px-4 py-3 tabular-nums">{item.inventoryBlocked}{item.inventoryDayMissing ? " (missing day)" : ""}</td><td className="px-4 py-3 tabular-nums">{item.trackedBlocked}</td><td className="px-4 py-3 font-semibold text-amber-700 tabular-nums">{item.legacyUntracked}</td><td className="px-4 py-3 font-semibold text-rose-700 tabular-nums">{item.overtracked}</td><td className="px-4 py-3"><div className="flex min-w-64 gap-2"><input aria-label="Review reason" value={reviewReasons[item.roomTypeId + ":" + item.date] ?? ""} onChange={(event) => setReviewReasons((current) => ({ ...current, [item.roomTypeId + ":" + item.date]: event.target.value }))} placeholder="Why does this need review?" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2"/><button disabled={!!reviewBusy} onClick={() => void openReviewCase(item)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewBusy === item.roomTypeId + ":" + item.date ? "Saving…" : "Open case"}</button></div></td></tr>)}</tbody></table></div>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4"><h2 className="font-semibold text-slate-900">Review cases</h2><p className="mt-1 text-xs text-slate-500">Closing a case records a decision only; it does not change inventory.</p></div>{reviewCases.length === 0 ? <p className="p-5 text-sm text-slate-500">No review cases recorded for this property yet.</p> : <div className="divide-y divide-slate-100">{reviewCases.map((item) => <div key={item.id} className="space-y-2 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-900">{item.date} · {item.legacyUntracked} legacy / {item.overtracked} overtracked</p><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-700">{item.status}</span></div><p className="text-sm text-slate-600">{item.reason}</p>{item.status === "open" && <div className="flex flex-wrap gap-2"><input aria-label="Resolution note" value={resolutionNotes[item.id] ?? ""} onChange={(event) => setResolutionNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Decision / evidence note" className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"/><button disabled={!!reviewBusy} onClick={() => void closeReviewCase(item, "resolved")} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Resolve</button><button disabled={!!reviewBusy} onClick={() => void closeReviewCase(item, "dismissed")} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Dismiss</button></div>}{item.resolutionNote && <p className="text-xs text-slate-500">Decision: {item.resolutionNote}</p>}</div>)}</div>}</section>
      <p className="text-xs text-slate-500">{report.message}</p>
    </>}
  </div>;
}
