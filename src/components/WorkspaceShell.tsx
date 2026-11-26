"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BedDouble, Boxes, CreditCard, Settings2, SprayCan, Wrench, CalendarClock, Menu, X, LayoutDashboard } from "lucide-react";
import { useState } from "react";

const navigation = [
  { href: "/workspace", label: "Overview", description: "Property performance at a glance", icon: LayoutDashboard },
  { href: "/workspace/bookings", label: "Bookings", description: "Reservations and guest stays", icon: BedDouble },
  { href: "/workspace/room-timeline", label: "Room timeline", description: "Daily property operations", icon: CalendarClock },
  { href: "/workspace/inventory", label: "Inventory", description: "Rooms, rates and availability", icon: Boxes },
  { href: "/workspace/housekeeping", label: "Housekeeping", description: "Cleaning and room readiness", icon: SprayCan },
  { href: "/workspace/maintenance", label: "Maintenance", description: "Repairs and work orders", icon: Wrench },
  { href: "/workspace/payments", label: "Payments", description: "Verification and collections", icon: CreditCard },
  { href: "/workspace/payment-settings", label: "Payment settings", description: "Property payment methods", icon: Settings2 },
];

export default function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = navigation.find((item) => item.href === "/workspace" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
  const links = (mobile = false) => navigation.map((item) => {
    const selected = item.href === "/workspace" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = item.icon;
    return <Link key={item.href} href={item.href} onClick={() => mobile && setMobileOpen(false)}
      aria-current={selected ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${selected ? "bg-teal-50 font-semibold text-teal-800 ring-1 ring-teal-100" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>
      <Icon size={18} className={selected ? "text-teal-700" : "text-slate-400 group-hover:text-slate-600"}/>
      <span className="min-w-0"><span className="block">{item.label}</span><span className={`mt-0.5 block text-xs font-normal ${selected ? "text-teal-700/80" : "text-slate-400"}`}>{item.description}</span></span>
    </Link>;
  });
  return <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      <Link href="/workspace" className="flex h-16 items-center gap-3 border-b border-slate-100 px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white">ZS</span>
        <span><span className="block text-sm font-bold tracking-tight">Zain Serenity</span><span className="block text-xs text-slate-500">Hospitality platform</span></span>
      </Link>
      <div className="px-4 pt-6"><p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Workspace</p><nav aria-label="Workspace navigation" className="space-y-1">{links()}</nav></div>
      <div className="mt-auto border-t border-slate-100 p-4"><p className="text-xs leading-5 text-slate-500">Manage bookings, rooms and property operations from one place.</p></div>
    </aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3"><button type="button" aria-label="Open workspace navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">{mobileOpen ? <X size={20}/> : <Menu size={20}/>}</button><div><p className="text-xs text-slate-500">Property management</p><p className="text-sm font-semibold">{active?.label ?? "Workspace"}</p></div></div>
        <Link href="/" className="text-xs font-medium text-slate-500 hover:text-teal-700">Public site</Link>
      </header>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" onClick={() => setMobileOpen(false)}><aside className="h-full w-[min(19rem,85vw)] bg-white p-4 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="mb-5 flex items-center justify-between"><span className="font-bold">Zain Serenity</span><button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 hover:bg-slate-100"><X size={18}/></button></div><nav aria-label="Mobile workspace navigation" className="space-y-1">{links(true)}</nav></aside></div>}
      <main className="min-h-[calc(100vh-4rem)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  </div>;
}
