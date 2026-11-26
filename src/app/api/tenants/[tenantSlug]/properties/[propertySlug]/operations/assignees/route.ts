import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import dbConnect from "@/lib/dbConnect";
import Membership from "@/models/Membership";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read" });
  if (!access.ok || !access.propertyId) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Staff directory access denied" } }, { status: 403 });
  }
  await dbConnect();
  const members = await Membership.find({
    tenantId: access.tenantId, status: "active",
    role: { $in: ["tenant_owner", "property_manager", "housekeeping"] },
    $or: [{ role: "tenant_owner" }, { propertyIds: access.propertyId }],
  }).populate({ path: "userId", select: "name email" }).lean();
  const data = members.flatMap((member) => {
    const user = member.userId as unknown as { _id?: mongoose.Types.ObjectId; name?: string; email?: string } | null;
    if (!user?._id) return [];
    return [{ id: user._id.toString(), name: user.name ?? "Team member", email: user.email ?? "", role: member.role }];
  }).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ data });
}
