import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/dbConnect";
import Booking from "@/models/Booking";
import Payment from "@/models/Payment";
import Tenant from "@/models/Tenant";
import Property from "@/models/Property";
import RoomType from "@/models/RoomType";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));

  await dbConnect();
  const filter = { userId: session.user.id };
  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .select("tenantId propertyId roomTypeId roomId checkIn checkOut guests children totalPrice currency paymentStatus status specialRequests createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);

  const tenantIds = [...new Set(bookings.map((item) => item.tenantId?.toString()).filter((id): id is string => Boolean(id)))];
  const propertyIds = [...new Set(bookings.map((item) => item.propertyId?.toString()).filter((id): id is string => Boolean(id)))];
  const roomTypeIds = [...new Set(bookings.map((item) => item.roomTypeId?.toString()).filter((id): id is string => Boolean(id)))];
  const bookingIds = bookings.map((item) => item._id);

  const [tenants, properties, roomTypes, payments] = await Promise.all([
    Tenant.find({ _id: { $in: tenantIds }, status: "active" }).select("name slug").lean(),
    Property.find({ _id: { $in: propertyIds } }).select("name slug currency").lean(),
    RoomType.find({ _id: { $in: roomTypeIds } }).select("name").lean(),
    Payment.find({ bookingId: { $in: bookingIds }, userId: new mongoose.Types.ObjectId(session.user.id) })
      .select("bookingId method status amount currency reference submittedAt verifiedAt createdAt")
      .sort({ createdAt: -1 }).lean(),
  ]);

  const tenantMap = new Map(tenants.map((item) => [item._id.toString(), { name: item.name, slug: item.slug }]));
  const propertyMap = new Map(properties.map((item) => [item._id.toString(), { name: item.name, slug: item.slug, currency: item.currency }]));
  const roomMap = new Map(roomTypes.map((item) => [item._id.toString(), item.name]));
  const paymentMap = new Map<string, typeof payments>();
  for (const payment of payments) {
    const key = payment.bookingId.toString();
    paymentMap.set(key, [...(paymentMap.get(key) ?? []), payment]);
  }

  const data = bookings.map((booking) => {
    const tenant = booking.tenantId ? tenantMap.get(booking.tenantId.toString()) : undefined;
    const property = booking.propertyId ? propertyMap.get(booking.propertyId.toString()) : undefined;
    return {
      ...booking,
      tenant: tenant ?? null,
      property: property ?? null,
      roomName: booking.roomTypeId ? roomMap.get(booking.roomTypeId.toString()) ?? "Room" : "Legacy booking",
      currency: booking.currency ?? property?.currency ?? "PKR",
      payments: paymentMap.get(booking._id.toString()) ?? [],
    };
  });

  return NextResponse.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}
