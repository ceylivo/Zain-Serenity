import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import dbConnect from "@/lib/dbConnect";
import Payment from "@/models/Payment";
import Refund from "@/models/Refund";
import Booking from "@/models/Booking";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
const validDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const groupTotals = (rows: Array<{ _id: string; amount: number; count: number }>) =>
  Object.fromEntries(rows.map((row) => [row._id, { amount: Math.round(row.amount * 100) / 100, count: row.count }]));

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission: "report:read",
  });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Financial reporting permission is required.", 403);

  const url = new URL(request.url);
  const from = validDate(url.searchParams.get("from"));
  const to = validDate(url.searchParams.get("to"));
  if ((url.searchParams.has("from") && !from) || (url.searchParams.has("to") && !to) ||
      (from && to && from >= to) || (from && to && to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000)) {
    return fail("INVALID_DATE_RANGE", "Use valid ISO dates with a maximum range of 366 days.", 422);
  }
  const range = from || to ? { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } : undefined;
  await dbConnect();

  const paymentMatch: Record<string, unknown> = {
    tenantId: access.tenantId, propertyId: access.propertyId,
    status: { $in: ["succeeded", "refunded"] },
    ...(range ? { verifiedAt: range } : {}),
  };
  const refundMatch: Record<string, unknown> = {
    tenantId: access.tenantId, propertyId: access.propertyId,
    status: { $in: ["requested", "approved", "processing", "completed"] },
  };
  if (range) {
    refundMatch.$or = [
      { status: "completed", completedAt: range },
      { status: { $in: ["requested", "approved", "processing"] }, createdAt: range },
    ];
  }
  const [payments, refunds, outstanding] = await Promise.all([
    Payment.aggregate([
      { $match: paymentMatch },
      { $group: { _id: "$currency", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Refund.aggregate([
      { $match: refundMatch },
      { $group: {
        _id: "$currency",
        completedAmount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$amount", 0] } },
        completedCount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        pendingAmount: { $sum: { $cond: [{ $in: ["$status", ["requested", "approved", "processing"]] }, "$amount", 0] } },
        pendingCount: { $sum: { $cond: [{ $in: ["$status", ["requested", "approved", "processing"]] }, 1, 0] } },
      } },
    ]),
    Booking.aggregate([
      { $match: {
        tenantId: access.tenantId, propertyId: access.propertyId,
        status: { $nin: ["cancelled", "no_show"] },
        paymentStatus: { $in: ["unpaid", "pending", "partially_paid", "partially_refunded"] },
      } },
      { $lookup: {
        from: Payment.collection.name,
        let: { bookingId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$bookingId", "$$bookingId"] },
            { $eq: ["$tenantId", access.tenantId] },
            { $eq: ["$propertyId", access.propertyId] },
            { $in: ["$status", ["succeeded", "refunded"]] },
          ] } } },
          { $project: { amount: 1, currency: 1 } },
        ],
        as: "payments",
      } },
      { $lookup: {
        from: Refund.collection.name,
        let: { bookingId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ["$bookingId", "$$bookingId"] },
            { $eq: ["$tenantId", access.tenantId] },
            { $eq: ["$propertyId", access.propertyId] },
            { $eq: ["$status", "completed"] },
          ] } } },
          { $project: { amount: 1, currency: 1 } },
        ],
        as: "refunds",
      } },
      { $addFields: {
        paidAmount: { $sum: { $map: {
          input: "$payments", as: "payment",
          in: { $cond: [{ $eq: ["$$payment.currency", { $ifNull: ["$currency", "PKR"] }] }, "$$payment.amount", 0] },
        } } },
        refundedAmount: { $sum: { $map: {
          input: "$refunds", as: "refund",
          in: { $cond: [{ $eq: ["$$refund.currency", { $ifNull: ["$currency", "PKR"] }] }, "$$refund.amount", 0] },
        } } },
      } },
      { $addFields: {
        outstandingAmount: { $max: [0, { $subtract: [{ $add: ["$totalPrice", "$refundedAmount"] }, "$paidAmount"] }] },
      } },
      { $match: { outstandingAmount: { $gt: 0 } } },
      { $group: {
        _id: { $ifNull: ["$currency", "PKR"] },
        amount: { $sum: "$outstandingAmount" },
        bookings: { $sum: 1 },
      } },
    ]),
  ]);

  const gross = groupTotals(payments);
  const refundTotals = Object.fromEntries(refunds.map((row) => [row._id, {
    completedAmount: Math.round(row.completedAmount * 100) / 100,
    completedCount: row.completedCount,
    pendingAmount: Math.round(row.pendingAmount * 100) / 100,
    pendingCount: row.pendingCount,
  }]));
  const currencies = [...new Set([...Object.keys(gross), ...Object.keys(refundTotals)])];
  const totals = Object.fromEntries(currencies.map((currency) => {
    const collected = gross[currency]?.amount ?? 0;
    const refund = refundTotals[currency]?.completedAmount ?? 0;
    return [currency, {
      grossCollected: collected,
      completedRefunds: refund,
      netCollected: Math.round((collected - refund) * 100) / 100,
      pendingRefunds: refundTotals[currency]?.pendingAmount ?? 0,
      paymentCount: gross[currency]?.count ?? 0,
      completedRefundCount: refundTotals[currency]?.completedCount ?? 0,
      pendingRefundCount: refundTotals[currency]?.pendingCount ?? 0,
    }];
  }));

  const outstandingByCurrency = Object.fromEntries(outstanding.map((row) => [row._id, {
    amount: Math.round(row.amount * 100) / 100,
    bookings: row.bookings,
  }]));

  return NextResponse.json({
    data: {
      period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      totals,
      outstandingBalances: outstandingByCurrency,
      generatedAt: new Date().toISOString(),
      limitations: ["Outstanding balances are a current snapshot, not historical as-of balances.", "Financial totals are grouped by currency and are never converted."],
    },
  });
}
