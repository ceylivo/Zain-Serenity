"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";

type TenantMembership = { id: string; role: string; tenant: { name: string; slug: string } };
type Property = { _id: string; name: string; slug: string; currency: string };
type Method = "bank_transfer" | "easypaisa" | "jazzcash" | "cash_on_arrival";
type Settings = {
  enabledMethods: Method[];
  bankTransfer?: { bankName?: string; accountTitle?: string; accountNumber?: string; iban?: string; instructions?: string };
  easypaisa?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  jazzcash?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  cashInstructions?: string;
};
const empty: Settings = { enabledMethods: [] };
const methods: { id: Method; label: string; description: string }[] = [
  { id: "bank_transfer", label: "Bank transfer", description: "Customers transfer funds to your nominated bank account." },
  { id: "easypaisa", label: "Easypaisa", description: "Customers pay using your Easypaisa account." },
  { id: "jazzcash", label: "JazzCash", description: "Customers pay using your JazzCash account." },
  { id: "cash_on_arrival", label: "Cash on arrival", description: "Staff record collection only after cash is physically received." },
];

export default function PaymentSettingsPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenantSlug, setTenantSlug] = useState("");
  const [propertySlug, setPropertySlug] = useState("");
  const [settings, setSettings] = useState<Settings>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const tenant = useMemo(() => memberships.find((item) => item.tenant.slug === tenantSlug), [memberships, tenantSlug]);
  const canManage = tenant?.role === "tenant_owner";

  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/login?callbackUrl=/workspace/payment-settings");
    if (authStatus !== "authenticated") return;
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/tenants", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load tenants.");
        const items = Array.isArray(body.data) ? body.data as TenantMembership[] : [];
        if (active) { setMemberships(items); setTenantSlug(items[0]?.tenant.slug ?? ""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load tenants."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [authStatus, router]);

  useEffect(() => {
    if (!tenantSlug) { setProperties([]); setPropertySlug(""); return; }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load properties.");
        const items = Array.isArray(body.data) ? body.data as Property[] : [];
        if (active) { setProperties(items); setPropertySlug(items[0]?.slug ?? ""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load properties."); }
    })();
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug || !propertySlug) { setSettings(empty); return; }
    let active = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/payment-settings`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Unable to load payment settings.");
        if (active) setSettings({ ...empty, ...(body.data as Settings) });
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Unable to load payment settings."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [tenantSlug, propertySlug]);

  const toggle = (method: Method, checked: boolean) => setSettings((current) => ({
    ...current,
    enabledMethods: checked ? [...new Set([...current.enabledMethods, method])] : current.enabledMethods.filter((item) => item !== method),
  }));
  const updateSection = (section: "bankTransfer" | "easypaisa" | "jazzcash", key: string, value: string) => {
    setSettings((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  };
  const inputClass = "mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantSlug)}/properties/${encodeURIComponent(propertySlug)}/payment-settings`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Unable to save payment settings.");
      setSettings({ ...empty, ...(body.data as Settings) });
      setNotice("Payment settings saved for this property.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save payment settings."); }
    finally { setSaving(false); }
  };

  if (authStatus === "loading" || loading && memberships.length === 0) return <main className="mx-auto max-w-4xl px-4 py-16 text-slate-600"><Loader2 className="mr-2 inline animate-spin" />Loading payment settings…</main>;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header><p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Workspace settings</p><h1 className="mt-1 text-3xl font-bold text-slate-950">Payment methods</h1><p className="mt-2 text-sm text-slate-600">Configure the payment instructions customers see for each property.</p></header>
        {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18}/>{error}</div>}
        {notice && <div role="status" className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18}/>{notice}</div>}
        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Tenant<select value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} className={inputClass}>{memberships.map((item) => <option key={item.id} value={item.tenant.slug}>{item.tenant.name}</option>)}</select></label>
          <label className="text-sm font-medium text-slate-700">Property<select value={propertySlug} onChange={(event) => setPropertySlug(event.target.value)} className={inputClass}>{properties.map((item) => <option key={item._id} value={item.slug}>{item.name} · {item.currency}</option>)}</select></label>
        </section>
        {!canManage ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Only a tenant owner can edit payment settings. Your access remains read-only.</div> : <form onSubmit={save} className="space-y-5">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Available methods</h2>
            {methods.map((method) => <label key={method.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 p-3"><input type="checkbox" checked={settings.enabledMethods.includes(method.id)} onChange={(event) => toggle(method.id, event.target.checked)} className="mt-1 h-4 w-4 accent-teal-700"/><span><span className="block font-medium text-slate-900">{method.label}</span><span className="text-sm text-slate-600">{method.description}</span></span></label>)}
          </section>
          {settings.enabledMethods.includes("bank_transfer") && <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><h2 className="font-semibold sm:col-span-2">Bank transfer instructions</h2>{[["bankName","Bank name"],["accountTitle","Account title"],["accountNumber","Account number"],["iban","IBAN"],["instructions","Customer instructions"]].map(([key,label])=><label key={key} className="text-sm font-medium text-slate-700">{label}{key==="instructions"?<textarea rows={3} value={settings.bankTransfer?.[key as keyof NonNullable<Settings["bankTransfer"]>] ?? ""} onChange={(event)=>updateSection("bankTransfer",key,event.target.value)} className={inputClass}/>:<input value={settings.bankTransfer?.[key as keyof NonNullable<Settings["bankTransfer"]>] ?? ""} onChange={(event)=>updateSection("bankTransfer",key,event.target.value)} className={inputClass}/>}</label>)}</section>}
          {(["easypaisa","jazzcash"] as const).filter((method)=>settings.enabledMethods.includes(method)).map((method)=><section key={method} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2"><h2 className="font-semibold capitalize sm:col-span-2">{method} instructions</h2>{[["accountTitle","Account title"],["accountNumber","Account number"],["instructions","Customer instructions"]].map(([key,label])=><label key={key} className="text-sm font-medium text-slate-700">{label}{key==="instructions"?<textarea rows={3} value={settings[method]?.[key as keyof NonNullable<Settings[typeof method]>] ?? ""} onChange={(event)=>updateSection(method,key,event.target.value)} className={inputClass}/>:<input value={settings[method]?.[key as keyof NonNullable<Settings[typeof method]>] ?? ""} onChange={(event)=>updateSection(method,key,event.target.value)} className={inputClass}/>}</label>)}</section>)}
          {settings.enabledMethods.includes("cash_on_arrival") && <section className="rounded-2xl border border-slate-200 bg-white p-5"><label className="block text-sm font-medium text-slate-700">Cash-on-arrival instructions<textarea rows={3} value={settings.cashInstructions ?? ""} onChange={(event)=>setSettings((current)=>({...current,cashInstructions:event.target.value}))} className={inputClass}/></label></section>}
          <button type="submit" disabled={saving || loading || !propertySlug} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white disabled:opacity-50"><Save size={17}/>{saving ? "Saving…" : "Save payment settings"}</button>
        </form>}
      </div>
    </main>
  );
}
